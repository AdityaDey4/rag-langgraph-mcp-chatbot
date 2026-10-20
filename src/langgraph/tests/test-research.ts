// Tests for the research graph (research.ts) and the report graph that uses it (report.ts):  npm run test:langgraph-research
// No Qdrant and no OpenAI: a fake search stands in for the real one.

import assert from "node:assert/strict";
import { makeReportGraph } from "../report";
import { makeResearchGraph, type Found } from "../research";

let passed = 0;
let failed = 0;

// Example: prints "  ok   <name>", or "  FAIL <name>" plus the error
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(error);
  }
}

// Example: fakeSearch(80) returns a search that takes 80 ms; its calls are counted in .calls
function fakeSearch(delayMs: number, failFirst = 0) {
  const attempts: Record<string, number> = {};

  const search = async (query: string): Promise<Found> => {
    search.calls++;
    attempts[query] = (attempts[query] ?? 0) + 1;
    if (attempts[query] <= failFirst) throw new Error("search failed");

    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return { query, section: `section of ${query}`, score: 0.5 };
  };
  search.calls = 0;

  return search;
}

let threadNumber = 0;
// Example: newThread() returns the config of a thread that has not been used yet
const newThread = () => ({ configurable: { thread_id: `r${threadNumber++}` } });

// Example: runs every test, then prints "9 passed, 0 failed"
async function main() {
  console.log("parallel search");

  await test("one search per question, and every result is combined in the order of the questions", async () => {
    const search = fakeSearch(10);
    const result = await makeResearchGraph(search).invoke({ queries: ["B", "A", "C"] }, newThread());

    assert.equal(search.calls, 3);
    assert.equal(result.found.length, 3);
    assert.deepEqual(result.summary.split("\n").map((line) => line.split(" ")[0]), ["B", "A", "C"]);
  });

  await test("the searches run at the same time, not one after another", async () => {
    const start = Date.now();
    await makeResearchGraph(fakeSearch(100)).invoke({ queries: ["A", "B", "C"] }, newThread());

    assert.ok(Date.now() - start < 250, "three 100 ms searches one by one would take 300 ms or more");
  });

  console.log("retries");

  await test("a search that fails twice is tried again and the run still works", async () => {
    const search = fakeSearch(5, 2);
    const result = await makeResearchGraph(search).invoke({ queries: ["flaky"] }, newThread());

    assert.equal(search.calls, 3);
    assert.equal(result.found.length, 1);
  });

  await test("a search that always fails stops the run after 3 attempts", async () => {
    const search = fakeSearch(5, 99);

    await assert.rejects(makeResearchGraph(search).invoke({ queries: ["broken"] }, newThread()), /search failed/);
    assert.equal(search.calls, 3);
  });

  console.log("time travel");

  await test("replaying from the checkpoint before combine gives the same result and searches nothing again", async () => {
    const search = fakeSearch(5);
    const graph = makeResearchGraph(search);
    const config = newThread();
    const first = await graph.invoke({ queries: ["A", "B"] }, config);

    const history = [];
    for await (const snapshot of graph.getStateHistory(config)) history.push(snapshot);
    const beforeCombine = history.find((snapshot) => snapshot.next.includes("combine"))!;

    const replayed = await graph.invoke(null, beforeCombine.config);
    assert.equal(replayed.summary, first.summary);
    assert.equal(search.calls, 2);
  });

  await test("a fork changes the state at a checkpoint and the run continues from there", async () => {
    const search = fakeSearch(5);
    const graph = makeResearchGraph(search);
    const config = newThread();
    await graph.invoke({ queries: ["A", "B"] }, config);

    const history = [];
    for await (const snapshot of graph.getStateHistory(config)) history.push(snapshot);
    const beforeCombine = history.find((snapshot) => snapshot.next.includes("combine"))!;

    // The edit goes through the reducer (2 results plus 1 gives 3). "search" says who wrote it, so "combine" is next.
    const forked = await graph.updateState(beforeCombine.config, { found: [{ query: "Z", section: "extra", score: 1 }] }, "search");
    const result = await graph.invoke(null, forked);

    assert.equal(result.found.length, 3);
    assert.equal(search.calls, 2);
  });

  console.log("cache");

  await test("the same question on another thread is not searched again", async () => {
    const search = fakeSearch(5);
    const graph = makeResearchGraph(search);

    await graph.invoke({ queries: ["A", "B"] }, newThread());
    await graph.invoke({ queries: ["A", "C"] }, newThread());

    assert.equal(search.calls, 3); // A and B in the first run, only C in the second
  });

  console.log("subgraph");

  await test("the report graph runs the research graph as one step and then writes the report", async () => {
    const search = fakeSearch(5);
    const result = await makeReportGraph(search).invoke({ queries: ["A", "B"] }, newThread());

    assert.equal(search.calls, 2);
    assert.match(result.report, /^REPORT \(2 questions\)/);
    assert.match(result.report, /A -> section of A/);
    assert.match(result.report, /B -> section of B/);
  });

  await test("the research graph's own field (found) does not leak into the report graph", async () => {
    const result = await makeReportGraph(fakeSearch(5)).invoke({ queries: ["A"] }, newThread());

    assert.equal("found" in result, false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();

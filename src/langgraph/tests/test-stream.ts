// Tests for reading the stream (agent.ts):  npm run test:langgraph-stream
// No model and no network: hand-made chunks, shaped like the ones graph.stream() sends.

import assert from "node:assert/strict";
import { AIMessage, AIMessageChunk, ToolMessage } from "@langchain/core/messages";
import { handleNodeUpdate, handleTextChunk, makeStep, type Progress, type Step } from "../agent";

let passed = 0;
let failed = 0;

// Example: prints "  ok   <name>", or "  FAIL <name>" plus the error
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(error);
  }
}

// Example: newProgress() returns a fresh Progress, as run() starts with
function newProgress(): Progress {
  return { chunks: 1, lastKind: "", stepStartedAt: Date.now(), counts: { updates: 0, text: 0, empty: 0, other: 0 } };
}

const askForSearch = new AIMessage({
  content: "",
  tool_calls: [{ id: "call_1", name: "search_documents", args: { query: "Kafka" }, type: "tool_call" }],
  usage_metadata: { input_tokens: 1288, output_tokens: 14, total_tokens: 1302 },
});

// Example: runs every test, then prints "7 passed, 0 failed"
function main() {
  console.log("text chunks (the typing effect)");

  test("text from the llm node goes to onToken", () => {
    const tokens: string[] = [];
    handleTextChunk([new AIMessageChunk("Apache"), { langgraph_node: "llm" }], newProgress(), (text) => tokens.push(text));
    assert.deepEqual(tokens, ["Apache"]);
  });

  test("an llm chunk without text is not printed", () => {
    const tokens: string[] = [];
    const progress = newProgress();
    handleTextChunk([new AIMessageChunk(""), { langgraph_node: "llm" }], progress, (text) => tokens.push(text));
    assert.deepEqual(tokens, []);
    assert.equal(progress.counts.empty, 1);
  });

  test("the tools node's output is not printed as the answer", () => {
    const tokens: string[] = [];
    const progress = newProgress();
    const toolResult = new ToolMessage({ content: "<tool_result>…</tool_result>", tool_call_id: "call_1" });
    handleTextChunk([toolResult, { langgraph_node: "tools" }], progress, (text) => tokens.push(text));
    assert.deepEqual(tokens, []);
    assert.equal(progress.counts.other, 1);
  });

  console.log("node updates (the progress lines)");

  test("a finished node becomes one step, with tokens from the model's message", () => {
    const steps: Step[] = [];
    const seen: Step[] = [];
    handleNodeUpdate({ llm: { messages: [askForSearch] } }, newProgress(), steps, (step) => seen.push(step));
    assert.equal(steps.length, 1);
    assert.deepEqual(seen, steps);
    assert.equal(steps[0].node, "llm");
    assert.equal(steps[0].inputTokens, 1288);
    assert.equal(steps[0].outputTokens, 14);
    assert.match(steps[0].detail, /search_documents/);
  });

  test("a node without a model message has no tokens", () => {
    const toolResult = new ToolMessage({ content: "ok", tool_call_id: "call_1", name: "calculate" });
    const step = makeStep("tools", [toolResult], Date.now());
    assert.equal(step.inputTokens, 0);
    assert.equal(step.outputTokens, 0);
  });

  test("a pause (__interrupt__) is not a step", () => {
    const steps: Step[] = [];
    handleNodeUpdate({ __interrupt__: [{ value: { calls: [] } }] }, newProgress(), steps);
    assert.equal(steps.length, 0);
  });

  test("a node that returned nothing still counts as a step", () => {
    const steps: Step[] = [];
    handleNodeUpdate({ approve: undefined }, newProgress(), steps);
    assert.equal(steps.length, 1);
    assert.equal(steps[0].node, "approve");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();

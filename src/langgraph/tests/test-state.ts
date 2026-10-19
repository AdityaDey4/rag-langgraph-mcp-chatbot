// Tests for AgentState and its reducers:  npm run test:langgraph-state
// Fake nodes return updates the way callModel does, so no model and no network.

import assert from "node:assert/strict";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { END, START, StateGraph, addMessages } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import * as z from "zod";
import { AgentState } from "../state";

let passed = 0;
let failed = 0;

// Example: prints "  ok   <name>", or "  FAIL <name>" plus the error
async function test(name: string, fn: () => void | Promise<void>) {
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

// Example: runs every test, then prints "7 passed, 0 failed"
async function main() {
  // Two nodes, each returning one update. The reducers merge them into the state.
  const graph = new StateGraph(AgentState)
    .addNode("first", async () => ({ messages: [new AIMessage("one")], searchCount: 1, searchQueries: ["kafka"], lastAnswer: "one" }))
    .addNode("second", async () => ({ messages: [new AIMessage("two")], searchCount: 2, searchQueries: ["redis"], lastAnswer: "two" }))
    .addEdge(START, "first")
    .addEdge("first", "second")
    .addEdge("second", END)
    .compile();

  const state = await graph.invoke({ messages: [new HumanMessage("question")] });

  console.log("each field is merged by its reducer");

  await test("messages: appended after the earlier ones", () => {
    assert.deepEqual(state.messages.map((m) => m.content), ["question", "one", "two"]);
  });

  await test("searchCount: added up (1 + 2 = 3)", () => {
    assert.equal(state.searchCount, 3);
  });

  await test("searchQueries: joined into one list", () => {
    assert.deepEqual(state.searchQueries, ["kafka", "redis"]);
  });

  await test("lastAnswer: replaced by the newest value", () => {
    assert.equal(state.lastAnswer, "two");
  });

  await test("a field no node returns keeps its default", async () => {
    const onlyMessages = new StateGraph(AgentState)
      .addNode("only", async () => ({ messages: [new AIMessage("hello")] }))
      .addEdge(START, "only")
      .addEdge("only", END)
      .compile();

    const result = await onlyMessages.invoke({ messages: [new HumanMessage("hi")] });

    assert.equal(result.searchCount, 0);
    assert.deepEqual(result.searchQueries, []);
    assert.equal(result.toolErrors, 0);
    assert.equal(result.lastAnswer, "");
  });

  console.log("messages");

  await test("a message with the SAME id replaces the old one instead of being added", () => {
    const existing = [new HumanMessage({ content: "hi", id: "a" }), new AIMessage({ content: "draft", id: "b" })];

    const result = addMessages(existing, [new AIMessage({ content: "final", id: "b" })]);

    assert.equal(result.length, 2);
    assert.equal(result[1].content, "final");
  });

  await test("a ToolMessage points back to the AI message that asked for it, by tool_call_id", async () => {
    const quick = tool(async () => "ok", { name: "quick", description: "returns ok", schema: z.object({}) });
    const ask = new AIMessage({ content: "", tool_calls: [{ id: "call_1", name: "quick", args: {} }] });

    const result = await new ToolNode([quick]).invoke({ messages: [ask] });
    const answer = result.messages[0];

    assert.ok(answer instanceof ToolMessage);
    assert.equal(answer.tool_call_id, "call_1");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});

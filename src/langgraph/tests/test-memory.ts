// Tests for persistence (Phase 4):  npm run test:langgraph-memory
// No model and no network: a one-node graph with the same state and a MemorySaver stands in for the agent.

import assert from "node:assert/strict";
import { HumanMessage, AIMessage, ToolMessage, trimMessages } from "@langchain/core/messages";
import { MemorySaver, StateGraph, START, END } from "@langchain/langgraph";
import { MAX_MESSAGES, messagesForModel } from "../agent";
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

// The fake "agent" answers with how many messages it can see, and pretends one tool failed.
const graph = new StateGraph(AgentState)
  .addNode("reply", (state: typeof AgentState.State) => ({
    messages: [new AIMessage(`I see ${state.messages.length} messages`)],
    toolErrors: state.toolErrors + 1,
  }))
  .addEdge(START, "reply")
  .addEdge("reply", END)
  .compile({ checkpointer: new MemorySaver() });

// Example: ask("a", "hi") returns the state after the run, e.g. { messages: [human, ai], toolErrors: 1, … }
const ask = (thread: string, text: string) =>
  graph.invoke({ messages: [new HumanMessage(text)], toolErrors: 0 }, { configurable: { thread_id: thread } });

// Example: runs every test, then prints "5 passed, 0 failed"
async function main() {
  console.log("persistence with a checkpointer");

  await test("a follow-up in the same thread sees the earlier messages", async () => {
    await ask("t1", "first");
    const second = await ask("t1", "second");
    assert.equal(second.messages.length, 4); // first, reply, second, reply
    assert.equal(second.lastAnswer, "");
  });

  await test("a different thread starts empty", async () => {
    const other = await ask("t2", "hello");
    assert.equal(other.messages.length, 2);
  });

  await test("getState returns what the thread saved", async () => {
    const saved = await graph.getState({ configurable: { thread_id: "t1" } });
    assert.equal(saved.values.messages.length, 4);
  });

  await test("sending toolErrors: 0 with each question resets the counter", async () => {
    const result = await ask("t1", "third");
    assert.equal(result.toolErrors, 1); // not 3
  });

  await test("trimMessages keeps the last messages and starts on a human message", async () => {
    const history = [new HumanMessage("q1"), new AIMessage("a1"), new HumanMessage("q2"), new AIMessage("a2")];
    const kept = await trimMessages(history, { strategy: "last", maxTokens: 3, tokenCounter: (list) => list.length, startOn: "human" });
    assert.deepEqual(kept.map((message) => message.content), ["q2", "a2"]);
  });

  console.log("\nwhat the model is sent (messagesForModel)");

  const toolRound = (id: string) => [
    new AIMessage({ content: "", tool_calls: [{ id, name: "calculate", args: {}, type: "tool_call" }] }),
    new ToolMessage({ content: "result", tool_call_id: id }),
  ];

  await test("a question that needs many tool rounds is sent whole, never trimmed away", async () => {
    const rounds = Array.from({ length: MAX_MESSAGES }, (_, n) => toolRound(`r${n}`)).flat(); // far more messages than the limit
    const saved = [new HumanMessage("q"), ...rounds];
    assert.ok(saved.length > MAX_MESSAGES);
    assert.equal((await messagesForModel(saved)).length, saved.length);
  });

  await test("earlier questions are trimmed from the front, and the current one is kept", async () => {
    const earlier = Array.from({ length: 10 }, (_, n) => [new HumanMessage(`q${n}`), ...toolRound(`e${n}`), new AIMessage(`a${n}`)]).flat(); // 40 messages
    const sent = await messagesForModel([...earlier, new HumanMessage("current")]);
    assert.ok(sent.length <= MAX_MESSAGES + 1);
    assert.equal(sent[0].getType(), "human"); // never starts inside a tool call
    assert.notEqual(sent[0].content, "q0"); // the oldest question was dropped
    assert.equal(sent.at(-1)?.content, "current");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();

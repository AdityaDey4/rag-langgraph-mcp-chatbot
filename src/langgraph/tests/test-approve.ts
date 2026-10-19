// Tests for human approval (approve.ts):  npm run test:langgraph-approve
// No model and no network: a fake node asks for tools, then the real approve step and the real tools node run.

import assert from "node:assert/strict";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { Command, END, interrupt, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { afterApprove, approve } from "../approve";
import { AgentState } from "../state";
import { runTools } from "../tool-node";

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

const email = {
  id: "call_mail",
  name: "send_email",
  args: { to: "ana@example.com", subject: "Hi", body: "Hello" },
  type: "tool_call" as const,
};
const sum = {
  id: "call_sum",
  name: "calculate",
  args: { expression: "1 + 1" },
  type: "tool_call" as const,
};

// The fake model: always asks for the tools it is given. A rejection routes to "done" instead of back to a real model.
function buildGraph(calls: (typeof email | typeof sum)[]) {
  return new StateGraph(AgentState)
    .addNode("ask", () => ({ messages: [new AIMessage({ content: "", tool_calls: calls })] }))
    .addNode("approve", approve)
    .addNode("tools", runTools)
    .addNode("done", () => ({}))
    .addEdge(START, "ask")
    .addEdge("ask", "approve")
    .addConditionalEdges("approve", afterApprove, { tools: "tools", llm: "done" })
    .addEdge("tools", END)
    .addEdge("done", END)
    .compile({ checkpointer: new MemorySaver() });
}

let threadNumber = 0;
// Example: start(graph) returns the config of a new thread after running it until it pauses or ends
async function start(graph: ReturnType<typeof buildGraph>) {
  const config = { configurable: { thread_id: `t${threadNumber++}` } };
  await graph.invoke({ messages: [new HumanMessage("send it")] }, config);
  return config;
}

// Example: toolMessages(state) returns the ToolMessages that the thread has saved so far
async function toolMessages(graph: ReturnType<typeof buildGraph>, config: { configurable: { thread_id: string } }) {
  const saved = await graph.getState(config);
  const messages: unknown[] = saved.values.messages;

  return messages.filter((message) => message instanceof ToolMessage) as ToolMessage[];
}

// Example: runs every test, then prints "6 passed, 0 failed"
async function main() {
  console.log("pausing for approval");

  await test("a risky tool pauses the run before it runs; nothing has been executed yet", async () => {
    const graph = buildGraph([email]);
    const config = await start(graph);
    const state = await graph.getState(config);
    assert.deepEqual(state.next, ["approve"]);
    assert.equal(state.tasks[0].interrupts[0].value.calls[0].name, "send_email");
    assert.equal((await toolMessages(graph, config)).length, 0);
  });

  await test("a safe tool does not pause", async () => {
    const graph = buildGraph([sum]);
    const config = await start(graph);
    assert.deepEqual((await graph.getState(config)).next, []);
    assert.equal((await toolMessages(graph, config)).length, 1);
  });

  console.log("resuming");

  await test("approved: the tool runs after the resume", async () => {
    const graph = buildGraph([email]);
    const config = await start(graph);
    await graph.invoke(new Command({ resume: { approve: true } }), config);
    const [result] = await toolMessages(graph, config);
    assert.equal(result.status, "success");
    assert.match(String(result.content), /ana@example.com/);
  });

  await test("rejected: every call gets a rejection message and nothing runs", async () => {
    const graph = buildGraph([email, sum]);
    const config = await start(graph);
    await graph.invoke(new Command({ resume: { approve: false } }), config);
    const results = await toolMessages(graph, config);
    assert.deepEqual(results.map((message) => message.tool_call_id), ["call_mail", "call_sum"]);
    for (const message of results) {
      assert.equal(message.status, "error");
      assert.match(String(message.content), /rejected/);
    }
  });

  await test("edited: the tool runs with the new arguments, and the original message is replaced, not duplicated", async () => {
    const graph = buildGraph([email]);
    const config = await start(graph);
    const decision = { approve: true, args: { to: "bob@example.com" } };
    await graph.invoke(new Command({ resume: decision }), config);

    const saved = await graph.getState(config);
    const aiMessages = saved.values.messages.filter((message: unknown) => message instanceof AIMessage);
    assert.equal(aiMessages.length, 1);
    assert.equal(aiMessages[0].tool_calls[0].args.to, "bob@example.com");

    const [result] = await toolMessages(graph, config);
    assert.match(String(result.content), /bob@example.com/);
  });

  await test("the node restarts from its top on resume, so code before interrupt() runs twice", async () => {
    let timesStarted = 0;
    const graph = new StateGraph(AgentState)
      .addNode("step", () => {
        timesStarted++;
        interrupt("wait");
        return {};
      })
      .addEdge(START, "step")
      .addEdge("step", END)
      .compile({ checkpointer: new MemorySaver() });
    const config = { configurable: { thread_id: "counter" } };
    await graph.invoke({ messages: [] }, config);
    assert.equal(timesStarted, 1);
    await graph.invoke(new Command({ resume: "ok" }), config);
    assert.equal(timesStarted, 2);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();

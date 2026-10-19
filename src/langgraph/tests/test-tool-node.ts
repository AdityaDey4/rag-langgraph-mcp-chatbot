// Tests for the tools node and the give-up logic (tool-node.ts):  npm run test:langgraph-tool-node
// No model and no network: the "state" is built by hand, as if the model had just asked for tools.

import assert from "node:assert/strict";
import { AIMessage } from "@langchain/core/messages";
import type { ToolCall } from "@langchain/core/messages/tool";
import type { AgentState } from "../state";
import { MAX_TOOL_ERRORS, afterTools, giveUp, runTools } from "../tool-node";

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

// Example: askFor(call("a", "calculate", { expression: "1 + 1" })) returns a state whose last message is an AI message asking for that tool
function askFor(...calls: ToolCall[]): typeof AgentState.State {
  const ask = new AIMessage({ content: "", tool_calls: calls });
  return { messages: [ask], searchCount: 0, searchQueries: [], toolErrors: 0, lastAnswer: "" };
}

// Example: call("a", "calculate", { expression: "1 + 1" }) returns { id: "a", name: "calculate", args: { expression: "1 + 1" }, type: "tool_call" }
function call(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { id, name, args, type: "tool_call" };
}

// Example: runs every test, then prints "8 passed, 0 failed"
async function main() {
  console.log("running the tools the model asked for");

  await test("a call that works gives a success message with the same id", async () => {
    const { messages, toolErrors } = await runTools(askFor(call("call_1", "calculate", { expression: "2 + 2" })));

    assert.equal(messages[0].status, "success");
    assert.equal(messages[0].tool_call_id, "call_1");
    assert.match(String(messages[0].content), /2 \+ 2 = 4/);
    assert.equal(toolErrors, 0);
  });

  await test("two calls in one reply give two messages, each with its own id, in the same order", async () => {
    const { messages } = await runTools(
      askFor(call("first", "calculate", { expression: "1 + 1" }), call("second", "calculate", { expression: "5 * 5" }))
    );

    assert.deepEqual(messages.map((m) => m.tool_call_id), ["first", "second"]);
    assert.match(String(messages[0].content), /= 2/);
    assert.match(String(messages[1].content), /= 25/);
  });

  console.log("when a tool fails");

  await test("a tool that throws becomes an error message, and the model is told what it may do next", async () => {
    const { messages } = await runTools(askFor(call("call_1", "calculate", { expression: "1 / 0" })));

    assert.equal(messages[0].status, "error");
    assert.equal(messages[0].tool_call_id, "call_1");
    assert.match(String(messages[0].content), /Division by zero/);
    assert.match(String(messages[0].content), /fix the arguments and try again, or explain/);
  });

  await test("invalid arguments become an error message that names the wrong field", async () => {
    const { messages } = await runTools(askFor(call("call_1", "calculate", { expression: 5 })));

    assert.equal(messages[0].status, "error");
    assert.match(String(messages[0].content), /expression/);
  });

  await test("an unknown tool name becomes an error message listing the real tools", async () => {
    const { messages } = await runTools(askFor(call("call_1", "delete_database", {})));

    assert.equal(messages[0].status, "error");
    assert.match(String(messages[0].content), /no tool called "delete_database"/);
    assert.match(String(messages[0].content), /calculate/);
  });

  await test("one failure does not stop the other calls, and toolErrors counts only the failed ones", async () => {
    const { messages, toolErrors } = await runTools(
      askFor(call("good", "calculate", { expression: "3 * 3" }), call("bad", "calculate", { expression: "1 / 0" }))
    );

    assert.deepEqual(messages.map((m) => m.status), ["success", "error"]);
    assert.equal(toolErrors, 1);
  });

  console.log("giving up");

  await test("after the tools run, it goes back to the model until MAX_TOOL_ERRORS calls have failed", () => {
    assert.equal(afterTools({ ...askFor(), toolErrors: MAX_TOOL_ERRORS - 1 }), "llm");
    assert.equal(afterTools({ ...askFor(), toolErrors: MAX_TOOL_ERRORS }), "giveUp");
  });

  await test("giveUp answers with a message saying how many calls failed", () => {
    const { messages, lastAnswer } = giveUp({ ...askFor(), toolErrors: 3 });

    assert.match(lastAnswer, /3 tool calls failed/);
    assert.equal(messages[0].content, lastAnswer);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});

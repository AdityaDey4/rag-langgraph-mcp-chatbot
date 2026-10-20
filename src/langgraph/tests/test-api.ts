// Tests for the API logic (api.ts), the idempotent email tool and the saved checkpoints:  npm run test:langgraph-api
// No model and no network: a fake agent stands in for the real one.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { handleRequest } from "../api";
import { sendEmail } from "../tools/send-email";

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

const steps = [{ node: "llm", detail: "", ms: 5, inputTokens: 100, outputTokens: 10 }];

// Example: fakeAgent({ answer: "Hi" }) returns an agent whose run() gives that result (a function can be given to make it fail or wait)
function fakeAgent(result: unknown, waiting = false) {
  const calls = { run: 0, resume: 0 };

  const agent = {
    run: async () => {
      calls.run++;
      return typeof result === "function" ? result() : result;
    },
    resume: async () => {
      calls.resume++;
      return typeof result === "function" ? result() : result;
    },
    isWaiting: async () => waiting,
  };

  // The tests only use the parts above.
  return { agent: agent as never, calls };
}

// Example: runs every test, then prints "18 passed, 0 failed"
async function main() {
  console.log("normal request");

  await test("a question gets an answer, a new threadId and a requestId", async () => {
    const { agent } = fakeAgent({ answer: "Kafka is a log.", steps });
    const response = await handleRequest({ question: "What is Kafka?" }, agent);

    assert.equal(response.status, 200);
    assert.equal(response.body.status, "answered");
    assert.equal(response.body.answer, "Kafka is a log.");
    assert.ok(response.body.threadId);
    assert.ok(response.body.requestId);
  });

  await test("a given threadId is used as it is", async () => {
    const { agent } = fakeAgent({ answer: "ok", steps });
    const response = await handleRequest({ question: "Hi", threadId: "my-thread_1" }, agent);

    assert.equal(response.body.threadId, "my-thread_1");
  });

  console.log("incorrect requests");

  const badBodies: [string, unknown][] = [
    ["no body fields", {}],
    ["not an object", "hello"],
    ["an empty question", { question: "   " }],
    ["a question that is too long", { question: "x".repeat(2001) }],
    ["a threadId with strange characters", { question: "Hi", threadId: "../../etc/passwd" }],
    ["a question and a decision together", { question: "Hi", threadId: "t", decision: { approve: true } }],
    ["a decision without a threadId", { decision: { approve: true } }],
    ["a decision that is not true or false", { threadId: "t", decision: { approve: "yes" } }],
  ];

  for (const [name, body] of badBodies) {
    await test(`${name} gives 400 and the agent is not called`, async () => {
      const { agent, calls } = fakeAgent({ answer: "should not run", steps });
      const response = await handleRequest(body, agent);

      assert.equal(response.status, 400);
      assert.ok(response.body.error);
      assert.equal(calls.run + calls.resume, 0);
    });
  }

  console.log("approval");

  await test("a run that needs approval says so, with the calls to approve", async () => {
    const approval = { calls: [{ name: "send_email", args: { to: "ana@example.com" } }] };
    const { agent } = fakeAgent({ approval, steps });
    const response = await handleRequest({ question: "Email Ana" }, agent);

    assert.equal(response.status, 200);
    assert.equal(response.body.status, "needs_approval");
    assert.deepEqual(response.body.approval, approval);
  });

  await test("a decision for a run that is waiting continues it", async () => {
    const { agent, calls } = fakeAgent({ answer: "Sent.", steps }, true);
    const response = await handleRequest({ threadId: "t1", decision: { approve: true } }, agent);

    assert.equal(response.status, 200);
    assert.equal(calls.resume, 1);
  });

  await test("a decision for a thread that is not waiting gives 409", async () => {
    const { agent, calls } = fakeAgent({ answer: "should not run", steps }, false);
    const response = await handleRequest({ threadId: "t1", decision: { approve: true } }, agent);

    assert.equal(response.status, 409);
    assert.equal(calls.resume, 0);
  });

  console.log("failures");

  await test("a crash gives 500 and the details stay in the server log", async () => {
    const { agent } = fakeAgent(() => {
      throw new Error("secret database password");
    });
    const error = console.error;
    console.error = () => {};
    const response = await handleRequest({ question: "Hi" }, agent);
    console.error = error;

    assert.equal(response.status, 500);
    assert.doesNotMatch(JSON.stringify(response.body), /secret/);
  });

  await test("a run that takes too long gives 504", async () => {
    const { agent } = fakeAgent(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { answer: "too late", steps };
    });
    const response = await handleRequest({ question: "Hi" }, agent, 50);

    assert.equal(response.status, 504);
  });

  await test("an empty answer gives 502", async () => {
    const { agent } = fakeAgent({ answer: "  ", steps });
    const response = await handleRequest({ question: "Hi" }, agent);

    assert.equal(response.status, 502);
  });

  console.log("idempotency and saved checkpoints");

  await test("the same send_email tool call does not send twice", async () => {
    const call = { id: "call_same", name: "send_email", args: { to: "ana@example.com", subject: "Hi", body: "Yo" }, type: "tool_call" as const };
    const sent: string[] = [];
    const original = console.log;
    console.log = (text: string) => sent.push(text);

    const first = await sendEmail.invoke(call);
    const second = await sendEmail.invoke(call);
    console.log = original;

    assert.equal(sent.length, 1);
    assert.match(String(first.content), /Email sent/);
    assert.match(String(second.content), /already sent/);
  });

  await test("a conversation saved in the SQLite file is still there for a new graph (a restart)", async () => {
    const file = path.join(os.tmpdir(), `langgraph-test-${Date.now()}.db`);
    const State = Annotation.Root({
      count: Annotation<number>({ reducer: (current, update) => current + update, default: () => 0 }),
    });

    // Each call builds a new graph with a new connection to the same file, like a new process would.
    const build = () =>
      new StateGraph(State)
        .addNode("add", () => ({ count: 1 }))
        .addEdge(START, "add")
        .addEdge("add", END)
        .compile({ checkpointer: SqliteSaver.fromConnString(file) });

    const config = { configurable: { thread_id: "thread" } };
    await build().invoke({}, config);
    const afterRestart = await build().invoke({}, config);

    assert.equal(afterRestart.count, 2);

    // The file stays locked on Windows until the process ends, so a failed delete is fine.
    try {
      fs.rmSync(file, { force: true });
    } catch {}
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();

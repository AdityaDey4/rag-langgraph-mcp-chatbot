// A small check of the real agent through the API logic:  npm run test:langgraph-eval
// It calls the real model and Qdrant (a few cents), so it is skipped when they are not available.
// Run it again after every change to the prompt, the tools or the graph, to see that nothing got worse.

import assert from "node:assert/strict";
import "../config";
import { handleRequest } from "../api";
import { listDocuments } from "../retrieval";

let passed = 0;
let failed = 0;

// 1. Run one scenario and print how long it took.
// Example: prints "  ok   normal question (7.1 s)", or "  FAIL …" plus the error
async function scenario(name: string, fn: () => Promise<void>) {
  const startedAt = Date.now();

  try {
    await fn();
    passed++;
    console.log(`  ok   ${name} (${((Date.now() - startedAt) / 1000).toFixed(1)} s)`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(error);
  }
}

async function main() {
  // 2. Skip when the model or the documents are not available.
  if (!process.env.OPENAI_API_KEY) {
    console.log("skipped: OPENAI_API_KEY is not set");
    return;
  }

  try {
    await listDocuments();
  } catch {
    console.log("skipped: Qdrant is not available");
    return;
  }

  console.log("real agent through the API");

  await scenario("normal question: answered, with a citation", async () => {
    const response = await handleRequest({ question: "What is Kafka? Answer in one sentence." });

    assert.equal(response.status, 200);
    assert.equal(response.body.status, "answered");
    assert.match(String(response.body.answer), /\[[0-9a-f-]{36}\]/); // a chunk id in square brackets
  });

  await scenario("a greeting is answered without using a tool", async () => {
    const response = await handleRequest({ question: "Hi, how are you?" });

    assert.equal(response.status, 200);
    assert.equal(response.body.status, "answered");
    assert.doesNotMatch(String(response.body.answer), /\[[0-9a-f-]{36}\]/);
  });

  await scenario("a failed tool (unknown chunk id) is recovered from", async () => {
    const response = await handleRequest({
      question: "Show me the passage with chunk id abc123, and if that does not work tell me what Kafka is",
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.status, "answered");
    assert.match(String(response.body.answer), /kafka/i);
    assert.doesNotMatch(String(response.body.answer), /step limit/);
  });

  await scenario("a risky tool waits for approval; a rejection means nothing is sent", async () => {
    const asked = await handleRequest({ question: "Send an email to ana@example.com with subject Hi and body Yo" });

    assert.equal(asked.status, 200);
    assert.equal(asked.body.status, "needs_approval");
    assert.deepEqual((asked.body.approval as { calls: { name: string }[] }).calls.map((call) => call.name), ["send_email"]);

    const threadId = String(asked.body.threadId);
    const rejected = await handleRequest({ threadId, decision: { approve: false } });

    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.status, "answered");

    // The same decision cannot be sent twice.
    const again = await handleRequest({ threadId, decision: { approve: true } });
    assert.equal(again.status, 409);
  });

  await scenario("a conversation continues on the same thread", async () => {
    const first = await handleRequest({ question: "What is 12 * 12?" });
    const second = await handleRequest({ question: "Now add 6 to that.", threadId: String(first.body.threadId) });

    assert.equal(second.status, 200);
    assert.match(String(second.body.answer), /150/);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();

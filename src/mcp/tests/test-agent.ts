// A check of the MCP agent with the real model and the real documents:  npm run test:mcp-agent
// It needs Qdrant and an OpenAI key (a few cents), so it is skipped when they are not available.
// The agent starts our MCP server as a subprocess and uses only the tools that the server lists.

import assert from "node:assert/strict";
import { createMcpAgent } from "../agent";
import "../config"; // loads .env, so that the OpenAI key can be seen

let passed = 0;
let failed = 0;

// Example: prints "  ok   <name> (7.1 s)", or "  FAIL <name>" plus the error
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

// Example: qdrantIsUp() returns true when Qdrant answers on its default port and an OpenAI key is set
async function qdrantIsUp() {
  if (!process.env.OPENAI_API_KEY) return false;

  try {
    const response = await fetch("http://localhost:6333/collections", { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await qdrantIsUp())) {
    console.log("skipped: Qdrant or the OpenAI key is not available");
    return;
  }

  process.env.MCP_LOG = "off"; // no log lines in the test output (run npm run mcp:agent to see them)
  console.log("the MCP agent with the real model");
  const agent = await createMcpAgent();

  try {
    await scenario("it finds the three tools on the server", async () => {
      assert.deepEqual([...agent.toolNames].sort(), ["get_chunk", "list_documents", "search_documents"]);
    });

    await scenario("a document question: it searches through the server and cites a passage", async () => {
      const run = await agent.ask("What is Kafka? Answer in one sentence.");

      assert.ok(run.toolCalls.some((call) => call.name === "search_documents" && !call.isError));
      assert.match(run.answer, /\[[0-9a-f-]{36}\]/); // a chunk id in square brackets
    });

    await scenario("a greeting is answered without a tool", async () => {
      const run = await agent.ask("Hi, how are you?");

      assert.equal(run.toolCalls.length, 0);
      assert.ok(run.answer.length > 0);
    });

    await scenario("a question about which documents exist uses list_documents", async () => {
      const run = await agent.ask("Which documents do you have?");

      assert.ok(run.toolCalls.some((call) => call.name === "list_documents"));
      assert.match(run.answer, /school\.pdf/i);
    });

    await scenario("a failed tool (unknown chunk id) is recovered from: the agent still answers", async () => {
      const run = await agent.ask("Show me the passage with chunk id abc123, and if that does not work tell me what Kafka is");

      assert.ok(run.toolCalls.some((call) => call.name === "get_chunk" && call.isError));
      assert.match(run.answer, /kafka/i);
      assert.doesNotMatch(run.answer, /step limit/);
    });
  } finally {
    await agent.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();

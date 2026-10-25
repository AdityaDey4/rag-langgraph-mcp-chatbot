// Tests for the client (src/mcp/client.ts) with our real server as a subprocess:  npm run test:mcp-client
// Nothing here needs Qdrant or OpenAI.

import assert from "node:assert/strict";
import { loadTools } from "../adapter";
import { connectToServer } from "../client";

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

// Example: runs every test, then prints "6 passed, 0 failed"
async function main() {
  process.env.MCP_LOG = "off"; // no log lines in the test output
  console.log("connecting to our own server");

  await test("the client starts the server, lists its tools and the adapter makes tools from them", async () => {
    const client = await connectToServer();
    const tools = await loadTools(client);
    await client.close();

    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["get_chunk", "list_documents", "search_documents"]);
  });

  await test("a call with a missing argument is refused by the tool itself, before it reaches the server", async () => {
    const client = await connectToServer();
    const tools = await loadTools(client);
    const search = tools.find((tool) => tool.name === "search_documents")!;

    await assert.rejects(search.invoke({}), /did not match expected schema/);
    await client.close();
  });

  await test("a call that the server answers with isError is thrown with the server's message", async () => {
    const client = await connectToServer();
    const tools = await loadTools(client);
    const getChunk = tools.find((tool) => tool.name === "get_chunk")!;

    // An id that does not exist: "No passage found…" with Qdrant, "fetch failed" without it. Both start with "Error:".
    await assert.rejects(getChunk.invoke({ chunkId: "00000000-0000-4000-8000-000000000000" }), /^Error: /);
    await client.close();
  });

  console.log("a server that cannot be started or that stops");

  await test("a command that does not exist makes connect() throw", async () => {
    await assert.rejects(connectToServer({ command: "this-command-does-not-exist", args: [] }));
  });

  await test("a server that exits at once makes connect() throw", async () => {
    await assert.rejects(connectToServer({ command: process.execPath, args: ["-e", "process.exit(0)"] }));
  });

  await test("a call after the connection was closed fails, it does not hang", async () => {
    const client = await connectToServer();
    const tools = await loadTools(client);
    await client.close();

    const list = tools.find((tool) => tool.name === "list_documents")!;
    const hung = new Promise((_, reject) => setTimeout(() => reject(new Error("hung")), 5000));

    // It must fail with an error of its own, not be stopped by the 5 second timer.
    await assert.rejects(Promise.race([list.invoke({}), hung]), (error: Error) => error.message !== "hung");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();

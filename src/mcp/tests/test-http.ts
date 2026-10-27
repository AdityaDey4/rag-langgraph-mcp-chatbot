// Tests for the MCP server over HTTP (src/mcp/http-server.ts):  npm run test:mcp-http
// The server runs in this process on a free port. The checks are made with plain HTTP requests, the working call with the SDK client.
// Nothing here needs Qdrant or OpenAI.

import assert from "node:assert/strict";
import http from "node:http";
import { loadTools } from "../adapter";
import { connectToServer } from "../client";
import { startHttpServer } from "../http-server";

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

const TOKEN = "a-long-secret-token-for-the-tests";

// Example: post(url, { authorization: "Bearer …" }) returns the status code of a POST with these headers and a small body.
// node:http is used because it lets us set the Host and Origin headers, which fetch does not.
function post(url: string, headers: Record<string, string>, body = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}', method = "POST"): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers } }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end(body);
  });
}

// Example: runs every test, then prints "11 passed, 0 failed"
async function main() {
  process.env.MCP_LOG = "off"; // no log lines in the test output

  const server = await startHttpServer({ port: 0, token: TOKEN });
  const port = new URL(server.url).port;

  console.log("who may call the server");

  await test("a request without a token is refused with 401", async () => {
    assert.equal(await post(server.url, {}), 401);
  });

  await test("a request with a wrong token is refused with 401", async () => {
    assert.equal(await post(server.url, { authorization: "Bearer not-the-token" }), 401);
    assert.equal(await post(server.url, { authorization: TOKEN }), 401); // the word "Bearer" is missing
  });

  await test("a request with a Host that is not this computer is refused with 403, even with the right token", async () => {
    assert.equal(await post(server.url, { authorization: `Bearer ${TOKEN}`, host: "evil.example.com" }), 403);
  });

  await test("a request from a web page on another site (an Origin header) is refused with 403, even with the right token", async () => {
    assert.equal(await post(server.url, { authorization: `Bearer ${TOKEN}`, origin: "https://evil.example.com" }), 403);
  });

  await test("an address other than /mcp is not found", async () => {
    assert.equal(await post(`http://127.0.0.1:${port}/other`, { authorization: `Bearer ${TOKEN}` }), 404);
  });

  await test("a request with a body of more than 64 KB is refused with 413", async () => {
    const hugeBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { padding: "x".repeat(100_000) } });

    assert.equal(await post(server.url, { authorization: `Bearer ${TOKEN}` }, hugeBody), 413);
  });

  await test("a request with the right token gets past the checks (it is answered by the MCP part, not refused)", async () => {
    const status = await post(server.url, { authorization: `Bearer ${TOKEN}` });

    assert.ok(![401, 403, 404, 413].includes(status), `status ${status}`);
  });

  console.log("a client that calls it");

  await test("the SDK client with the right token connects, lists the three tools and the adapter makes tools from them", async () => {
    const client = await connectToServer({ url: server.url, token: TOKEN });
    const tools = await loadTools(client);
    await client.close();

    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["get_chunk", "list_documents", "search_documents"]);
  });

  await test("a tool call over HTTP reaches the real tool (a call with a missing argument is refused by the tool's own check)", async () => {
    const client = await connectToServer({ url: server.url, token: TOKEN });
    const result = await client.callTool({ name: "search_documents", arguments: {} });
    await client.close();

    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /query/);
  });

  await test("the SDK client with a wrong token, or with no token, cannot connect", async () => {
    await assert.rejects(connectToServer({ url: server.url, token: "not-the-token" }));
    await assert.rejects(connectToServer({ url: server.url }));
  });

  console.log("starting the server");

  await test("the server refuses to start with a token that is too short", async () => {
    await assert.rejects(startHttpServer({ port: 0, token: "short" }), /at least 16 characters/);
  });

  await server.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();

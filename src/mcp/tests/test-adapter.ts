// Tests for the adapter (src/mcp/adapter.ts):  npm run test:mcp-adapter
// No server and no network: a fake client plays the part of an MCP server.

import assert from "node:assert/strict";
import { loadTools, textOf, type ToolSource } from "../adapter";

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

// Example: makeClient(result) returns a fake client with one tool, "search_documents", whose calls are recorded and always answer with `result`
function makeClient(result: Awaited<ReturnType<ToolSource["callTool"]>>) {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];

  const client: ToolSource = {
    listTools: async () => ({
      tools: [
        {
          name: "search_documents",
          description: "Search the documents.",
          inputSchema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
        { name: "list_documents", inputSchema: { type: "object", properties: {} } },
      ],
    }),
    callTool: async (call) => {
      calls.push(call);
      return result;
    },
  };

  return { client, calls };
}

// Example: runs every test, then prints "9 passed, 0 failed"
async function main() {
  process.env.MCP_LOG = "off"; // no log lines in the test output
  console.log("the tools that are made");

  await test("there is one tool for every tool the server lists, with its name and description", async () => {
    const { client } = makeClient({ content: [] });
    const tools = await loadTools(client);

    assert.deepEqual(tools.map((tool) => tool.name), ["search_documents", "list_documents"]);
    assert.equal(tools[0].description, "Search the documents.");
  });

  await test("a tool without a description gets an empty one", async () => {
    const { client } = makeClient({ content: [] });
    const tools = await loadTools(client);

    assert.equal(tools[1].description, "");
  });

  await test("the input schema is passed on, without the $schema line", async () => {
    const { client } = makeClient({ content: [] });
    const [search] = await loadTools(client);
    const schema = search.schema as Record<string, unknown>;

    assert.equal(schema.type, "object");
    assert.deepEqual(schema.required, ["query"]);
    assert.equal("$schema" in schema, false);
  });

  console.log("calling a tool");

  await test("a call sends the tool name and the arguments to the server and returns the text", async () => {
    const { client, calls } = makeClient({ content: [{ type: "text", text: "Kafka is a log." }] });
    const [search] = await loadTools(client);

    const result = await search.invoke({ query: "Kafka" });

    assert.deepEqual(calls, [{ name: "search_documents", arguments: { query: "Kafka" } }]);
    assert.equal(result, "Kafka is a log.");
  });

  await test("a failed call (isError) is thrown with the server's message", async () => {
    const { client } = makeClient({ content: [{ type: "text", text: "Error: No passage found." }], isError: true });
    const [search] = await loadTools(client);

    await assert.rejects(search.invoke({ query: "Kafka" }), /No passage found/);
  });

  await test("a server that cannot be reached makes the call fail", async () => {
    const client: ToolSource = {
      listTools: async () => ({ tools: [{ name: "search_documents", inputSchema: { type: "object", properties: {} } }] }),
      callTool: async () => {
        throw new Error("connection closed");
      },
    };
    const [search] = await loadTools(client);

    await assert.rejects(search.invoke({}), /connection closed/);
  });

  console.log("the text of a result");

  await test("several text blocks are joined with a new line", () => {
    assert.equal(textOf({ content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] }), "one\ntwo");
  });

  await test("a block that is not text is only named", () => {
    assert.equal(textOf({ content: [{ type: "text", text: "see" }, { type: "image" }] }), "see\n[image content]");
  });

  await test("a result with no content gives an empty text", () => {
    assert.equal(textOf({}), "");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();

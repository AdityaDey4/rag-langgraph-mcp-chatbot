// Tests for the MCP server as a program (src/mcp/server.ts):  npm run test:mcp-server
// The server is started as a subprocess and used through the SDK client, like a host would use it.
// The two tests that need Qdrant and OpenAI are skipped when they are not available.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import "../config"; // loads .env, so that the OpenAI key can be seen

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

// 1. How the server is started: node runs the local tsx, and tsx runs server.ts. Absolute paths, like a host config.
const projectRoot = path.resolve(__dirname, "..", "..", "..");
const tsxCli = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
const serverFile = path.join(projectRoot, "src", "mcp", "server.ts");

// Example: connect() returns a client that is connected to a freshly started server
async function connect() {
  const client = new Client({ name: "test-server", version: "0.0.1" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [tsxCli, serverFile] });
  await client.connect(transport);
  return client;
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

// Example: runs every test, then prints "13 passed, 0 failed"
async function main() {
  console.log("what the server offers");

  await test("it lists the three document tools, each with a description and an input schema", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    await client.close();

    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["get_chunk", "list_documents", "search_documents"]);

    for (const tool of tools) {
      assert.ok((tool.description ?? "").length > 40, tool.name);
      assert.equal(tool.inputSchema.type, "object", tool.name);
    }

    const search = tools.find((tool) => tool.name === "search_documents");
    assert.deepEqual(search?.inputSchema.required, ["query"]);
  });

  console.log("what the server does with bad requests");

  await test("a call with a missing argument is an error result, not a crash", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "search_documents", arguments: {} });
    await client.close();

    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /query/);
  });

  await test("the server still answers after a bad call", async () => {
    const client = await connect();
    await client.callTool({ name: "search_documents", arguments: {} });
    const { tools } = await client.listTools();
    await client.close();

    assert.equal(tools.length, 3);
  });

  console.log("resources and prompts (no Qdrant needed)");

  await test("the server says it offers tools, resources and prompts", async () => {
    const client = await connect();
    const capabilities = client.getServerCapabilities();
    await client.close();

    assert.ok(capabilities?.tools, "tools");
    assert.ok(capabilities?.resources, "resources");
    assert.ok(capabilities?.prompts, "prompts");
  });

  await test("the section resources are offered as a template with one variable", async () => {
    const client = await connect();
    const { resourceTemplates } = await client.listResourceTemplates();
    await client.close();

    assert.deepEqual(resourceTemplates.map((template) => template.uriTemplate), ["rag://sections/{section}"]);
  });

  await test("the prompt is listed with its required argument", async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    await client.close();

    assert.deepEqual(prompts.map((prompt) => prompt.name), ["summarize_section"]);
    assert.deepEqual(prompts[0].arguments?.map((argument) => [argument.name, argument.required]), [["section", true]]);
  });

  await test("a prompt without its argument is refused, and so is an address that is not a resource", async () => {
    const client = await connect();

    await assert.rejects(client.getPrompt({ name: "summarize_section" }), /section/);
    await assert.rejects(client.readResource({ uri: "file:///etc/passwd" }), /not found/i);
    await client.close();
  });

  console.log("stdout is only for protocol messages");

  await test("a started server writes nothing to stdout, and its log line goes to stderr", async () => {
    const server = spawn(process.execPath, [tsxCli, serverFile]);
    let out = "";
    let err = "";
    server.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    server.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));

    // Wait until the server says it is running (at most 20 seconds), then a little longer to catch late writes.
    for (let waited = 0; waited < 20000 && !err.includes("running on stdio"); waited += 200) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    server.kill();

    assert.match(err, /running on stdio/);
    assert.equal(out, "");
  });

  console.log("with the real documents (skipped without Qdrant and OpenAI)");

  if (await qdrantIsUp()) {
    await test("list_documents returns the indexed document and its sections", async () => {
      const client = await connect();
      const result = await client.callTool({ name: "list_documents", arguments: {} });
      await client.close();

      assert.notEqual(result.isError, true);
      assert.match(JSON.stringify(result.content), /Kafka/);
    });

    await test("search_documents finds the Kafka passage, and get_chunk returns its full text", async () => {
      const client = await connect();
      const search = await client.callTool({ name: "search_documents", arguments: { query: "What is Kafka?", topK: 1 } });
      const text = JSON.stringify(search.content);
      const chunkId = text.match(/chunkId\\":\s*\\"([0-9a-f-]{36})/)?.[1];

      assert.ok(chunkId, "the result has a chunkId");

      const chunk = await client.callTool({ name: "get_chunk", arguments: { chunkId } });
      await client.close();

      assert.notEqual(chunk.isError, true);
      assert.match(JSON.stringify(chunk.content), /event-streaming/);
    });

    await test("the list of resources has the documents and one resource for each section", async () => {
      const client = await connect();
      const { resources } = await client.listResources();
      await client.close();

      const uris = resources.map((resource) => resource.uri);
      assert.ok(uris.includes("rag://documents"));
      assert.ok(uris.includes("rag://sections/Kafka"));
      assert.ok(uris.includes("rag://sections/DBMS"));
    });

    await test("reading the section DBMS returns both of its passages, and an unknown section is an error", async () => {
      const client = await connect();
      const result = await client.readResource({ uri: "rag://sections/DBMS" });
      const text = "text" in result.contents[0] ? result.contents[0].text : "";

      assert.match(text, /Database Management System/); // page 1
      assert.match(text, /system design/); // page 2
      await assert.rejects(client.readResource({ uri: "rag://sections/Nope" }), /No section called "Nope"/);
      await client.close();
    });

    await test("the prompt for n8n returns the instruction and the section text as an attached resource", async () => {
      const client = await connect();
      const result = await client.getPrompt({ name: "summarize_section", arguments: { section: "n8n" } });
      await client.close();

      assert.equal(result.messages.length, 2);
      assert.equal(result.messages[0].content.type, "text");
      assert.equal(result.messages[1].content.type, "resource");
      assert.match(JSON.stringify(result.messages[1].content), /workflow/);
    });
  } else {
    console.log("  skipped: Qdrant or the OpenAI key is not available");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();

// Tests for the safety rules with a real server process that misbehaves (tests/fake-server.ts):  npm run test:mcp-servers
// The client, the rules and the adapter are the real ones. No Qdrant and no OpenAI.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTools } from "../adapter";
import { connectToServer, type ServerCommand } from "../client";
import { makeSafeSource, type Approve, type ServerPolicy } from "../safety";

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

// How the fake server is started: node runs the local tsx, and tsx runs the file.
const projectRoot = path.resolve(__dirname, "..", "..", "..");
const fakeServer: ServerCommand = {
  command: process.execPath,
  args: [path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(__dirname, "fake-server.ts")],
};

const everything = ["echo", "injected", "hang", "huge", "show_env", "delete_note", "evil"];

// Example: withServer({ allow: ["echo"] }, no, async (tools) => { … }) starts the fake server behind these rules, gives the tools to the function, and stops the server afterwards
async function withServer(
  policy: Partial<ServerPolicy>,
  approve: Approve,
  fn: (tools: Awaited<ReturnType<typeof loadTools>>) => Promise<void>,
  server: ServerCommand = fakeServer,
) {
  const client = await connectToServer(server);

  try {
    const safe = makeSafeSource(client, { name: "fake", allow: everything, ...policy }, approve);
    await fn(await loadTools(safe));
  } finally {
    await client.close();
  }
}

// Example: toolNamed(tools, "echo") returns the tool with that name
const toolNamed = (tools: Awaited<ReturnType<typeof loadTools>>, name: string) => tools.find((tool) => tool.name === name)!;

const yes: Approve = async () => true;
const no: Approve = async () => false;

// Example: runs every test, then prints "8 passed, 0 failed"
async function main() {
  process.env.MCP_LOG = "off"; // no log lines in the test output
  const folder = mkdtempSync(path.join(os.tmpdir(), "mcp-safety-"));

  console.log("what the server may do");

  await test("a tool outside the allowlist is never offered to the model", async () => {
    await withServer({ allow: ["echo"] }, no, async (tools) => {
      assert.deepEqual(tools.map((tool) => tool.name), ["echo"]);
    });
  });

  await test("a hostile description is cut and its tags are removed before the model sees it", async () => {
    await withServer({ allow: ["evil"] }, no, async (tools) => {
      const [evil] = tools;

      assert.ok(evil.description.length <= 400);
      assert.doesNotMatch(evil.description, /<system>/);
    });
  });

  await test("a tool that changes things does not run when the person says no, and runs when the person says yes", async () => {
    const marker = path.join(folder, "marker.txt");

    await withServer({ needsApproval: ["delete_note"] }, no, async (tools) => {
      const result = await toolNamed(tools, "delete_note").invoke({ marker }).catch((error: Error) => error.message);

      assert.match(String(result), /rejected/);
      assert.equal(existsSync(marker), false); // the server never ran it
    });

    await withServer({ needsApproval: ["delete_note"] }, yes, async (tools) => {
      await toolNamed(tools, "delete_note").invoke({ marker });

      assert.equal(existsSync(marker), true);
    });
  });

  console.log("what the server says");

  await test("a result with instructions in it is wrapped as untrusted data and cannot close the wrapper", async () => {
    await withServer({}, no, async (tools) => {
      const result = String(await toolNamed(tools, "injected").invoke({}));

      assert.match(result, /^<tool_result tool="injected" untrusted="true">/);
      assert.equal(result.match(/<\/tool_result>/g)?.length, 1);
    });
  });

  await test("a result of 2 million characters is cut to the limit", async () => {
    await withServer({ maxOutputChars: 5000 }, no, async (tools) => {
      const result = String(await toolNamed(tools, "huge").invoke({}));

      assert.ok(result.length < 5500, `the result has ${result.length} characters`);
    });
  });

  console.log("what the server costs");

  await test("a tool that never answers is stopped after the time limit, with an error the model can read", async () => {
    await withServer({ timeoutMs: 1000 }, no, async (tools) => {
      const startedAt = Date.now();
      const message = await toolNamed(tools, "hang").invoke({}).then(() => "no error", (error: Error) => error.message);

      assert.match(message, /did not answer within 1 seconds/);
      assert.ok(Date.now() - startedAt < 4000);
    });
  });

  await test("after 3 calls that never answered, the server is not called again", async () => {
    await withServer({ timeoutMs: 300, maxFailures: 3 }, no, async (tools) => {
      const hang = toolNamed(tools, "hang");
      const messages: string[] = [];

      for (let i = 0; i < 4; i++) {
        messages.push(await hang.invoke({}).then(() => "no error", (error: Error) => error.message));
      }

      assert.match(messages[2], /did not answer/);
      assert.match(messages[3], /is not answering/); // the 4th call did not even wait
    });
  });

  console.log("what the server can see");

  await test("a server does not get our secrets from the environment, unless we give them on purpose", async () => {
    process.env.OPENAI_API_KEY = "sk-test-secret-for-this-test";

    await withServer({}, no, async (tools) => {
      assert.match(String(await toolNamed(tools, "show_env").invoke({})), /visible: no/);
    });

    await withServer({}, no, async (tools) => {
      assert.match(String(await toolNamed(tools, "show_env").invoke({})), /visible: yes/);
    }, { ...fakeServer, env: { OPENAI_API_KEY: "given on purpose" } });
  });

  rmSync(folder, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();

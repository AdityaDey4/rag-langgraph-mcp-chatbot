import assert from "node:assert/strict";
import { z } from "zod";
import { defineTool, ToolRegistry } from "../lib/agent/registry";
import { createDefaultRegistry } from "../lib/agent/tools";
import { evaluateExpression } from "../lib/agent/tools/calculate";
import { createGetCurrentDatetime } from "../lib/agent/tools/get-current-datetime";
import type { ToolContext } from "../lib/agent/types";

const ctx = (): ToolContext => ({
  runId: "test-run",
  signal: new AbortController().signal,
});

let passed = 0;
let failed = 0;

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

async function main() {
  console.log("calculate: evaluateExpression");

  await test("basic arithmetic and precedence", () => {
    assert.equal(evaluateExpression("1 + 2 * 3"), 7);
    assert.equal(evaluateExpression("(1 + 2) * 3"), 9);
    assert.equal(evaluateExpression("10 / 4"), 2.5);
    assert.equal(evaluateExpression("10 % 4"), 2);
    assert.equal(evaluateExpression("3 * 5 + 2"), 17);
  });

  await test("power is right-associative and binds tighter than unary minus", () => {
    assert.equal(evaluateExpression("2 ^ 3 ^ 2"), 512);
    assert.equal(evaluateExpression("-2 ^ 2"), -4);
    assert.equal(evaluateExpression("2 ^ -1"), 0.5);
  });

  await test("unary operators, decimals and floating-point noise", () => {
    assert.equal(evaluateExpression("-(3 + 4)"), -7);
    assert.equal(evaluateExpression("+5"), 5);
    assert.equal(evaluateExpression(".5 + 1.25"), 1.75);
    assert.equal(evaluateExpression("0.1 + 0.2"), 0.3);
  });

  await test("rejects bad input", () => {
    for (const bad of [
      "1 / 0",
      "5 % 0",
      "1 +",
      "(1 + 2",
      "1 + 2)",
      "1 2",
      "1.2.3",
      "2 ^ 10000",
      "process.exit(1)",
      "constructor",
      "1; 2",
      "10%",
      "1,000 + 1",
    ]) {
      assert.throws(() => evaluateExpression(bad), Error, bad);
    }
  });

  console.log("registry");

  await test("registers the five default tools with JSON Schemas", () => {
    const definitions = createDefaultRegistry().list();
    assert.deepEqual(
      definitions.map((d) => d.name),
      [
        "search_documents",
        "get_chunk",
        "list_documents",
        "calculate",
        "get_current_datetime",
      ]
    );

    for (const definition of definitions) {
      assert.ok(definition.description.length > 40, definition.name);
      assert.equal(definition.parameters.type, "object", definition.name);
      assert.equal(definition.parameters.$schema, undefined, definition.name);
    }
  });

  await test("topK has a default, so it is optional in the schema", () => {
    const search = createDefaultRegistry()
      .list()
      .find((d) => d.name === "search_documents")!;
    assert.deepEqual(search.parameters.required, ["query"]);
  });

  await test("rejects duplicate and invalid tool names", () => {
    const tool = defineTool({
      name: "echo",
      description: "echo",
      inputSchema: z.object({}),
      run: async () => ({ content: "" }),
    });
    assert.throws(() => new ToolRegistry().register(tool).register(tool));
    assert.throws(() =>
      new ToolRegistry().register({ ...tool, name: "bad name!" })
    );
  });

  const registry = createDefaultRegistry();

  await test("calls a tool with a JSON string or an object", async () => {
    const fromString = await registry.call(
      "calculate",
      '{"expression":"3 * 5 + 2"}',
      ctx()
    );
    assert.equal(fromString.isError, undefined);
    assert.equal(fromString.content, "3 * 5 + 2 = 17");
    assert.deepEqual(fromString.data, { result: 17 });

    const fromObject = await registry.call(
      "calculate",
      { expression: "2 ^ 10" },
      ctx()
    );
    assert.equal(fromObject.content, "2 ^ 10 = 1024");
  });

  await test("tool-level errors come back as error results", async () => {
    const result = await registry.call(
      "calculate",
      { expression: "1 / 0" },
      ctx()
    );
    assert.equal(result.isError, true);
    assert.match(result.content, /Division by zero/);
  });

  await test("unknown tool lists the available ones", async () => {
    const result = await registry.call("nope", {}, ctx());
    assert.equal(result.isError, true);
    assert.match(result.content, /Unknown tool "nope"/);
    assert.match(result.content, /calculate/);
  });

  await test("invalid arguments are reported, never thrown", async () => {
    const wrongType = await registry.call("calculate", { expression: 5 }, ctx());
    assert.equal(wrongType.isError, true);
    assert.match(wrongType.content, /Invalid arguments for "calculate"/);
    assert.match(wrongType.content, /expression/);

    const missing = await registry.call("calculate", {}, ctx());
    assert.equal(missing.isError, true);

    const tooLong = await registry.call(
      "calculate",
      { expression: "1+".repeat(150) + "1" },
      ctx()
    );
    assert.equal(tooLong.isError, true);

    const badJson = await registry.call("calculate", "{not json", ctx());
    assert.equal(badJson.isError, true);
    assert.match(badJson.content, /not valid JSON/);

    const notObject = await registry.call("calculate", "[1,2]", ctx());
    assert.equal(notObject.isError, true);

    const outOfRange = await registry.call(
      "search_documents",
      { query: "kafka", topK: 99 },
      ctx()
    );
    assert.equal(outOfRange.isError, true);
    assert.match(outOfRange.content, /topK/);
  });

  await test("empty arguments are accepted for no-arg tools' schemas", async () => {
    const noArgs = new ToolRegistry().register(
      defineTool({
        name: "ping",
        description: "ping",
        inputSchema: z.object({}),
        run: async () => ({ content: "pong" }),
      })
    );
    assert.equal((await noArgs.call("ping", "", ctx())).content, "pong");
    assert.equal((await noArgs.call("ping", undefined, ctx())).content, "pong");
  });

  const testTools = new ToolRegistry()
    .register(
      defineTool({
        name: "slow",
        description: "never finishes unless aborted",
        inputSchema: z.object({}),
        run: () => new Promise(() => {}),
      })
    )
    .register(
      defineTool({
        name: "boom",
        description: "throws",
        inputSchema: z.object({}),
        run: async () => {
          throw new Error("kaboom");
        },
      })
    )
    .register(
      defineTool({
        name: "big",
        description: "returns a lot of text",
        inputSchema: z.object({}),
        run: async () => ({ content: "x".repeat(10_000) }),
      })
    );

  await test("a tool that ignores its signal still times out", async () => {
    const started = Date.now();
    const result = await testTools.call("slow", {}, ctx(), { timeoutMs: 50 });
    assert.equal(result.isError, true);
    assert.match(result.content, /timed out after 50 ms/);
    assert.ok(Date.now() - started < 1000);
  });

  await test("an aborted run cancels the tool call", async () => {
    const controller = new AbortController();
    const pending = testTools.call(
      "slow",
      {},
      { runId: "r", signal: controller.signal },
      { timeoutMs: 5_000 }
    );
    controller.abort();
    const result = await pending;
    assert.equal(result.isError, true);
    assert.match(result.content, /aborted/);
  });

  await test("handler exceptions become error results", async () => {
    const result = await testTools.call("boom", {}, ctx());
    assert.equal(result.isError, true);
    assert.equal(result.content, "Error: kaboom");
  });

  await test("long output is truncated with a visible marker", async () => {
    const result = await testTools.call("big", {}, ctx(), {
      maxOutputChars: 100,
    });
    assert.equal(result.truncated, true);
    assert.ok(result.content.endsWith("…[truncated]"));
    assert.ok(result.content.length < 130);

    const untouched = await testTools.call("big", {}, ctx());
    assert.equal(untouched.truncated, true); // 10 000 > default 6 000
    const small = await registry.call("calculate", { expression: "1+1" }, ctx());
    assert.equal(small.truncated, undefined);
  });

  console.log("get_current_datetime");

  const fixedNow = () => new Date("2026-10-14T20:30:15Z");
  const clock = new ToolRegistry().register(createGetCurrentDatetime(fixedNow));

  await test("defaults to UTC", async () => {
    const result = await clock.call("get_current_datetime", {}, ctx());
    assert.deepEqual(JSON.parse(result.content), {
      timezone: "UTC",
      localDate: "2026-10-14",
      localTime: "20:30:15",
      weekday: "Wednesday",
      utcIso: "2026-10-14T20:30:15.000Z",
    });
  });

  await test("converts to the requested timezone (date can roll over)", async () => {
    const result = await clock.call(
      "get_current_datetime",
      { timezone: "Asia/Kolkata" },
      ctx()
    );
    const parsed = JSON.parse(result.content);
    assert.equal(parsed.localDate, "2026-10-15");
    assert.equal(parsed.localTime, "02:00:15");
    assert.equal(parsed.weekday, "Thursday");
  });

  await test("unknown timezone is an error result", async () => {
    const result = await clock.call(
      "get_current_datetime",
      { timezone: "Mars/Olympus" },
      ctx()
    );
    assert.equal(result.isError, true);
    assert.match(result.content, /unknown timezone/);
  });

  console.log("qdrant-backed tools (skipped if Qdrant / OpenAI are unavailable)");

  const live = await liveBackendAvailable();
  if (!live) {
    console.log("  skip Qdrant not reachable or OPENAI_API_KEY not set");
  } else {
    await test("list_documents returns documents with chunk counts", async () => {
      const result = await registry.call("list_documents", {}, ctx());
      assert.equal(result.isError, undefined, result.content);
      console.log("       ", result.content.replace(/\s+/g, " ").slice(0, 160));
    });

    let firstChunkId: string | undefined;

    await test("search_documents returns ranked, bounded snippets", async () => {
      const result = await registry.call(
        "search_documents",
        { query: "What is Java?", topK: 2 },
        ctx()
      );
      assert.equal(result.isError, undefined, result.content);

      const hits = JSON.parse(result.content) as Array<{
        chunkId: string;
        snippet: string;
        score: number;
      }>;
      assert.ok(hits.length >= 1 && hits.length <= 2);
      assert.ok(hits.every((hit) => hit.snippet.length <= 1201));
      assert.ok(hits[0].score >= hits[hits.length - 1].score);
      firstChunkId = hits[0].chunkId;
    });

    await test("get_chunk fetches the full passage by chunkId", async () => {
      assert.ok(firstChunkId, "needs a chunkId from the search test");
      const result = await registry.call(
        "get_chunk",
        { chunkId: firstChunkId },
        ctx()
      );
      assert.equal(result.isError, undefined, result.content);
      assert.equal(JSON.parse(result.content).chunkId, firstChunkId);
    });

    await test("get_chunk with an unknown id is an error result", async () => {
      const result = await registry.call(
        "get_chunk",
        { chunkId: "00000000-0000-0000-0000-000000000000" },
        ctx()
      );
      assert.equal(result.isError, true);
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

async function liveBackendAvailable(): Promise<boolean> {
  if (!process.env.OPENAI_API_KEY || !process.env.QDRANT_URL) return false;

  try {
    const { getQdrant } = await import("../lib/clients");
    const { COLLECTION_NAME } = await import("../lib/config");
    const collections = await getQdrant().getCollections();
    return collections.collections.some((c) => c.name === COLLECTION_NAME);
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});

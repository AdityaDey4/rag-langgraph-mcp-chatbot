import assert from "node:assert/strict";
import {
  createSseStream,
  encodeEvent,
  parseSseStream,
  withErrorBoundary,
} from "../lib/agent/sse";
import { buildTrace, formatAnswer } from "../lib/agent/trace";
import type { AgentEvent } from "../lib/agent/types";

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

const meta = (seq: number) => ({ runId: "run-1", seq });

const sample: AgentEvent[] = [
  { type: "step_start", step: 1, ...meta(0) },
  { type: "answer_delta", step: 1, text: "Hel\nlo", ...meta(1) },
  { type: "usage", step: 1, inputTokens: 10, outputTokens: 2, ...meta(2) },
];

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const out: AgentEvent[] = [];
  for await (const event of parseSseStream(stream)) out.push(event);
  return out;
}

async function* asyncOf(events: AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const event of events) yield event;
}

async function main() {
  console.log("sse: encode and parse");

  await test("encodeEvent produces a named SSE frame", () => {
    const frame = encodeEvent(sample[0]);
    assert.ok(frame.startsWith("event: step_start\ndata: {"));
    assert.ok(frame.endsWith("\n\n"));
    assert.ok(!frame.slice(0, -2).includes("\n\n"), "no blank line inside a frame");
  });

  await test("round trip, including newlines inside text", async () => {
    const wire = sample.map(encodeEvent).join("");
    assert.deepEqual(await collect(streamOf(wire)), sample);
  });

  await test("frames split at arbitrary byte boundaries still parse", async () => {
    const wire = sample.map(encodeEvent).join("");
    for (const size of [1, 2, 3, 7, 19, 64]) {
      const chunks: string[] = [];
      for (let i = 0; i < wire.length; i += size) chunks.push(wire.slice(i, i + size));
      assert.deepEqual(await collect(streamOf(...chunks)), sample, `chunk size ${size}`);
    }
  });

  await test("multi-byte characters split across chunks survive", async () => {
    const event: AgentEvent = {
      type: "answer_delta",
      step: 1,
      text: "naïve — 日本語 🙂",
      ...meta(0),
    };
    const bytes = new TextEncoder().encode(encodeEvent(event));
    const cut = bytes.length - 12; // lands inside a multi-byte sequence
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });
    assert.deepEqual(await collect(stream), [event]);
  });

  await test("CRLF, comments, unknown fields and garbage frames are tolerated", async () => {
    const good = encodeEvent(sample[0]).replace(/\n/g, "\r\n");
    const wire = `: keep-alive\r\n\r\nid: 5\r\nretry: 100\r\n\r\ndata: {not json}\r\n\r\n${good}`;
    assert.deepEqual(await collect(streamOf(wire)), [sample[0]]);
  });

  await test("a final frame without the trailing blank line is still delivered", async () => {
    const wire = encodeEvent(sample[0]).slice(0, -2);
    assert.deepEqual(await collect(streamOf(wire)), [sample[0]]);
  });

  console.log("sse: server stream");

  await test("createSseStream emits every event in order, then closes", async () => {
    const stream = createSseStream(asyncOf(sample), () => {});
    assert.deepEqual(await collect(stream), sample);
  });

  await test("cancelling the stream aborts the run and closes the generator", async () => {
    let aborted = false;
    let cleanedUp = false;

    async function* endless(): AsyncGenerator<AgentEvent> {
      try {
        for (let i = 0; ; i++) {
          yield { type: "step_start", step: i, ...meta(i) };
          await new Promise((r) => setTimeout(r, 5));
        }
      } finally {
        cleanedUp = true;
      }
    }

    const stream = createSseStream(endless(), () => {
      aborted = true;
    });
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();

    assert.equal(aborted, true);
    assert.equal(cleanedUp, true);
  });

  await test("an unexpected throw becomes an SSE error event, with the right seq", async () => {
    async function* broken(): AsyncGenerator<AgentEvent> {
      yield sample[0];
      yield sample[1];
      throw new Error("bug");
    }
    let reported: unknown;
    const stream = createSseStream(
      withErrorBoundary(broken(), "fallback", (e) => (reported = e)),
      () => {}
    );
    const events = await collect(stream);

    assert.deepEqual(events.map((e) => e.type), ["step_start", "answer_delta", "error"]);
    const last = events[2];
    assert.equal(last.type === "error" && last.code, "llm_error");
    assert.equal(last.seq, 2);
    assert.equal(last.runId, "run-1");
    assert.ok(reported instanceof Error);
  });

  console.log("trace");

  await test("buildTrace groups tool calls under their step", () => {
    const events: AgentEvent[] = [
      { type: "run_start", conversationId: "c", model: "m", tools: [], budgets: {} as never, ...meta(0) },
      { type: "step_start", step: 1, ...meta(1) },
      { type: "usage", step: 1, inputTokens: 900, outputTokens: 40, ...meta(2) },
      { type: "tool_call", step: 1, callId: "a", name: "search_documents", args: { query: "java" }, ...meta(3) },
      { type: "tool_call", step: 1, callId: "b", name: "calculate", args: { expression: "1+" }, ...meta(4) },
      { type: "tool_result", step: 1, callId: "b", name: "calculate", isError: true, durationMs: 2, preview: "Error: x", truncated: false, ...meta(5) },
      { type: "step_start", step: 2, ...meta(6) },
    ];
    const trace = buildTrace(events);

    assert.equal(trace.length, 2);
    assert.equal(trace[0].inputTokens, 900);
    assert.deepEqual(trace[0].calls.map((c) => [c.name, c.status]), [
      ["search_documents", "running"],
      ["calculate", "error"],
    ]);
    assert.equal(trace[0].calls[1].durationMs, 2);
    assert.equal(trace[1].calls.length, 0);
  });

  await test("formatAnswer numbers known citations and hides unknown markers", () => {
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    const c = "33333333-3333-4333-8333-333333333333";
    assert.equal(
      formatAnswer(`One [${a}]. Two [${b}]. Again [${a}]. Hidden [${c}].`, [
        { chunkId: a },
        { chunkId: b },
      ]),
      "One [1]. Two [2]. Again [1]. Hidden ."
    );
    assert.equal(formatAnswer(`Streaming [${a}]`, []), "Streaming ");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});

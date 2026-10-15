// Server-Sent Events helpers. Browser-safe: no Node-only APIs, so the same
// file encodes on the server and parses in the client.

import type { AgentEvent } from "./types";

// ---------------------------------------------------------------------------
// Server: AgentEvent -> SSE bytes
// ---------------------------------------------------------------------------

export function encodeEvent(event: AgentEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Last line of defence: if the agent generator throws (a bug, not a model or
 * tool failure), report it as an SSE `error` event instead of a broken stream.
 * Once streaming has started the HTTP status is already 200.
 */
export async function* withErrorBoundary(
  events: AsyncIterable<AgentEvent>,
  runId: string,
  onUnexpected: (error: unknown) => void = () => {}
): AsyncGenerator<AgentEvent> {
  let seq = 0;
  let currentRunId = runId;

  try {
    for await (const event of events) {
      seq = event.seq + 1;
      currentRunId = event.runId;
      yield event;
    }
  } catch (error) {
    onUnexpected(error);
    yield {
      type: "error",
      code: "llm_error",
      message: "Unexpected server error.",
      runId: currentRunId,
      seq,
    };
  }
}

/**
 * Wrap an event stream in a ReadableStream. Pull-based, so the agent only
 * advances as fast as the client reads. `onCancel` fires when the client
 * disconnects, and the generator is closed so its cleanup (timers) runs.
 */
export function createSseStream(
  events: AsyncIterable<AgentEvent>,
  onCancel: () => void
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(encoder.encode(encodeEvent(value)));
      }
    },
    async cancel() {
      onCancel();
      await iterator.return?.();
    },
  });
}

// ---------------------------------------------------------------------------
// Client: SSE bytes -> AgentEvent
// ---------------------------------------------------------------------------

/**
 * Incremental SSE parser. Handles frames split across chunks, several frames
 * in one chunk, CRLF line endings, comment lines and multi-line `data:`.
 * `EventSource` cannot be used because this endpoint is POST.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<AgentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (done) buffer += "\n\n";

      buffer = buffer.replace(/\r\n?/g, "\n");

      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const event = parseFrame(frame);
        if (event) yield event;
      }

      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(frame: string): AgentEvent | null {
  const data: string[] = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (data.length === 0) return null;

  try {
    return JSON.parse(data.join("\n")) as AgentEvent;
  } catch {
    return null;
  }
}

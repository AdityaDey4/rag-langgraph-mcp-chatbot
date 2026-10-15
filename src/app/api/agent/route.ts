import { randomUUID } from "node:crypto";
import { z } from "zod";
import { loadBudgets } from "@/lib/agent/budget";
import { runAgent } from "@/lib/agent/loop";
import { OpenAILlmClient } from "@/lib/agent/openai-llm";
import { createSseStream, withErrorBoundary } from "@/lib/agent/sse";
import { createDefaultRegistry } from "@/lib/agent/tools";
import type { AgentEvent } from "@/lib/agent/types";
import { CHAT_MODEL } from "@/lib/config";
import { addMessage, getConversation } from "@/lib/conversation-memory";

// Read by hosting platforms (ignored by `next dev` / `next start`); matches
// the loop's own total-time budget.
export const maxDuration = 60;

const MAX_BODY_BYTES = 16 * 1024;

const requestSchema = z.object({
  conversationId: z.string().trim().min(1).max(100).optional(),
  question: z.string().trim().min(1).max(2000),
});

const registry = createDefaultRegistry();
const llm = new OpenAILlmClient();

export async function POST(request: Request) {
  const requestId = randomUUID();

  // Everything that can fail with a plain HTTP status happens BEFORE the
  // stream starts: once streaming begins the status is already 200.
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > MAX_BODY_BYTES) {
    return errorResponse(413, "payload_too_large", "Request body is too large.", requestId);
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return errorResponse(400, "invalid_request", "Could not read the request body.", requestId);
  }
  if (raw.length > MAX_BODY_BYTES) {
    return errorResponse(413, "payload_too_large", "Request body is too large.", requestId);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return errorResponse(400, "invalid_request", "Body must be valid JSON.", requestId);
  }

  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ");
    return errorResponse(400, "invalid_request", message, requestId);
  }

  const { question } = parsed.data;
  const conversationId = parsed.data.conversationId ?? randomUUID();

  // Client disconnect (request.signal) and stream cancel() both land here.
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort(), {
    once: true,
  });

  const events = withMemoryAndLogging(
    runAgent(
      {
        question,
        conversationId,
        history: getConversation(memoryKey(conversationId)),
      },
      {
        llm,
        registry,
        budgets: loadBudgets(),
        model: process.env.AGENT_MODEL || CHAT_MODEL,
        signal: controller.signal,
        runId: requestId,
      }
    ),
    conversationId,
    question
  );

  const stream = createSseStream(
    withErrorBoundary(events, requestId, (error) =>
      console.error(`[agent ${requestId}] unexpected error:`, error)
    ),
    () => controller.abort()
  );

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Agent turns live under their own key so Classic mode's history is untouched. */
function memoryKey(conversationId: string): string {
  return `agent:${conversationId}`;
}

/**
 * Persist the raw question and final answer (never tool transcripts) and write
 * one structured log line per notable event. Logs carry names and counts only:
 * no document text, no keys.
 */
async function* withMemoryAndLogging(
  events: AsyncIterable<AgentEvent>,
  conversationId: string,
  question: string
): AsyncGenerator<AgentEvent> {
  for await (const event of events) {
    switch (event.type) {
      case "run_start":
        log(event, { model: event.model, tools: event.tools });
        break;
      case "tool_call":
        log(event, { step: event.step, tool: event.name });
        break;
      case "tool_result":
        log(event, {
          tool: event.name,
          isError: event.isError,
          durationMs: event.durationMs,
        });
        break;
      case "final":
        // Save before yielding: if the client left, the generator is never resumed.
        addMessage(memoryKey(conversationId), { role: "user", content: question });
        addMessage(memoryKey(conversationId), {
          role: "assistant",
          content: event.answer,
        });
        log(event, { ...event.totals, stoppedBy: event.stoppedBy });
        break;
      case "error":
        log(event, { code: event.code, message: event.message });
        break;
    }

    yield event;
  }
}

function log(event: AgentEvent, fields: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      scope: "agent",
      runId: event.runId,
      seq: event.seq,
      event: event.type,
      ...fields,
    })
  );
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId: string
) {
  return Response.json({ error: { code, message, requestId } }, { status });
}

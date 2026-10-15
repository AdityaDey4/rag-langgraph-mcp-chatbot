import { randomUUID } from "node:crypto";
import { BudgetTracker, estimateCostUsd } from "./budget";
import {
  REPEATED_CALL_NOTE,
  SYSTEM_PROMPT,
  forcedAnswerNote,
  wrapToolResult,
} from "./prompt";
import type {
  AgentDeps,
  AgentEvent,
  AgentEventBody,
  AgentInput,
  ChatMessage,
  LlmReply,
  LlmToolCall,
  RunTotals,
  SourceRef,
  StopReason,
  ToolDefinition,
  ToolResult,
} from "./types";

const HISTORY_LIMIT = 10;
const PREVIEW_CHARS = 500;
const FORCED_ANSWER_TIMEOUT_MS = 30_000;
const REPEAT_LIMIT = 3;

const CITATION_PATTERN =
  /\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;

/**
 * The agent loop: model call → tool calls → tool results → model call → … →
 * final answer. Yields every step as an event so the same code drives the
 * CLI and (later) the SSE endpoint.
 *
 * Everything it depends on is injected (`llm`, `registry`, budgets), so tests
 * can run it against a scripted fake model with no network.
 */
export async function* runAgent(
  input: AgentInput,
  deps: AgentDeps
): AsyncGenerator<AgentEvent> {
  const { llm, registry, budgets, model } = deps;
  const runId = deps.runId ?? randomUUID();
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const tracker = new BudgetTracker(budgets, startedAt, now);

  let seq = 0;
  const ev = (body: AgentEventBody): AgentEvent => ({
    ...body,
    runId,
    seq: seq++,
  });

  const question = input.question.trim();
  if (!question) {
    yield ev({
      type: "error",
      code: "invalid_request",
      message: "question must not be empty",
    });
    return;
  }

  // The total-time budget is a real timer so it also interrupts a slow model call.
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), budgets.totalTimeoutMs);
  const runSignal = AbortSignal.any(
    deps.signal ? [deps.signal, deadline.signal] : [deadline.signal]
  );

  const messages: ChatMessage[] = [
    { role: "system", content: deps.systemPrompt ?? SYSTEM_PROMPT },
    ...input.history.slice(-HISTORY_LIMIT),
    { role: "user", content: question },
  ];

  // Passages retrieved during this run: the only ones that may be cited.
  const sources = new Map<string, SourceRef>();
  // Identical successful calls are answered from here (repeat guard).
  const callCache = new Map<string, { result: ToolResult; count: number }>();
  const flags: { forced: StopReason | null } = { forced: null };
  const toolDefinitions = registry.list();

  const totals = (): RunTotals => ({
    steps: tracker.steps,
    toolCalls: tracker.toolCalls,
    inputTokens: tracker.inputTokens,
    outputTokens: tracker.outputTokens,
    costUsd: estimateCostUsd(model, tracker.inputTokens, tracker.outputTokens),
    latencyMs: now() - startedAt,
  });

  const finalEvent = (text: string, stoppedBy: StopReason | null) => {
    const { answer, citations } = resolveCitations(text, sources);
    return ev({ type: "final", answer, citations, totals: totals(), stoppedBy });
  };

  async function* callModel(
    step: number,
    tools: ToolDefinition[],
    signal: AbortSignal | undefined
  ): AsyncGenerator<AgentEvent, LlmReply> {
    let reply: LlmReply | undefined;

    for await (const chunk of llm.stream({ model, messages, tools, signal })) {
      if (chunk.type === "text") {
        yield ev({ type: "answer_delta", step, text: chunk.text });
      } else {
        reply = chunk.reply;
      }
    }

    if (!reply) throw new Error("Model stream ended without a result");

    tracker.inputTokens += reply.usage.inputTokens;
    tracker.outputTokens += reply.usage.outputTokens;
    yield ev({
      type: "usage",
      step,
      inputTokens: reply.usage.inputTokens,
      outputTokens: reply.usage.outputTokens,
    });

    return reply;
  }

  async function runCall(
    call: LlmToolCall
  ): Promise<{ result: ToolResult; durationMs: number }> {
    if (tracker.toolCalls >= budgets.maxToolCalls) {
      flags.forced ??= "max_tool_calls";
      return {
        result: {
          content:
            "Error: the tool-call limit has been reached. No more tools can be used; answer with what you have.",
          isError: true,
        },
        durationMs: 0,
      };
    }
    tracker.toolCalls++;

    const key = cacheKey(call);
    const seen = callCache.get(key);
    if (seen) {
      seen.count++;
      if (seen.count >= REPEAT_LIMIT) flags.forced ??= "repeated_calls";
      return {
        result: {
          ...seen.result,
          content: seen.result.content + REPEATED_CALL_NOTE,
        },
        durationMs: 0,
      };
    }

    const started = now();
    const result = await registry.call(
      call.name,
      call.arguments,
      { runId, signal: runSignal },
      {
        timeoutMs: Math.min(budgets.toolTimeoutMs, tracker.remainingMs()),
        maxOutputChars: budgets.maxToolOutputChars,
      }
    );

    if (!result.isError) callCache.set(key, { result, count: 1 });
    for (const source of extractSources(result.data)) {
      sources.set(source.chunkId, source);
    }

    return { result, durationMs: now() - started };
  }

  try {
    yield ev({
      type: "run_start",
      conversationId: input.conversationId,
      model,
      tools: toolDefinitions.map((tool) => tool.name),
      budgets,
    });

    let stopReason: StopReason | null = null;

    for (;;) {
      if (deps.signal?.aborted) {
        yield ev({ type: "error", code: "aborted", message: "Run aborted." });
        return;
      }

      stopReason = flags.forced ?? tracker.exceeded();
      if (stopReason) break;

      const step = ++tracker.steps;
      yield ev({ type: "step_start", step });

      let reply: LlmReply;
      try {
        reply = yield* callModel(step, toolDefinitions, runSignal);
      } catch (error) {
        if (deps.signal?.aborted) {
          yield ev({ type: "error", code: "aborted", message: "Run aborted." });
          return;
        }
        if (deadline.signal.aborted) {
          stopReason = "timeout";
          break;
        }
        yield ev({ type: "error", code: "llm_error", message: errorMessage(error) });
        return;
      }

      // No tool calls: the model has finished.
      if (reply.toolCalls.length === 0) {
        if (!reply.content.trim()) {
          yield ev({
            type: "error",
            code: "llm_error",
            message: "The model returned an empty answer.",
          });
          return;
        }
        yield finalEvent(reply.content, null);
        return;
      }

      messages.push({
        role: "assistant",
        content: reply.content,
        toolCalls: reply.toolCalls,
      });

      for (const call of reply.toolCalls) {
        yield ev({
          type: "tool_call",
          step,
          callId: call.id,
          name: call.name,
          args: parseForDisplay(call.arguments),
        });
      }

      // Every tool is read-only, so a turn's calls can run concurrently.
      const outcomes = await Promise.all(reply.toolCalls.map(runCall));

      for (const [index, call] of reply.toolCalls.entries()) {
        const { result, durationMs } = outcomes[index];

        yield ev({
          type: "tool_result",
          step,
          callId: call.id,
          name: call.name,
          isError: result.isError ?? false,
          durationMs,
          preview: result.content.slice(0, PREVIEW_CHARS),
          truncated: result.truncated ?? false,
        });

        // Every tool_call id must get a reply, or the next model call is rejected.
        messages.push({
          role: "tool",
          toolCallId: call.id,
          content:
            deps.wrapToolResults === false
              ? result.content
              : wrapToolResult(call.name, result.content),
        });
      }
    }

    // A budget ran out (or a loop was detected): one last call with tools off.
    messages.push({ role: "system", content: forcedAnswerNote(stopReason) });

    const step = ++tracker.steps;
    yield ev({ type: "step_start", step });

    const forcedSignal = AbortSignal.any([
      ...(deps.signal ? [deps.signal] : []),
      AbortSignal.timeout(FORCED_ANSWER_TIMEOUT_MS),
    ]);

    let forced: LlmReply;
    try {
      forced = yield* callModel(step, [], forcedSignal);
    } catch (error) {
      if (deps.signal?.aborted) {
        yield ev({ type: "error", code: "aborted", message: "Run aborted." });
      } else {
        yield ev({ type: "error", code: "llm_error", message: errorMessage(error) });
      }
      return;
    }

    if (!forced.content.trim()) {
      yield ev({
        type: "error",
        code: "budget_exceeded",
        message: `Stopped (${stopReason}) and the model produced no final answer.`,
      });
      return;
    }

    yield finalEvent(forced.content, stopReason);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keep only citations of passages actually retrieved in this run. Anything
 * else the model cited is removed from the text, so it cannot be fabricated.
 */
export function resolveCitations(
  text: string,
  sources: Map<string, SourceRef>
): { answer: string; citations: SourceRef[] } {
  const citations = new Map<string, SourceRef>();
  let removed = false;

  let answer = text.replace(CITATION_PATTERN, (match, id: string) => {
    const source = sources.get(id.toLowerCase()) ?? sources.get(id);
    if (!source) {
      removed = true;
      return "";
    }
    citations.set(source.chunkId, source);
    return match;
  });

  // Tidy the gap a removed citation leaves, without touching other whitespace.
  if (removed) answer = answer.replace(/ {2,}/g, " ").replace(/ +([.,;:!?])/g, "$1");

  return { answer: answer.trim(), citations: [...citations.values()] };
}

function extractSources(data: unknown): SourceRef[] {
  if (typeof data !== "object" || data === null) return [];
  const sources = (data as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) return [];

  return sources.filter(
    (source): source is SourceRef =>
      typeof source === "object" &&
      source !== null &&
      typeof (source as { chunkId?: unknown }).chunkId === "string"
  );
}

function cacheKey(call: LlmToolCall): string {
  try {
    return `${call.name}:${stableStringify(JSON.parse(call.arguments || "{}"))}`;
  } catch {
    return `${call.name}:${call.arguments.trim()}`;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseForDisplay(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return raw;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

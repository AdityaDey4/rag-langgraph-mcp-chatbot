// Shared helpers for the A4 behaviour check and experiments. Not a script itself.

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_BUDGETS, estimateCostUsd } from "../lib/agent/budget";
import { runAgent } from "../lib/agent/loop";
import { OpenAILlmClient } from "../lib/agent/openai-llm";
import type { ToolRegistry } from "../lib/agent/registry";
import { createDefaultRegistry } from "../lib/agent/tools";
import type { AgentEvent, Budgets } from "../lib/agent/types";
import { getOpenAI } from "../lib/clients";
import { CHAT_MODEL } from "../lib/config";
import { addMessage } from "../lib/conversation-memory";
import { runForEvaluation } from "../langgraph/summary";

const EMBEDDING_PRICE_PER_M = 0.13; // text-embedding-3-large, approximate

// ---------------------------------------------------------------------------
// Usage meter: counts every OpenAI call made through the shared client, so the
// agent and Classic paths are costed the same way (embeddings included).
// ---------------------------------------------------------------------------

type Meter = { chatIn: number; chatOut: number; embeddingTokens: number; chatCalls: number };
const meter: Meter = { chatIn: 0, chatOut: 0, embeddingTokens: 0, chatCalls: 0 };
let metered = false;

function installMeter() {
  if (metered) return;
  metered = true;
  const client = getOpenAI();

  const chat = client.chat.completions;
  const originalChat = chat.create.bind(chat);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (chat as any).create = async (...args: any[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await (originalChat as any)(...args);
    meter.chatCalls++;
    // Non-streaming responses carry usage; streamed ones are costed from loop totals.
    if (result?.usage && !args[0]?.stream) {
      meter.chatIn += result.usage.prompt_tokens ?? 0;
      meter.chatOut += result.usage.completion_tokens ?? 0;
    }
    return result;
  };

  const embeddings = client.embeddings;
  const originalEmbed = embeddings.create.bind(embeddings);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (embeddings as any).create = async (...args: any[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await (originalEmbed as any)(...args);
    meter.embeddingTokens += result?.usage?.total_tokens ?? 0;
    return result;
  };
}

function resetMeter() {
  installMeter();
  Object.assign(meter, { chatIn: 0, chatOut: 0, embeddingTokens: 0, chatCalls: 0 });
}

// ---------------------------------------------------------------------------
// Running the agent and Classic RAG
// ---------------------------------------------------------------------------

export type ToolCallRecord = { name: string; args: unknown; isError: boolean };

export type RunSummary = {
  path: "agent" | "classic" | "langgraph";
  question: string;
  answer: string;
  toolCalls: ToolCallRecord[];
  steps: number;
  chatCalls: number;
  inputTokens: number;
  outputTokens: number;
  embeddingTokens: number;
  costUsd: number | null;
  latencyMs: number;
  stoppedBy: string | null;
  citations: string[];
  error?: string;
};

export type AgentRunOptions = {
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  registry?: ToolRegistry;
  budgets?: Partial<Budgets>;
  systemPrompt?: string;
  wrapToolResults?: boolean;
};

export async function runAgentOnce(
  question: string,
  options: AgentRunOptions = {}
): Promise<RunSummary> {
  resetMeter();
  const events: AgentEvent[] = [];
  const started = Date.now();

  for await (const event of runAgent(
    { question, conversationId: randomUUID(), history: options.history ?? [] },
    {
      llm: new OpenAILlmClient(),
      registry: options.registry ?? createDefaultRegistry(),
      budgets: { ...DEFAULT_BUDGETS, ...options.budgets },
      model: CHAT_MODEL,
      systemPrompt: options.systemPrompt,
      wrapToolResults: options.wrapToolResults,
    }
  )) {
    events.push(event);
  }

  const calls = new Map<string, ToolCallRecord>();
  for (const event of events) {
    if (event.type === "tool_call") {
      calls.set(event.callId, { name: event.name, args: event.args, isError: false });
    } else if (event.type === "tool_result") {
      const call = calls.get(event.callId);
      if (call) call.isError = event.isError;
    }
  }

  const final = events.find((e) => e.type === "final");
  const error = events.find((e) => e.type === "error");
  const totals = final?.type === "final" ? final.totals : null;

  const inputTokens = totals?.inputTokens ?? 0;
  const outputTokens = totals?.outputTokens ?? 0;
  const chatCost = estimateCostUsd(CHAT_MODEL, inputTokens, outputTokens) ?? 0;

  return {
    path: "agent",
    question,
    answer: final?.type === "final" ? final.answer : "",
    toolCalls: [...calls.values()],
    steps: totals?.steps ?? 0,
    chatCalls: totals?.steps ?? 0,
    inputTokens,
    outputTokens,
    embeddingTokens: meter.embeddingTokens,
    costUsd: chatCost + (meter.embeddingTokens * EMBEDDING_PRICE_PER_M) / 1e6,
    latencyMs: Date.now() - started,
    stoppedBy: final?.type === "final" ? final.stoppedBy : null,
    citations: final?.type === "final" ? final.citations.map((c) => c.chunkId) : [],
    error: error?.type === "error" ? `${error.code}: ${error.message}` : undefined,
  };
}

export async function runClassicOnce(
  question: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = []
): Promise<RunSummary> {
  // Imported lazily: the route pulls in the whole classic pipeline.
  const { POST } = await import("../app/api/ask/route");

  const conversationId = randomUUID();
  for (const message of history) addMessage(conversationId, message);

  resetMeter();
  const started = Date.now();

  // The classic route logs heavily; keep the harness output readable.
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  let answer = "";
  let error: string | undefined;
  try {
    const response = await POST(
      new Request("http://localhost/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, question }),
      })
    );
    const data = await response.json();
    if (response.ok) answer = data.answer ?? "";
    else error = data.error ?? `HTTP ${response.status}`;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  const chatCost = estimateCostUsd(CHAT_MODEL, meter.chatIn, meter.chatOut) ?? 0;

  return {
    path: "classic",
    question,
    answer,
    toolCalls: [],
    steps: 1,
    chatCalls: meter.chatCalls,
    inputTokens: meter.chatIn,
    outputTokens: meter.chatOut,
    embeddingTokens: meter.embeddingTokens,
    costUsd: chatCost + (meter.embeddingTokens * EMBEDDING_PRICE_PER_M) / 1e6,
    latencyMs: Date.now() - started,
    stoppedBy: null,
    citations: [],
    error,
  };
}

// ---------------------------------------------------------------------------
// LLM-as-judge (small, fixed rubric). A judge is itself a model: treat the
// verdicts as a signal, and read the reasons.
// ---------------------------------------------------------------------------

// The LangGraph agent (src/langgraph), run the same way and summarised in the same shape.
export async function runLangGraphOnce(
  question: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = []
): Promise<RunSummary> {
  const run = await runForEvaluation(question, history);

  return {
    path: "langgraph",
    question,
    answer: run.answer,
    toolCalls: run.toolCalls,
    steps: run.modelCalls, // the hand-built agent also counts model calls as steps
    chatCalls: run.modelCalls,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    embeddingTokens: 0, // not measured: LangChain's embeddings client is not the one the meter watches
    costUsd: run.costUsd,
    latencyMs: run.latencyMs,
    stoppedBy: run.stoppedBy,
    citations: run.citations,
    error: run.error,
  };
}

export type Verdict = { pass: boolean; reason: string };

export async function judge(
  question: string,
  expectation: string,
  answer: string
): Promise<Verdict> {
  if (!answer.trim()) return { pass: false, reason: "empty answer" };

  const response = await getOpenAI().chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You grade answers from a document Q&A assistant. You get the user's question, an EXPECTATION describing what a correct answer must do, and the assistant's ANSWER. " +
          'Pass only if the answer satisfies the expectation. Ignore style and formatting unless the expectation mentions them. Do not reward claims the expectation does not support. Reply with JSON only: {"pass": boolean, "reason": "one short sentence"}.',
      },
      {
        role: "user",
        content: `QUESTION:\n${question}\n\nEXPECTATION:\n${expectation}\n\nANSWER:\n${answer}`,
      },
    ],
  });

  try {
    const parsed = JSON.parse(response.choices[0].message.content ?? "{}");
    return { pass: parsed.pass === true, reason: String(parsed.reason ?? "") };
  } catch {
    return { pass: false, reason: "judge returned invalid JSON" };
  }
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export function percent(numerator: number, denominator: number): string {
  return denominator ? `${((numerator / denominator) * 100).toFixed(0)}%` : "n/a";
}

export function usd(value: number | null): string {
  return value === null ? "n/a" : `$${value.toFixed(5)}`;
}

export function toolNames(run: RunSummary): string[] {
  return run.toolCalls.map((call) => call.name);
}

export function oneLine(text: string, max = 110): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

export function saveResults(name: string, data: unknown): string {
  const dir = path.join(process.cwd(), "eval", "results");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  return path.relative(process.cwd(), file);
}

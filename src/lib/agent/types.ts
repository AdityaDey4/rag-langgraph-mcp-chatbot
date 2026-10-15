import type { z } from "zod";

/** Passed to every tool call. Tools take explicit arguments plus this, nothing hidden. */
export type ToolContext = {
  runId: string;
  signal: AbortSignal;
};

/** Errors are results, not exceptions: the model sees them and can recover. */
export type ToolResult = {
  /** Text returned to the model. */
  content: string;
  isError?: boolean;
  /** Set by the registry when `content` was cut to the output limit. */
  truncated?: boolean;
  /** Optional structured payload for the loop (never sent to the model). */
  data?: unknown;
};

export type Tool<S extends z.ZodType = z.ZodType> = {
  name: string;
  /** Written for the model: when to use it, when not to, what it returns. */
  description: string;
  inputSchema: S;
  run(args: z.output<S>, ctx: ToolContext): Promise<ToolResult>;
};

/** What the model is told about a tool. */
export type ToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema describing the arguments. */
  parameters: Record<string, unknown>;
};

export type CallOptions = {
  timeoutMs?: number;
  maxOutputChars?: number;
};

/** A passage a tool retrieved; the loop uses these to verify citations. */
export type SourceRef = {
  chunkId: string;
  filename: string | null;
  section: string | null;
  pages: number[];
  snippet: string;
};

// ---------------------------------------------------------------------------
// Model abstraction (the loop never talks to OpenAI directly)
// ---------------------------------------------------------------------------

export type LlmToolCall = {
  id: string;
  name: string;
  /** Raw JSON string exactly as the model produced it. */
  arguments: string;
};

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: LlmToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type LlmReply = {
  content: string;
  toolCalls: LlmToolCall[];
  usage: TokenUsage;
};

export type LlmRequest = {
  model: string;
  messages: ChatMessage[];
  /** Empty means "no tools": the model must answer in text. */
  tools: ToolDefinition[];
  signal?: AbortSignal;
};

export type LlmChunk =
  | { type: "text"; text: string }
  | { type: "done"; reply: LlmReply };

export interface LlmClient {
  /** Yields text deltas as they arrive, then exactly one `done`. */
  stream(request: LlmRequest): AsyncIterable<LlmChunk>;
}

// ---------------------------------------------------------------------------
// Budgets and events
// ---------------------------------------------------------------------------

export type Budgets = {
  /** Max model calls (a forced final answer is allowed on top). */
  maxSteps: number;
  maxToolCalls: number;
  totalTimeoutMs: number;
  toolTimeoutMs: number;
  maxToolOutputChars: number;
  /** Input + output tokens across the run. */
  maxTokens: number;
};

export type StopReason =
  | "max_steps"
  | "max_tool_calls"
  | "max_tokens"
  | "timeout"
  | "repeated_calls";

export type RunTotals = {
  steps: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** Estimate for the chat model only; null when the model has no known price. */
  costUsd: number | null;
  latencyMs: number;
};

export type AgentErrorCode =
  | "llm_error"
  | "aborted"
  | "invalid_request"
  | "budget_exceeded";

export type AgentEventBody =
  | {
      type: "run_start";
      conversationId: string;
      model: string;
      tools: string[];
      budgets: Budgets;
    }
  | { type: "step_start"; step: number }
  | {
      type: "tool_call";
      step: number;
      callId: string;
      name: string;
      /** Parsed arguments when valid JSON, otherwise the raw string. */
      args: unknown;
    }
  | {
      type: "tool_result";
      step: number;
      callId: string;
      name: string;
      isError: boolean;
      durationMs: number;
      /** Bounded preview only: browsers never get the full payload. */
      preview: string;
      truncated: boolean;
    }
  | { type: "usage"; step: number; inputTokens: number; outputTokens: number }
  | { type: "answer_delta"; step: number; text: string }
  | {
      type: "final";
      answer: string;
      citations: SourceRef[];
      totals: RunTotals;
      /** Why the loop was cut short and an answer was forced; null if it finished on its own. */
      stoppedBy: StopReason | null;
    }
  | { type: "error"; code: AgentErrorCode; message: string };

type EventMeta = { runId: string; seq: number };

export type AgentEvent = AgentEventBody & EventMeta;

export type AgentInput = {
  question: string;
  conversationId: string;
  /** Prior turns: raw user messages and final answers only. */
  history: Array<{ role: "user" | "assistant"; content: string }>;
};

export type AgentDeps = {
  llm: LlmClient;
  registry: import("./registry").ToolRegistry;
  budgets: Budgets;
  model: string;
  /** Aborts the whole run (client disconnect, Ctrl+C). */
  signal?: AbortSignal;
  runId?: string;
  now?: () => number;
  /** Experiment seam: replaces the default system prompt. */
  systemPrompt?: string;
  /** Experiment seam: set to false to send tool output unwrapped (default true). */
  wrapToolResults?: boolean;
};

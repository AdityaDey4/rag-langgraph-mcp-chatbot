import "../config";

import type { Budgets, StopReason } from "./types";

export const DEFAULT_BUDGETS: Budgets = {
  maxSteps: 6,
  maxToolCalls: 8,
  totalTimeoutMs: 60_000,
  toolTimeoutMs: 10_000,
  maxToolOutputChars: 6_000,
  maxTokens: 40_000,
};

const ENV_NAMES: Record<keyof Budgets, string> = {
  maxSteps: "AGENT_MAX_STEPS",
  maxToolCalls: "AGENT_MAX_TOOL_CALLS",
  totalTimeoutMs: "AGENT_TOTAL_TIMEOUT_MS",
  toolTimeoutMs: "AGENT_TOOL_TIMEOUT_MS",
  maxToolOutputChars: "AGENT_MAX_TOOL_OUTPUT_CHARS",
  maxTokens: "AGENT_MAX_TOKENS",
};

/** Defaults, then environment variables, then explicit overrides (e.g. CLI flags). */
export function loadBudgets(
  overrides: Partial<Budgets> = {},
  env: Record<string, string | undefined> = process.env
): Budgets {
  const budgets = { ...DEFAULT_BUDGETS };

  for (const key of Object.keys(ENV_NAMES) as Array<keyof Budgets>) {
    const value = Number(env[ENV_NAMES[key]]);
    if (env[ENV_NAMES[key]] && Number.isFinite(value) && value > 0) {
      budgets[key] = Math.floor(value);
    }
  }

  return { ...budgets, ...overrides };
}

/** Tracks what a run has used and says which limit (if any) has been hit. */
export class BudgetTracker {
  steps = 0;
  toolCalls = 0;
  inputTokens = 0;
  outputTokens = 0;

  constructor(
    readonly budgets: Budgets,
    private readonly startedAt: number,
    private readonly now: () => number
  ) {}

  elapsedMs(): number {
    return this.now() - this.startedAt;
  }

  remainingMs(): number {
    return Math.max(1, this.budgets.totalTimeoutMs - this.elapsedMs());
  }

  /** Checked before every model call. */
  exceeded(): StopReason | null {
    if (this.elapsedMs() >= this.budgets.totalTimeoutMs) return "timeout";
    if (this.steps >= this.budgets.maxSteps) return "max_steps";
    if (this.toolCalls >= this.budgets.maxToolCalls) return "max_tool_calls";
    if (this.inputTokens + this.outputTokens >= this.budgets.maxTokens) {
      return "max_tokens";
    }
    return null;
  }
}

// Approximate USD per 1M tokens: [input, output]. Prices change; this is an
// estimate for learning, not billing. Unknown models report null.
const PRICES_PER_MILLION: Record<string, [number, number]> = {
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4o": [2.5, 10],
};

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number | null {
  const price = PRICES_PER_MILLION[model];
  if (!price) return null;
  return (inputTokens * price[0] + outputTokens * price[1]) / 1_000_000;
}

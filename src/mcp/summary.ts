// Runs one question through the MCP agent and returns the numbers the behaviour check compares:
// the answer, the tool calls, the model calls, the tokens, the cost and the time. (The same shape as src/langgraph/summary.ts.)
import type { AgentRun, ToolCallRecord } from "./agent";

export type McpRun = {
  answer: string;
  toolCalls: ToolCallRecord[];
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  stoppedBy: string | null;
  citations: string[];
  error?: string;
};

// gpt-4o-mini, US dollars per 1 million tokens: input 0.15, output 0.60 (an estimate, as in the other checks).
const INPUT_PRICE_PER_MILLION = 0.15;
const OUTPUT_PRICE_PER_MILLION = 0.6;

type Agent = { ask(question: string, history?: { role: "user" | "assistant"; content: string }[]): Promise<AgentRun> };

// Example: runMcpForEvaluation(agent, "What is Kafka?") returns { answer: "Apache Kafka is …", toolCalls: [{ name: "search_documents", … }], modelCalls: 2, inputTokens: 2747, … }
export async function runMcpForEvaluation(
  agent: Agent,
  question: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
): Promise<McpRun> {
  const startedAt = Date.now();

  try {
    const run = await agent.ask(question, history);

    return {
      answer: run.answer,
      toolCalls: run.toolCalls,
      modelCalls: run.modelCalls,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      costUsd: (run.inputTokens * INPUT_PRICE_PER_MILLION + run.outputTokens * OUTPUT_PRICE_PER_MILLION) / 1e6,
      latencyMs: Date.now() - startedAt,
      stoppedBy: run.answer.startsWith("I stopped because the step limit") ? "step_limit" : null,
      citations: [...run.answer.matchAll(/\[([0-9a-f]{8}-[0-9a-f-]{27})\]/gi)].map((match) => match[1]),
    };
  } catch (error) {
    return {
      answer: "",
      toolCalls: [],
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: Date.now() - startedAt,
      stoppedBy: null,
      citations: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

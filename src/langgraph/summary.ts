// Runs one question through the LangGraph agent and returns the numbers the behaviour check compares:
// the answer, the tool calls, the model calls, the tokens, the cost and the time.
import { randomUUID } from "node:crypto";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { graph, runAgent } from "./agent";

// 1. The same shape the hand-built agent's check uses (copied, so this folder imports nothing from outside).
export type ToolCallRecord = {
  name: string;
  args: unknown;
  isError: boolean;
};

export type LangGraphRun = {
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

// gpt-4o-mini, US dollars per 1 million tokens: input 0.15, output 0.60 (an estimate, as in the hand-built check).
const INPUT_PRICE_PER_MILLION = 0.15;
const OUTPUT_PRICE_PER_MILLION = 0.6;

// Example: runForEvaluation("What is Kafka?") returns { answer: "Apache Kafka is …", toolCalls: [{ name: "search_documents", … }], modelCalls: 2, inputTokens: 3681, … }
export async function runForEvaluation(
  question: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
): Promise<LangGraphRun> {
  const threadId = randomUUID();
  const config = { configurable: { thread_id: threadId } };
  const startedAt = Date.now();

  // 2. Earlier turns are put into the new thread before the question is asked.
  // "llm" says the earlier answer came from that node, so the next step is the end and not another model call.
  if (history.length > 0) {
    await graph.updateState(config, { messages: history }, "llm");
  }

  // 3. Ask the question like the API does.
  let answer = "";
  let stoppedBy: string | null = null;
  let error: string | undefined;

  try {
    const result = await runAgent(question, threadId);

    if ("approval" in result) {
      stoppedBy = "needs_approval";
    } else {
      answer = result.answer;
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  // 4. Read what happened from the saved messages of this question.
  const saved = await graph.getState(config);
  const messages: BaseMessage[] = saved.values.messages ?? [];
  const lastQuestion = messages.findLastIndex((message) => message instanceof HumanMessage);
  const thisRun = messages.slice(lastQuestion + 1);

  const modelMessages = thisRun.filter((message): message is AIMessage => message instanceof AIMessage);
  const toolMessages = thisRun.filter((message): message is ToolMessage => message instanceof ToolMessage);

  const toolCalls: ToolCallRecord[] = [];
  for (const message of modelMessages) {
    for (const call of message.tool_calls ?? []) {
      const result = toolMessages.find((toolMessage) => toolMessage.tool_call_id === call.id);

      toolCalls.push({
        name: call.name,
        args: call.args,
        isError: result?.status === "error",
      });
    }
  }

  const inputTokens = modelMessages.reduce((sum, message) => sum + (message.usage_metadata?.input_tokens ?? 0), 0);
  const outputTokens = modelMessages.reduce((sum, message) => sum + (message.usage_metadata?.output_tokens ?? 0), 0);

  // 5. The two ways the graph stops without a normal answer.
  if (answer.startsWith("I stopped because the step limit")) stoppedBy = "step_limit";
  if (answer.startsWith("I stopped because") && answer.includes("tool calls failed")) stoppedBy = "tool_errors";

  return {
    answer,
    toolCalls,
    modelCalls: modelMessages.length,
    inputTokens,
    outputTokens,
    costUsd: (inputTokens * INPUT_PRICE_PER_MILLION + outputTokens * OUTPUT_PRICE_PER_MILLION) / 1e6,
    latencyMs: Date.now() - startedAt,
    stoppedBy,
    citations: [...answer.matchAll(/\[([0-9a-f]{8}-[0-9a-f-]{27})\]/gi)].map((match) => match[1]),
    error,
  };
}


import {
  StateGraph,
  MemorySaver,
  Command,
  GraphRecursionError,
  START,
  END,
} from "@langchain/langgraph";

import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  SystemMessage,
  HumanMessage,
  trimMessages,
  type BaseMessage,
} from "@langchain/core/messages";

import { approve, afterApprove, type Decision } from "./approve";
import { CHAT_MODEL } from "./config";
import { describe, log, shorten } from "./log";
import { SYSTEM_PROMPT } from "./prompt";
import { AgentState } from "./state";
import { afterTools, giveUp, runTools } from "./tool-node";
import { tools } from "./tools";

// Example: describeState(state) returns 'searchCount=1, searchQueries=["Kafka"], toolErrors=0, lastAnswer=""'
function describeState(state: typeof AgentState.State): string {
  return `searchCount=${state.searchCount}, searchQueries=${JSON.stringify(state.searchQueries)}, toolErrors=${state.toolErrors}, lastAnswer="${shorten(state.lastAnswer, 40)}"`;
}

// 1. Initialize the LLM
const model = new ChatOpenAI({
  model: CHAT_MODEL,
  temperature: 0,
});

// 2. Make all six tools available to the LLM (means llm can request these tools; it never runs them)
const modelWithTools = model.bindTools(tools);

// Of the earlier questions, only the last MAX_MESSAGES messages (starting at a human message) are sent to the model.
// The current question is always sent whole, and the saved history is not cut.
const MAX_MESSAGES = 6;

// Example: with 10 saved messages where the current question starts at message 9, returns the last earlier messages (from a human message on) plus messages 9 and 10
export async function messagesForModel(saved: BaseMessage[]): Promise<BaseMessage[]> {
  const current = saved.findLastIndex((message) => message instanceof HumanMessage); // where this question starts
  const earlier = await trimMessages(saved.slice(0, current), {
    strategy: "last",
    maxTokens: MAX_MESSAGES,
    tokenCounter: (list) => list.length, // count messages instead of tokens
    startOn: "human", // never start in the middle of a tool call
  });
  return [...earlier, ...saved.slice(current)];
}

// 3. LLM node: generate a response or request tools
// Example return: { messages: [ AIMessage("Kafka is …") ], searchCount: 0, searchQueries: [], lastAnswer: "Kafka is …" }
async function callModel(state: typeof AgentState.State) {
  log(`state: ${describeState(state)}`);
  const messages = await messagesForModel(state.messages);
  log(`llm: sending ${messages.length + 1} messages to ${CHAT_MODEL} (system prompt + ${messages.length} of ${state.messages.length} saved messages, last message from "${messages.at(-1)?.getType()}")`);
  messages.forEach((message, index) => log(`  ${index + 1}. ${describe(message)}`));

  const response = await modelWithTools.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    ...messages,
  ]);

  const usage = response.usage_metadata;
  log(`llm replied (${usage?.input_tokens} tokens in, ${usage?.output_tokens} out, finish: ${response.response_metadata?.finish_reason})`);
  log(`  ${describe(response)}`);

  // Return only what changed. LangGraph merges each field into the state with its reducer (see state.ts).
  // Only search_documents calls count; list_documents, get_chunk, calculate etc. are ignored here.
  const searches = (response.tool_calls ?? []).filter((call) => call.name === "search_documents");

  return {
    messages: [response],
    searchCount: searches.length,
    searchQueries: searches.map((call) => call.args.query as string),
    lastAnswer: String(response.content),
  };
}

// 4. Tool node: execute requested tools (runTools in tool-node.ts, which replaces the ready-made ToolNode)

// 5. Conditional routing: tools or final answer
// Example return: "approve" if the model asked for a tool, otherwise END
function shouldContinue(state: typeof AgentState.State) {
  const lastMessage = state.messages.at(-1);
  log(`state: ${describeState(state)}`);

  if (
    lastMessage instanceof AIMessage &&
    lastMessage.tool_calls?.length
  ) {
    const names = lastMessage.tool_calls.map((call) => call.name).join(", ");
    log(`router: the model asked for ${lastMessage.tool_calls.length} tool(s) [${names}] -> go to "approve"`);
    return "approve";
  }

  log("router: the model gave a final answer -> END");
  return END;
}

// 6. Build and compile the graph
// The checkpointer saves the state after every step under a thread_id. It lives in memory, so it is lost when the process stops.
export const graph = new StateGraph(AgentState)
  .addNode("llm", callModel)
  .addNode("approve", approve)
  .addNode("tools", runTools)
  .addNode("giveUp", giveUp)
  .addEdge(START, "llm")
  .addConditionalEdges("llm", shouldContinue, {
    approve: "approve",
    [END]: END,
  })
  .addConditionalEdges("approve", afterApprove, {
    tools: "tools",
    llm: "llm",
  })
  .addConditionalEdges("tools", afterTools, {
    llm: "llm",
    giveUp: "giveUp",
  })
  .addEdge("giveUp", END)
  .compile({ checkpointer: new MemorySaver() });

// 7. Export reusable functions for your application
// What the human is asked to decide: the risky tool calls the model wants to make.
type ApprovalRequest = {
  calls: {
    name: string;
    args: Record<string, unknown>;
  }[];
};

// A run ends with an answer, or stops at an approval: then the human's decision goes to resumeAgent.
export type AgentResult =
  | { answer: string }
  | { approval: ApprovalRequest };

// Same threadId = same conversation: earlier messages are loaded from the checkpointer.
// Example: runAgent("What is 2 + 2?", "thread-a") returns { answer: "4" }
// Example: runAgent("Email ana@example.com hi", "thread-a") returns { approval: { calls: [{ name: "send_email", args: {…} }] } }
export function runAgent(
  input: string,
  threadId: string,
  recursionLimit = 6,
) {
  const newQuestion = {
    messages: [new HumanMessage(input)],
    toolErrors: 0, // a new question starts with no failures
  };

  return run(newQuestion, threadId, recursionLimit);
}

// Example: resumeAgent({ approve: true }, "thread-a") continues the paused run and returns { answer: "I sent the email." }
export function resumeAgent(
  decision: Decision,
  threadId: string,
  recursionLimit = 6,
) {
  return run(
    new Command({ resume: decision }),
    threadId,
    recursionLimit,
  );
}

async function run(
  input: Parameters<typeof graph.invoke>[0],
  threadId: string,
  recursionLimit: number,
): Promise<AgentResult> {
  try {
    const config = {
      recursionLimit,
      configurable: { thread_id: threadId },
    };
    const result = await graph.invoke(input, config);

    // A run that stopped at interrupt() has a task with an interrupt; its value says what the human must decide.
    const savedState = await graph.getState(config);
    const interrupts = savedState.tasks.flatMap((task) => task.interrupts);
    const pending = interrupts[0];

    if (pending) {
      log(`paused: waiting for approval on thread ${threadId}`);
      return { approval: pending.value };
    }

    // Every model call is one step and every tools run is one step (the give-up node counts like a model call).
    const lastQuestion = result.messages.findLastIndex((message) => message instanceof HumanMessage);
    const thisRun = result.messages.slice(lastQuestion + 1); // only the messages of this question
    const modelCalls = thisRun.filter((message) => message instanceof AIMessage);
    const toolRuns = modelCalls.filter((message) => message.tool_calls?.length);
    const totalSteps = modelCalls.length + toolRuns.length;

    // A run that takes N steps only finishes if the limit is at least N + 1.
    log(
      `Thread: ${threadId}, saved messages: ${result.messages.length}, ` +
      `model calls: ${modelCalls.length}, tool runs: ${toolRuns.length}, ` +
      `total steps: ${totalSteps}, recursion limit: ${recursionLimit}`,
    );

    return { answer: result.lastAnswer };
  } catch (error) {
    // The graph ran more steps than recursionLimit allows, so LangGraph stopped it.
    if (error instanceof GraphRecursionError) {
      return {
        answer: `I stopped because the step limit (${recursionLimit}) was reached before I could finish. Please try a simpler question.`,
      };
    }
    throw error;
  }
}

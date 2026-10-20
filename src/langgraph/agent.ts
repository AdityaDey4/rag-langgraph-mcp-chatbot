
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
import { describe, log } from "./log";
import { SYSTEM_PROMPT } from "./prompt";
import { AgentState } from "./state";
import { afterTools, giveUp, runTools } from "./tool-node";
import { tools } from "./tools";

// (old log helper, switched off while studying streaming; it also needs `shorten` imported from ./log)
// // Example: describeState(state) returns 'searchCount=1, searchQueries=["Kafka"], toolErrors=0, lastAnswer=""'
// function describeState(state: typeof AgentState.State): string {
//   return `searchCount=${state.searchCount}, searchQueries=${JSON.stringify(state.searchQueries)}, toolErrors=${state.toolErrors}, lastAnswer="${shorten(state.lastAnswer, 40)}"`;
// }

// 1. Initialize the LLM
const model = new ChatOpenAI({
  model: CHAT_MODEL,
  temperature: 0,
});

// 2. Make all six tools available to the LLM (means llm can request these tools; it never runs them)
const modelWithTools = model.bindTools(tools);

// Of the earlier questions, only the last MAX_MESSAGES messages (starting at a human message) are sent to the model.
// The current question is always sent whole, and the saved history is not cut.
export const MAX_MESSAGES = 15;

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
  // log(`state: ${describeState(state)}`);
  const messages = await messagesForModel(state.messages);
  // log(`llm: sending ${messages.length + 1} messages to ${CHAT_MODEL} (system prompt + ${messages.length} of ${state.messages.length} saved messages, last message from "${messages.at(-1)?.getType()}")`);
  // messages.forEach((message, index) => log(`  ${index + 1}. ${describe(message)}`));

  const response = await modelWithTools.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    ...messages,
  ]);

  // const usage = response.usage_metadata;
  // log(`llm replied (${usage?.input_tokens} tokens in, ${usage?.output_tokens} out, finish: ${response.response_metadata?.finish_reason})`);
  // log(`  ${describe(response)}`);

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
  // log(`state: ${describeState(state)}`);

  if (
    lastMessage instanceof AIMessage &&
    lastMessage.tool_calls?.length
  ) {
    // const names = lastMessage.tool_calls.map((call) => call.name).join(", ");
    // log(`router: the model asked for ${lastMessage.tool_calls.length} tool(s) [${names}] -> go to "approve"`);
    return "approve";
  }

  // log("router: the model gave a final answer -> END");
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

// One finished node: what it did, how long it took, and the tokens it used (only the llm node uses tokens).
export type Step = {
  node: string;
  detail: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
};

// A run ends with an answer, or stops at an approval: then the human's decision goes to resumeAgent.
// Either way, steps lists what ran.
export type AgentResult =
  | { answer: string; steps: Step[] }
  | { approval: ApprovalRequest; steps: Step[] };

export type RunOptions = {
  recursionLimit?: number;
  signal?: AbortSignal; // abort() cancels the run
  onToken?: (text: string) => void; // each piece of the answer, as the model writes it
  onStep?: (step: Step) => void; // each time a node finishes
};

// Same threadId = same conversation: earlier messages are loaded from the checkpointer.
// Example: runAgent("What is 2 + 2?", "thread-a") returns { answer: "4", steps: [...] }
// Example: runAgent("Email ana@example.com hi", "thread-a") returns { approval: { calls: [{ name: "send_email", args: {…} }] }, steps: [...] }
export function runAgent(
  input: string,
  threadId: string,
  options: RunOptions = {},
) {
  const newQuestion = {
    messages: [new HumanMessage(input)],
    toolErrors: 0, // a new question starts with no failures
  };

  return run(newQuestion, threadId, options);
}

// Example: resumeAgent({ approve: true }, "thread-a") continues the paused run and returns { answer: "I sent the email.", steps: [...] }
export function resumeAgent(
  decision: Decision,
  threadId: string,
  options: RunOptions = {},
) {
  return run(
    new Command({ resume: decision }),
    threadId,
    options,
  );
}

// What run() remembers while it reads the stream.
export type Progress = {
  chunks: number; // how many chunks have arrived
  lastKind: string; // kind of the last chunk that was logged, so a long run of the same kind is logged once
  stepStartedAt: number; // when the current node started (ms), to time each step
  counts: { updates: number; text: number; empty: number; other: number }; // chunks per kind, for the summary log
};

// Runs the graph and reads its stream. The stream sends two kinds of chunks:
//   "updates"  one chunk each time a node finishes        -> handleNodeUpdate -> onStep
//   "messages" small pieces of text while the model writes -> handleTextChunk  -> onToken
async function run(
  input: Parameters<typeof graph.invoke>[0],
  threadId: string,
  options: RunOptions,
): Promise<AgentResult> {
  const { recursionLimit = 15, signal, onToken, onStep } = options; // a tool round uses 3 steps (llm, approve, tools)
  const steps: Step[] = [];
  const progress: Progress = {
    chunks: 0,
    lastKind: "",
    stepStartedAt: Date.now(),
    counts: { updates: 0, text: 0, empty: 0, other: 0 },
  };

  try {
    const config = {
      recursionLimit,
      signal,
      configurable: { thread_id: threadId },
      streamMode: ["updates", "messages"] as ("updates" | "messages")[],
    };

    log(`stream: start on thread "${threadId}" with streamMode ["updates", "messages"]`);
    for await (const [mode, chunk] of await graph.stream(input, config)) {
      progress.chunks++;

      if (mode === "messages") {
        handleTextChunk(chunk, progress, onToken);
      } else {
        handleNodeUpdate(chunk, progress, steps, onStep);
      }
    }

    const { counts } = progress;
    log(
      `stream: end after ${progress.chunks} chunks (${counts.updates} node updates, ${counts.text} text pieces, ` +
      `${counts.empty} chunks without text, ${counts.other} outputs of other nodes ignored)`,
    );

    return await readResult(threadId, steps);
  } catch (error) {
    // The graph ran more steps than recursionLimit allows, so LangGraph stopped it.
    if (error instanceof GraphRecursionError) {
      log(`result: stopped by the step limit (${recursionLimit}) after ${progress.chunks} chunks`);
      return {
        answer: `I stopped because the step limit (${recursionLimit}) was reached before I could finish. Please try a simpler question.`,
        steps,
      };
    }
    // The caller cancelled the run (Ctrl+C in the terminal).
    if (error instanceof Error && error.name === "AbortError") {
      log(`result: cancelled by the caller (AbortError) after ${progress.chunks} chunks`);
      return { answer: "Cancelled.", steps };
    }
    throw error;
  }
}

// Writes a log line only when the kind of chunk changes, so 30 text pieces give one line instead of 30.
// Example: logWhenKindChanges(progress, "text", "…") logs the first time, and stays quiet while the next chunks are also "text"
function logWhenKindChanges(progress: Progress, kind: string, text: string) {
  if (progress.lastKind === kind) return;

  progress.lastKind = kind;
  log(text);
}

// A "messages" chunk: a small piece of what some node is writing. Example chunk: [AIMessageChunk("Apache"), { langgraph_node: "llm" }]
// Only text from the llm node goes to onToken.
export function handleTextChunk(chunk: unknown, progress: Progress, onToken?: (text: string) => void) {
  const [message, metadata] = chunk as [BaseMessage, { langgraph_node: string }];
  const node = metadata.langgraph_node;
  const text = typeof message.content === "string" ? message.content : "";
  const where = `stream: chunk ${progress.chunks} [messages] from "${node}"`;

  if (node !== "llm") {
    // The tools node also streams its result here. That is not the model's answer.
    progress.counts.other++;
    logWhenKindChanges(progress, "other", `${where} -> ignored, not the model's text`);
    return;
  }

  if (text === "") {
    // A piece of a tool call the model is writing, or the last chunk of a message (it carries the token usage).
    progress.counts.empty++;
    // After the answer text, a log line here would land in the middle of the printed answer, so it is skipped.
    if (progress.lastKind !== "text") {
      logWhenKindChanges(progress, "empty", `${where} -> no text, nothing to print`);
    }
    return;
  }

  progress.counts.text++;
  logWhenKindChanges(progress, "text", `${where} -> text piece "${text}", printed by onToken (the next pieces are not logged)`);
  onToken?.(text);
}

// An "updates" chunk: a node has finished. Example chunk: { llm: { messages: [AIMessage], searchCount: 0, … } }
// A pause shows up as { __interrupt__: [...] }.
export function handleNodeUpdate(
  chunk: unknown,
  progress: Progress,
  steps: Step[],
  onStep?: (step: Step) => void,
) {
  const [node, update] = Object.entries(chunk as Record<string, { messages?: BaseMessage[] } | undefined>)[0];
  progress.lastKind = "updates";

  if (node === "__interrupt__") {
    log(`stream: chunk ${progress.chunks} [updates] the run paused at interrupt() and waits for a human`);
    return;
  }

  const step = makeStep(node, update?.messages ?? [], progress.stepStartedAt);
  steps.push(step);
  progress.counts.updates++;
  progress.stepStartedAt = Date.now();

  onStep?.(step); // the progress line is printed first, so the log line below starts on a fresh line
  log(`stream: chunk ${progress.chunks} [updates] node "${node}" finished in ${step.ms} ms -> onStep`);
}

// Example: makeStep("llm", [AIMessage asking for a tool], startedAt) returns { node: "llm", detail: 'ai: asks for 1 tool(s) -> …', ms: 1461, inputTokens: 1298, outputTokens: 16 }
export function makeStep(node: string, newMessages: BaseMessage[], startedAt: number): Step {
  // Only the model's message has token counts.
  const modelMessage = newMessages.find((message): message is AIMessage => message instanceof AIMessage);
  const usage = modelMessage?.usage_metadata;

  return {
    node,
    detail: newMessages.map((message) => describe(message)).join(" | "),
    ms: Date.now() - startedAt,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  };
}

// After the stream ended, the saved state of the thread says how the run ended: paused for approval, or finished with an answer.
async function readResult(threadId: string, steps: Step[]): Promise<AgentResult> {
  const saved = await graph.getState({ configurable: { thread_id: threadId } });
  log(`state: read the saved state of thread "${threadId}" (messages: ${saved.values.messages.length}, nodes still to run: [${saved.next.join(", ")}])`);

  // A run that stopped at interrupt() has a task with an interrupt; its value says what the human must decide.
  const interrupts = saved.tasks.flatMap((task) => task.interrupts);
  const pending = interrupts[0];

  if (pending) {
    log("result: paused, waiting for approval -> returning { approval }");
    return { approval: pending.value, steps };
  }

  log(`result: finished -> returning { answer } and ${steps.length} step(s)`);
  return { answer: saved.values.lastAnswer, steps };
}

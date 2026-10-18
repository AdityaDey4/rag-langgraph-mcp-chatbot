
import {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
} from "@langchain/langgraph";

import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  SystemMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";

import { CHAT_MODEL } from "./config";
import { SYSTEM_PROMPT } from "./prompt";
import { tools } from "./tools";

// Logging: lines starting with "·" show what happens INSIDE the graph, in order:
//   - what is sent to the model (the conversation so far),
//   - what the model replied (an answer, or tool requests with their arguments),
//   - which way the graph turns next.
// A tool's result is not logged when the tool runs; it shows up as "tool (...)" in the
// conversation listed at the next model call.
// They are on by default. Silence them with
//   LANGGRAPH_LOG=off npm run langgraph -- "your question"
// Example return: nothing. log("llm: sending 2 messages") prints   · llm: sending 2 messages
const LOGGING_ON = process.env.LANGGRAPH_LOG !== "off";

function log(text: string) {
  if (LOGGING_ON) console.log(`   · ${text}`);
}

// Makes text short enough for one log line: tags removed, whitespace flattened, cut to `max` characters.
// Example: shorten("<tool_result tool=\"x\">\n[ { \"chunkId\": \"fd04…\" } ]\n</tool_result>") returns '[ { "chunkId": "fd04…" } ]'
function shorten(text: string, max = 150): string {
  const flat = text.replace(/<\/?tool_result[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

// One readable line for any message in the conversation. An AI message that asks for
// a tool has EMPTY text, so its tool calls (name + arguments) are what we show.
// Examples:
//   human message         ->  human: "What is Kafka?"
//   AI message with tools ->  ai: asks for 1 tool(s) -> search_documents {"query":"Kafka"}
//   AI final answer       ->  ai: "Apache Kafka is a distributed event-streaming platform …"
//   tool result           ->  tool (search_documents, success): [ { "chunkId": "fd04038f-…
function describe(message: BaseMessage): string {
  const text = shorten(typeof message.content === "string" ? message.content : JSON.stringify(message.content));

  if (message instanceof AIMessage && message.tool_calls?.length) {
    const calls = message.tool_calls.map((call) => `${call.name} ${JSON.stringify(call.args)}`).join(" | ");
    return `ai: asks for ${message.tool_calls.length} tool(s) -> ${calls}` + (text ? ` (text: "${text}")` : "");
  }
  if (message instanceof ToolMessage) {
    return `tool (${message.name}, ${message.status ?? "success"}): ${text}`;
  }
  return `${message.getType()}: "${text}"`;
}

// 1. Initialize the LLM
const model = new ChatOpenAI({
  model: CHAT_MODEL,
  temperature: 0,
});

// 2. Make all five tools available to the LLM (means llm can request these tools)
const modelWithTools = model.bindTools(tools);

// 3. LLM node: generate a response or request tools
// Example return (a state update that LangGraph adds to the conversation):
//   the model answers:      { messages: [ AIMessage("Hello! How can I assist you today?") ] }
//   the model asks a tool:  { messages: [ AIMessage(tool_calls: [{ name: "calculate", args: { expression: "48213 * 317" } }]) ] }
async function callModel(state: typeof MessagesAnnotation.State) {
  // The model is shown the system prompt plus the whole conversation so far.
  // "last message from" tells you why it is being called: "human" = your question,
  // "tool" = a tool has just answered and the model is reading the result.
  log(`llm: sending ${state.messages.length + 1} messages to ${CHAT_MODEL} (system prompt + ${state.messages.length} conversation, last message from "${state.messages.at(-1)?.getType()}")`);
  // The conversation the model is about to read (the system prompt is left out: it is the same every time).
  state.messages.forEach((message, index) => log(`  ${index + 1}. ${describe(message)}`));

  const response = await modelWithTools.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    ...state.messages,
  ]);

  // The AI message the model just produced: its text or tool requests, token counts, and why it stopped
  // ("tool_calls" = it wants a tool, "stop" = it finished its answer).
  const usage = response.usage_metadata;
  log(`llm replied (${usage?.input_tokens} tokens in, ${usage?.output_tokens} out, finish: ${response.response_metadata?.finish_reason})`);
  log(`  ${describe(response)}`);

  return {
    messages: [response],
  };
}

// 4. Tool node: execute requested tools
const toolNode = new ToolNode(tools);

// 5. Conditional routing: tools or final answer
// Example return: the NAME of the node that runs next.
//   last message asks for a tool    ->  "tools"
//   last message is a plain answer  ->  END (the text "__end__"), so the run finishes
function shouldContinue(state: typeof MessagesAnnotation.State) {
  const lastMessage = state.messages.at(-1);

  if (
    lastMessage instanceof AIMessage &&
    lastMessage.tool_calls?.length
  ) {
    const names = lastMessage.tool_calls.map((call) => call.name).join(", ");
    log(`router: the model asked for ${lastMessage.tool_calls.length} tool(s) [${names}] -> go to "tools"`);
    return "tools";
  }

  // (The AI message itself is logged once, where it is created: "llm replied" in callModel.)
  log("router: the model gave a final answer -> END");
  return END;
}

// 6. Build and compile the graph
export const graph = new StateGraph(MessagesAnnotation)
  .addNode("llm", callModel)
  .addNode("tools", toolNode)
  .addEdge(START, "llm")
  .addConditionalEdges("llm", shouldContinue, {
    tools: "tools",
    [END]: END,
  })
  .addEdge("tools", "llm")
  .compile();

// 7. Export a reusable function for your application
// Example: runAgent("What documents are available?") returns the final answer as plain text:
//   "There is one document available: school.pdf (sections: DBMS, Redis, AI, Java, n8n, Kafka)."
export async function runAgent(
  input: string,
  history: BaseMessage[] = [],
) {
  const result = await graph.invoke(
    {
      messages: [
        ...history,
        new HumanMessage(input),
      ],
    },
    {
      recursionLimit: 15,
    },
  );

  return result.messages.at(-1)?.content ?? "";
}

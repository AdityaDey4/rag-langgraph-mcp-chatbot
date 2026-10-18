
import {
  StateGraph,
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
import { AgentState } from "./state";
import { tools } from "./tools";

// Lines starting with "·" log what goes into the model and where the graph turns.
// Turn them off with LANGGRAPH_LOG=off.
const LOGGING_ON = process.env.LANGGRAPH_LOG !== "off";

// Example: log("llm: sending 2 messages") prints "   · llm: sending 2 messages"
function log(text: string) {
  if (LOGGING_ON) console.log(`   · ${text}`);
}

// Example: shorten("<tool_result>[ 1, 2 ]</tool_result>") returns "[ 1, 2 ]"
function shorten(text: string, max = 150): string {
  const flat = text.replace(/<\/?tool_result[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

// Example: describe(aiMessage) returns 'ai: asks for 1 tool(s) -> search_documents {"query":"Kafka"}'
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

// Example: describeState(state) returns 'searchCount=1, searchQueries=["Kafka"], lastAnswer=""'
function describeState(state: typeof AgentState.State): string {
  return `searchCount=${state.searchCount}, searchQueries=${JSON.stringify(state.searchQueries)}, lastAnswer="${shorten(state.lastAnswer, 40)}"`;
}

// 1. Initialize the LLM
const model = new ChatOpenAI({
  model: CHAT_MODEL,
  temperature: 0,
});

// 2. Make all five tools available to the LLM (means llm can request these tools)
const modelWithTools = model.bindTools(tools);

// 3. LLM node: generate a response or request tools
// Example return: { messages: [ AIMessage("Kafka is …") ], searchCount: 0, searchQueries: [], lastAnswer: "Kafka is …" }
async function callModel(state: typeof AgentState.State) {
  log(`state: ${describeState(state)}`);
  log(`llm: sending ${state.messages.length + 1} messages to ${CHAT_MODEL} (system prompt + ${state.messages.length} conversation, last message from "${state.messages.at(-1)?.getType()}")`);
  state.messages.forEach((message, index) => log(`  ${index + 1}. ${describe(message)}`));

  const response = await modelWithTools.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    ...state.messages,
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

// 4. Tool node: execute requested tools
const toolNode = new ToolNode(tools);

// 5. Conditional routing: tools or final answer
// Example return: "tools" if the model asked for a tool, otherwise END
function shouldContinue(state: typeof AgentState.State) {
  const lastMessage = state.messages.at(-1);
  log(`state: ${describeState(state)}`);

  if (
    lastMessage instanceof AIMessage &&
    lastMessage.tool_calls?.length
  ) {
    const names = lastMessage.tool_calls.map((call) => call.name).join(", ");
    log(`router: the model asked for ${lastMessage.tool_calls.length} tool(s) [${names}] -> go to "tools"`);
    return "tools";
  }

  log("router: the model gave a final answer -> END");
  return END;
}

// 6. Build and compile the graph
// The state is AgentState (see state.ts): nodes return updates, and each field's reducer merges them in.
export const graph = new StateGraph(AgentState)
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
// Example: runAgent("What documents are available?") returns "There is one document available: school.pdf …"
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

  return result.lastAnswer;
}

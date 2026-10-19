
import {
  StateGraph,
  GraphRecursionError,
  START,
  END,
} from "@langchain/langgraph";

import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  SystemMessage,
  HumanMessage,
  type BaseMessage,
} from "@langchain/core/messages";

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

// 2. Make all five tools available to the LLM (means llm can request these tools; it never runs them)
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

// 4. Tool node: execute requested tools (runTools in tool-node.ts, which replaces the ready-made ToolNode)

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
  .addNode("tools", runTools)
  .addNode("giveUp", giveUp)
  .addEdge(START, "llm")
  .addConditionalEdges("llm", shouldContinue, {
    tools: "tools",
    [END]: END,
  })
  .addConditionalEdges("tools", afterTools, {
    llm: "llm",
    giveUp: "giveUp",
  })
  .addEdge("giveUp", END)
  .compile();

// 7. Export a reusable function for your application
// Example: runAgent("What documents are available?") returns "There is one document available: school.pdf …"
export async function runAgent(
  input: string,
  history: BaseMessage[] = [],
  recursionLimit = 6,
) {
  try {
    const result = await graph.invoke(
      {
        messages: [
          ...history,
          new HumanMessage(input),
        ],
      },
      {
        recursionLimit,
      },
    );

    // Every model call is one step and every tools run is one step (the give-up node counts like a model call).
    const thisRun = result.messages.slice(history.length + 1); // without the history and your question
    const modelCalls = thisRun.filter((message) => message instanceof AIMessage);
    const toolRuns = modelCalls.filter((message) => message.tool_calls?.length);
    // A run that takes N steps only finishes if the limit is at least N + 1.
    log(`Model calls: ${modelCalls.length}, tool runs: ${toolRuns.length}, total steps: ${modelCalls.length + toolRuns.length}, recursion limit: ${recursionLimit}`);

    return result.lastAnswer;
  } catch (error) {
    // The graph ran more steps than recursionLimit allows, so LangGraph stopped it.
    if (error instanceof GraphRecursionError) {
      return `I stopped because the step limit (${recursionLimit}) was reached before I could finish. Please try a simpler question.`;
    }
    throw error;
  }
}

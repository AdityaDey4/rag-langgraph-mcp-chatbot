// A small agent whose tools come from an MCP server, not from its own code:
//   START → llm ─(asks for a tool)→ tools → llm … → END
// It has no memory, no approval and no streaming: only the loop (the LangGraph work has the rest).
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { END, GraphRecursionError, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { loadTools } from "./adapter";
import { connectToServer } from "./client";
import { CHAT_MODEL } from "./config";
import { log } from "./log";
import { SYSTEM_PROMPT } from "./prompt";
import { checkNamesAreUnique, makeSafeSource, type Approve } from "./safety";
import { documentsServer, type ServerConfig } from "./servers";

export type ToolCallRecord = {
  name: string;
  args: unknown;
  isError: boolean;
};

export type AgentRun = {
  answer: string;
  toolCalls: ToolCallRecord[];
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
};

// Example: createMcpAgent() starts our server, reads its tools and returns { toolNames: ["search_documents", …], ask, close }
// With a second server: createMcpAgent([documentsServer, filesServer("C:/shared")], askAPerson)
// `approve` is asked before a tool that needs approval runs. The default says no to everything.
export async function createMcpAgent(servers: ServerConfig[] = [documentsServer], approve: Approve = async () => false) {
  // 1. Start every server and ask it for its tools. Each server sits behind its own rules (safety.ts).
  const clients: Awaited<ReturnType<typeof connectToServer>>[] = [];
  const tools = [];

  try {
    for (const config of servers) {
      const client = await connectToServer(config.server);
      clients.push(client);

      const safeSource = makeSafeSource(client, config.policy, approve);
      tools.push(...(await loadTools(safeSource)));
    }

    checkNamesAreUnique(tools.map((tool) => tool.name));
  } catch (error) {
    // Do not leave the servers that were already started running.
    await Promise.all(clients.map((client) => client.close()));
    throw error;
  }

  // The instructions of the model, plus one hint for every server that has one.
  const hints = servers.flatMap((config) => (config.hint ? [config.hint] : []));
  const systemPrompt = [SYSTEM_PROMPT, ...hints].join("\n\n");

  // 2. The model is told about the tools (it only asks for them; it never runs them).
  const model = new ChatOpenAI({ model: CHAT_MODEL, temperature: 0, maxRetries: 2 }).bindTools(tools);

  // 3. The model node: send the conversation, get an answer or a request for tools.
  async function callModel(state: typeof MessagesAnnotation.State) {
    const kinds = ["system", ...state.messages.map((message) => message.getType())].join(", ");
    log("agent", `model: sending ${state.messages.length + 1} messages (${kinds})`);

    const response = await model.invoke([new SystemMessage(systemPrompt), ...state.messages]);

    if (response.tool_calls?.length) {
      const asked = response.tool_calls.map((call) => `${call.name} ${JSON.stringify(call.args)}`).join(" | ");
      log("agent", `model replied: it asks for a tool -> ${asked}`);
    } else {
      log("agent", `model replied: a final answer (${String(response.content).length} characters)`);
    }

    return { messages: [response] };
  }

  // 4. The router: tools if the model asked for a tool, otherwise the end.
  function shouldContinue(state: typeof MessagesAnnotation.State) {
    const lastMessage = state.messages.at(-1);

    if (lastMessage instanceof AIMessage && lastMessage.tool_calls?.length) {
      log("agent", "router: the model asked for a tool -> tools node (ToolNode runs the tool)");
      return "tools";
    }

    log("agent", "router: no tool requested -> end");
    return END;
  }

  // 5. The graph. ToolNode runs each requested tool (the adapter sends the call to the server) and turns a failure into an error message.
  const graph = new StateGraph(MessagesAnnotation)
    .addNode("llm", callModel)
    .addNode("tools", new ToolNode(tools))
    .addEdge(START, "llm")
    .addConditionalEdges("llm", shouldContinue, { tools: "tools", [END]: END })
    .addEdge("tools", "llm")
    .compile();

  // 6. Ask one question.
  // Example: ask("What is Kafka?") returns { answer: "Apache Kafka is …", toolCalls: [{ name: "search_documents", args: { query: "Kafka" }, isError: false }], modelCalls: 2, inputTokens: 3500, outputTokens: 60 }
  // `history` is what was said before (the agent has no memory of its own): [{ role: "user", content: "What is Redis used for?" }, { role: "assistant", content: "…" }]
  async function ask(question: string, history: { role: "user" | "assistant"; content: string }[] = [], recursionLimit = 15): Promise<AgentRun> {
    try {
      log("agent", `question: ${question}`);
      const earlier = history.map((message) => (message.role === "user" ? new HumanMessage(message.content) : new AIMessage(message.content)));
      const result = await graph.invoke({ messages: [...earlier, new HumanMessage(question)] }, { recursionLimit });

      // Only the messages of this question (not the history).
      const lastQuestion = result.messages.findLastIndex((message) => message instanceof HumanMessage);
      const thisRun = result.messages.slice(lastQuestion + 1);

      const modelMessages = thisRun.filter((message): message is AIMessage => message instanceof AIMessage);
      const toolMessages = thisRun.filter((message): message is ToolMessage => message instanceof ToolMessage);

      const toolCalls: ToolCallRecord[] = [];
      for (const message of modelMessages) {
        for (const call of message.tool_calls ?? []) {
          const reply = toolMessages.find((toolMessage) => toolMessage.tool_call_id === call.id);
          toolCalls.push({ name: call.name, args: call.args, isError: reply?.status === "error" });
        }
      }

      return {
        answer: String(modelMessages.at(-1)?.content ?? ""),
        toolCalls,
        modelCalls: modelMessages.length,
        inputTokens: modelMessages.reduce((sum, message) => sum + (message.usage_metadata?.input_tokens ?? 0), 0),
        outputTokens: modelMessages.reduce((sum, message) => sum + (message.usage_metadata?.output_tokens ?? 0), 0),
      };
    } catch (error) {
      // The loop ran more steps than the limit allows, so LangGraph stopped it.
      if (error instanceof GraphRecursionError) {
        return {
          answer: `I stopped because the step limit (${recursionLimit}) was reached before I could finish.`,
          toolCalls: [],
          modelCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
      }
      throw error;
    }
  }

  // 7. Stop the servers (closing a client ends its process).
  async function close() {
    await Promise.all(clients.map((client) => client.close()));
  }

  return { toolNames: tools.map((tool) => tool.name), ask, close };
}

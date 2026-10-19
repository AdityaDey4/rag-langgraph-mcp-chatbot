// Lines starting with "·" log what goes into the model and where the graph turns.
// Turn them off with LANGGRAPH_LOG=off.
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

const LOGGING_ON = process.env.LANGGRAPH_LOG !== "off";

// Example: log("llm: sending 2 messages") prints "   · llm: sending 2 messages"
export function log(text: string) {
  if (LOGGING_ON) console.log(`   · ${text}`);
}

// Example: shorten("<tool_result>[ 1, 2 ]</tool_result>") returns "[ 1, 2 ]"
export function shorten(text: string, max = 150): string {
  const flat = text.replace(/<\/?tool_result[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

// Example: describe(aiMessage) returns 'ai: asks for 1 tool(s) -> search_documents {"query":"Kafka"}'
export function describe(message: BaseMessage): string {
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

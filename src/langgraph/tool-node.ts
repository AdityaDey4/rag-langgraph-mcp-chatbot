// What happens after the model asks for tools: run them, and give up if they keep failing.
// runTools does what the ready-made ToolNode does, written out so the failure handling is visible.
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { ToolCall } from "@langchain/core/messages/tool";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { describe, log, shorten } from "./log";
import type { AgentState } from "./state";
import { tools } from "./tools";

export const MAX_TOOL_ERRORS = 3;

const toolsByName: Record<string, StructuredToolInterface> = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

// Example return: for one call that worked and one that failed: { messages: [ToolMessage(success), ToolMessage(error)], toolErrors: 1 } (when none had failed before)
export async function runTools(state: typeof AgentState.State) {
  const lastMessage = state.messages.at(-1) as AIMessage; // the AI message that asked for the tools
  const results = await Promise.all((lastMessage.tool_calls ?? []).map(runOne)); // the calls run side by side
  const failed = results.filter((result) => result.status === "error").length;

  log(`Last Message: ${describe(lastMessage)} -> ${results.length} tool calls completed, ${failed} failed`);
  return {
    messages: results,
    toolErrors: state.toolErrors + failed,
  };
}

// Example: runOne({ id: "call_1", name: "calculate", args: { expression: "1 / 0" } }) returns a ToolMessage with status "error", content "Error: Division by zero. …" and tool_call_id "call_1"
async function runOne(call: ToolCall): Promise<ToolMessage> {
  const tool = toolsByName[call.name];
  let result: ToolMessage;

  if (!tool) {
    result = errorMessage(call, `There is no tool called "${call.name}". Available tools: ${Object.keys(toolsByName).join(", ")}.`);
  } else {
    try {
      // Given a tool call, the tool checks the arguments, runs, and returns a ToolMessage with the same tool_call_id.
      result = await tool.invoke({ ...call, type: "tool_call" });
    } catch (error) {
      result = errorMessage(call, error instanceof Error ? error.message : String(error));
    }
  }

  log(`tools: ${call.name} ${JSON.stringify(call.args)} (id ${call.id?.slice(0, 12)}) -> ${result.status}: ${shorten(String(result.content), 100)}`);
  return result;
}

// Example: errorMessage(call, "Division by zero.") returns a ToolMessage with status "error" that tells the model what to do next
function errorMessage(call: ToolCall, problem: string): ToolMessage {
  return new ToolMessage({
    content: `Error: ${problem}\nYou may fix the arguments and try again, or explain the problem to the user.`,
    tool_call_id: call.id ?? "",
    name: call.name,
    status: "error",
  });
}

// Example return: "llm" (back to the model) while fewer than 3 tool calls have failed, otherwise "giveUp"
export function afterTools(state: typeof AgentState.State) {
  if (state.toolErrors >= MAX_TOOL_ERRORS) {
    log(`router: ${state.toolErrors} tool calls have failed -> give up`);
    return "giveUp";
  }
  return "llm";
}

// Example return: { messages: [ AIMessage("I stopped because 3 tool calls failed. …") ], lastAnswer: "I stopped because 3 tool calls failed. …" }
export function giveUp(state: typeof AgentState.State) {
  const text = `I stopped because ${state.toolErrors} tool calls failed. Please try rephrasing the question.`;
  return { messages: [new AIMessage(text)], lastAnswer: text };
}

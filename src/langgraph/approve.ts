// The approval step: before a risky tool runs, the graph pauses and a human decides.
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import { log } from "./log";
import type { AgentState } from "./state";

export const RISKY_TOOLS = ["send_email"];

// What the human answers: approve or not, and optionally new values for the arguments.
export type Decision = { approve: boolean; args?: Record<string, unknown> };

// Example: for a message asking for send_email, pauses until resumed; { approve: true } then returns {}, { approve: false } returns one rejection ToolMessage per call
export function approve(state: typeof AgentState.State) {
  const asked = state.messages.at(-1) as AIMessage; // the AI message that asked for the tools
  const calls = asked.tool_calls ?? [];
  const risky = calls.filter((call) => RISKY_TOOLS.includes(call.name));

  if (risky.length === 0) {
    log(`approval: no risky calls in ${calls.length} tool(s) -> continue`);
    return {};
  }

  // The run stops here and the payload goes to the caller. On resume this node runs again from the top, and interrupt() returns the answer.
  const decision = interrupt({
    calls: risky.map((call) => ({ name: call.name, args: call.args })),
  }) as Decision;

  const edit = decision.args ? ` with new arguments ${JSON.stringify(decision.args)}` : "";
  log(`approval: ${decision.approve ? "approved" : "rejected"}${edit}`);

  if (!decision.approve) {
    // Every tool call needs an answer, so all calls of this message get one.
    const rejected = calls.map(
      (call) =>
        new ToolMessage({
          content: "Not run: the user rejected this step. Do not try it again; tell the user it was not done.",
          tool_call_id: call.id ?? "",
          name: call.name,
          status: "error",
        }),
    );
    return { messages: rejected };
  }

  if (decision.args) {
    // Only the risky calls get the new arguments.
    const edited = calls.map((call) => {
      if (!RISKY_TOOLS.includes(call.name)) {
        return call;
      }
      return { ...call, args: { ...call.args, ...decision.args } };
    });

    // Same id as the original message, so the reducer replaces it instead of adding a second one.
    const replacement = new AIMessage({
      id: asked.id,
      content: asked.content,
      tool_calls: edited,
    });
    return { messages: [replacement] };
  }

  return {};
}

// Example return: "tools" after an approval, "llm" after a rejection (the model then sees the rejection)
export function afterApprove(state: typeof AgentState.State) {
  const lastMessage = state.messages.at(-1);
  log(`state: ${lastMessage ? lastMessage.id : "no messages"} -> ${lastMessage instanceof ToolMessage ? "llm" : "tools"}`);

  return lastMessage instanceof ToolMessage ? "llm" : "tools";
}

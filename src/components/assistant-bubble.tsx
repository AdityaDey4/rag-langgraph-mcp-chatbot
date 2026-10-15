import { formatAnswer } from "@/lib/agent/trace";
import type { AssistantMessage } from "./chat-types";
import { CitationChips } from "./citation-chips";
import { TraceTimeline } from "./trace-timeline";

const STOP_LABELS: Record<string, string> = {
  max_steps: "step limit reached",
  max_tool_calls: "tool-call limit reached",
  max_tokens: "token limit reached",
  timeout: "time limit reached",
  repeated_calls: "repeated tool calls",
};

export function AssistantBubble({ message }: { message: AssistantMessage }) {
  const streaming = message.status === "streaming";
  const text = formatAnswer(message.content, message.citations);
  const waiting = streaming && text === "";

  return (
    <div
      className="max-w-[85%] rounded-2xl bg-gray-800 px-4 py-3 text-gray-100"
      aria-busy={streaming}
    >
      {message.mode === "agent" && (
        <TraceTimeline events={message.events} streaming={streaming} />
      )}

      <div aria-live="polite">
        {waiting ? (
          <span className="animate-pulse text-gray-400">
            {message.mode === "agent" ? "Working…" : "Thinking…"}
          </span>
        ) : (
          <p className="whitespace-pre-wrap leading-6">{text}</p>
        )}
      </div>

      {message.status === "stopped" && (
        <p className="mt-2 text-xs text-amber-300">Stopped.</p>
      )}
      {message.status === "error" && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {message.error ?? "Something went wrong."}
        </p>
      )}

      <CitationChips citations={message.citations} />

      {message.totals && (
        <p className="mt-3 border-t border-gray-700 pt-2 text-xs text-gray-400">
          {message.totals.steps} {message.totals.steps === 1 ? "step" : "steps"}{" "}
          · {message.totals.toolCalls} tool{" "}
          {message.totals.toolCalls === 1 ? "call" : "calls"} ·{" "}
          {message.totals.inputTokens + message.totals.outputTokens} tokens ·{" "}
          {message.totals.costUsd === null
            ? "cost n/a"
            : `~$${message.totals.costUsd.toFixed(5)}`}{" "}
          · {(message.totals.latencyMs / 1000).toFixed(1)} s
          {message.stoppedBy && (
            <span className="text-amber-300">
              {" "}
              · stopped early: {STOP_LABELS[message.stoppedBy] ?? message.stoppedBy}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

import { buildTrace, type TraceCall } from "@/lib/agent/trace";
import type { AgentEvent } from "@/lib/agent/types";

const STATUS_STYLES: Record<TraceCall["status"], string> = {
  running: "bg-amber-500/15 text-amber-300",
  ok: "bg-emerald-500/15 text-emerald-300",
  error: "bg-red-500/15 text-red-300",
};

const STATUS_LABELS: Record<TraceCall["status"], string> = {
  running: "running",
  ok: "ok",
  error: "error",
};

export function TraceTimeline({
  events,
  streaming,
}: {
  events: AgentEvent[];
  streaming: boolean;
}) {
  const steps = buildTrace(events);
  if (steps.length === 0) return null;

  const toolCalls = steps.reduce((sum, step) => sum + step.calls.length, 0);

  return (
    <details
      open={streaming}
      className="mb-3 rounded-xl border border-gray-700 bg-gray-900/60 text-sm"
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-gray-300">
        Trace · {steps.length} {steps.length === 1 ? "step" : "steps"} ·{" "}
        {toolCalls} tool {toolCalls === 1 ? "call" : "calls"}
      </summary>

      <ol className="space-y-3 border-t border-gray-800 px-3 py-3">
        {steps.map((step) => (
          <li key={step.step}>
            <div className="flex items-baseline justify-between text-xs text-gray-400">
              <span className="font-medium text-gray-200">Step {step.step}</span>
              {step.inputTokens !== undefined && (
                <span>
                  {step.inputTokens} in / {step.outputTokens} out tokens
                </span>
              )}
            </div>

            {step.calls.length === 0 ? (
              <p className="mt-1 text-xs text-gray-500">
                Model answered without calling a tool.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {step.calls.map((call) => (
                  <li
                    key={call.callId}
                    className="rounded-lg border border-gray-800 bg-gray-950/60 p-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="font-mono text-xs text-blue-300">
                        {call.name}
                      </code>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_STYLES[call.status]} ${
                          call.status === "running" ? "animate-pulse" : ""
                        }`}
                      >
                        {STATUS_LABELS[call.status]}
                      </span>
                      {call.durationMs !== undefined && (
                        <span className="text-[11px] text-gray-500">
                          {call.durationMs} ms
                        </span>
                      )}
                      {call.truncated && (
                        <span className="text-[11px] text-gray-500">
                          truncated
                        </span>
                      )}
                    </div>

                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-gray-400">
                      {formatArgs(call.args)}
                    </pre>

                    {call.preview && (
                      <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-black/30 p-1.5 font-mono text-[11px] text-gray-300">
                        {call.preview}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

function formatArgs(args: unknown): string {
  return typeof args === "string" ? args : JSON.stringify(args);
}

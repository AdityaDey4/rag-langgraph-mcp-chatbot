import type { AgentEvent } from "./types";

export type TraceCall = {
  callId: string;
  name: string;
  args: unknown;
  status: "running" | "ok" | "error";
  durationMs?: number;
  preview?: string;
  truncated?: boolean;
};

export type TraceStep = {
  step: number;
  inputTokens?: number;
  outputTokens?: number;
  calls: TraceCall[];
};

/** Turn the flat event list into the step -> tool calls timeline the UI shows. */
export function buildTrace(events: AgentEvent[]): TraceStep[] {
  const steps: TraceStep[] = [];

  const stepFor = (number: number): TraceStep => {
    let step = steps.find((candidate) => candidate.step === number);
    if (!step) {
      step = { step: number, calls: [] };
      steps.push(step);
    }
    return step;
  };

  for (const event of events) {
    switch (event.type) {
      case "step_start":
        stepFor(event.step);
        break;
      case "usage": {
        const step = stepFor(event.step);
        step.inputTokens = event.inputTokens;
        step.outputTokens = event.outputTokens;
        break;
      }
      case "tool_call":
        stepFor(event.step).calls.push({
          callId: event.callId,
          name: event.name,
          args: event.args,
          status: "running",
        });
        break;
      case "tool_result": {
        const call = stepFor(event.step).calls.find(
          (candidate) => candidate.callId === event.callId
        );
        if (call) {
          call.status = event.isError ? "error" : "ok";
          call.durationMs = event.durationMs;
          call.preview = event.preview;
          call.truncated = event.truncated;
        }
        break;
      }
    }
  }

  return steps;
}

const CITATION_MARKER =
  /\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;

/**
 * Replace raw `[chunkId]` markers with numbered `[1]`, `[2]` ones matching the
 * citation chips. Markers that are not (yet) known citations, e.g. while the
 * answer is still streaming, are hidden rather than shown as raw ids.
 */
export function formatAnswer(
  text: string,
  citations: Array<{ chunkId: string }>
): string {
  return text.replace(CITATION_MARKER, (_match, id: string) => {
    const index = citations.findIndex(
      (citation) => citation.chunkId.toLowerCase() === id.toLowerCase()
    );
    return index === -1 ? "" : `[${index + 1}]`;
  });
}

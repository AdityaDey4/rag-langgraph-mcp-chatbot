import type {
  AgentEvent,
  RunTotals,
  SourceRef,
  StopReason,
} from "@/lib/agent/types";

export type Mode = "classic" | "agent";

export type UserMessage = {
  id: string;
  role: "user";
  content: string;
};

export type AssistantMessage = {
  id: string;
  role: "assistant";
  mode: Mode;
  content: string;
  status: "streaming" | "done" | "error" | "stopped";
  /** Agent mode only: every event except the answer text deltas. */
  events: AgentEvent[];
  citations: SourceRef[];
  totals?: RunTotals;
  stoppedBy?: StopReason | null;
  error?: string;
};

export type ChatMessage = UserMessage | AssistantMessage;

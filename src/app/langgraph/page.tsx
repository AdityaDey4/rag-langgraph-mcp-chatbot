import type { Metadata } from "next";
import { Chat } from "./chat";

export const metadata: Metadata = {
  title: "LangGraph agent",
};

// The page at /langgraph. The chat itself is in chat.tsx.
export default function LangGraphPage() {
  return <Chat />;
}

"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { parseSseStream } from "@/lib/agent/sse";
import type { AgentEvent } from "@/lib/agent/types";
import { AssistantBubble } from "@/components/assistant-bubble";
import type {
  AssistantMessage,
  ChatMessage,
  Mode,
} from "@/components/chat-types";

const MODE_STORAGE_KEY = "rag-chatbot:mode";

export default function Home() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>("classic");
  const [conversationId, setConversationId] = useState(() =>
    crypto.randomUUID()
  );

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Remembered per browser. Read after mount so server and client render the same HTML.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODE_STORAGE_KEY);
      if (saved === "classic" || saved === "agent") setMode(saved);
    } catch {
      // storage unavailable (private window, blocked): keep the default
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  function chooseMode(next: Mode) {
    setMode(next);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // not critical
    }
  }

  function newChat() {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(crypto.randomUUID());
  }

  function updateAssistant(
    id: string,
    change: (message: AssistantMessage) => AssistantMessage
  ) {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === id && message.role === "assistant"
          ? change(message)
          : message
      )
    );
  }

  function applyEvent(id: string, event: AgentEvent) {
    switch (event.type) {
      case "answer_delta":
        updateAssistant(id, (m) => ({ ...m, content: m.content + event.text }));
        break;
      case "step_start":
        // Text from an earlier step was narration before a tool call: start fresh.
        updateAssistant(id, (m) => ({
          ...m,
          content: "",
          events: [...m.events, event],
        }));
        break;
      case "final":
        updateAssistant(id, (m) => ({
          ...m,
          content: event.answer,
          citations: event.citations,
          totals: event.totals,
          stoppedBy: event.stoppedBy,
          status: "done",
          events: [...m.events, event],
        }));
        break;
      case "error":
        updateAssistant(id, (m) => ({
          ...m,
          status: "error",
          error: event.message,
          events: [...m.events, event],
        }));
        break;
      default:
        updateAssistant(id, (m) => ({ ...m, events: [...m.events, event] }));
    }
  }

  async function askClassic(id: string, text: string, signal: AbortSignal) {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, question: text }),
      signal,
    });
    if (!response.ok) throw new Error("Failed to get response");

    const data = await response.json();
    updateAssistant(id, (m) => ({
      ...m,
      content: data.answer ?? "",
      status: "done",
    }));
  }

  async function askAgent(id: string, text: string, signal: AbortSignal) {
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, question: text }),
      signal,
    });

    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error?.message ?? "Failed to start the agent");
    }

    let finished = false;
    for await (const event of parseSseStream(response.body)) {
      if (event.type === "final" || event.type === "error") finished = true;
      applyEvent(id, event);
    }

    if (!finished) {
      updateAssistant(id, (m) => ({
        ...m,
        status: "error",
        error: "The connection closed before the agent finished.",
      }));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const text = question.trim();
    if (!text || loading) return;

    const assistantId = crypto.randomUUID();
    const controller = new AbortController();
    abortRef.current = controller;

    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: text },
      {
        id: assistantId,
        role: "assistant",
        mode,
        content: "",
        status: "streaming",
        events: [],
        citations: [],
      },
    ]);
    setQuestion("");
    setLoading(true);

    try {
      if (mode === "agent") {
        await askAgent(assistantId, text, controller.signal);
      } else {
        await askClassic(assistantId, text, controller.signal);
      }
    } catch (error) {
      const stopped = controller.signal.aborted;
      updateAssistant(assistantId, (m) =>
        m.status === "done" || m.status === "error"
          ? m
          : {
              ...m,
              status: stopped ? "stopped" : "error",
              error: stopped
                ? undefined
                : error instanceof Error
                  ? error.message
                  : "Something went wrong. Please try again.",
            }
      );
    } finally {
      // Whatever happened, a message must never be left "streaming".
      updateAssistant(assistantId, (m) =>
        m.status === "streaming" ? { ...m, status: "stopped" } : m
      );
      setLoading(false);
      abortRef.current = null;
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col">
      <div className="w-full max-w-3xl mx-auto flex flex-col h-screen">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-6 py-4">
          <h1 className="text-xl font-semibold text-white">RAG Chat</h1>

          <div className="flex items-center gap-3">
            <div
              role="group"
              aria-label="Answer mode"
              className="flex rounded-lg border border-gray-700 p-0.5 text-sm"
            >
              {(["classic", "agent"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={mode === option}
                  disabled={loading}
                  onClick={() => chooseMode(option)}
                  className={`rounded-md px-3 py-1 transition-colors disabled:cursor-not-allowed ${
                    mode === option
                      ? "bg-blue-600 text-white"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  {option === "classic" ? "Classic RAG" : "Agent"}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={newChat}
              className="rounded-lg border border-gray-700 px-3 py-1 text-sm text-gray-300 hover:border-gray-500"
            >
              New chat
            </button>
          </div>
        </div>

        {/* Conversation */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 mt-20">
              <p>Ask something about your document</p>
              <p className="mt-2 text-sm text-gray-500">
                {mode === "agent"
                  ? "Agent mode: the model picks its own tools and you can watch every step."
                  : "Classic mode: one fixed search, then an answer."}
              </p>
            </div>
          )}

          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl bg-blue-600 px-4 py-3 text-white">
                  <p className="whitespace-pre-wrap leading-6">
                    {message.content}
                  </p>
                </div>
              </div>
            ) : (
              <div key={message.id} className="flex justify-start">
                <AssistantBubble message={message} />
              </div>
            )
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-gray-800 p-4">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question..."
              aria-label="Your question"
              maxLength={2000}
              disabled={loading}
              className="flex-1 rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-white placeholder-gray-500 outline-none focus:border-blue-500 disabled:opacity-50"
            />

            {loading ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="rounded-xl bg-red-600 px-5 py-3 font-medium text-white hover:bg-red-500"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!question.trim()}
                className="rounded-xl bg-blue-600 px-5 py-3 font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send
              </button>
            )}
          </form>
        </div>
      </div>
    </main>
  );
}

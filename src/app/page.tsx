"use client";

import { FormEvent, useState } from "react";

const conversationId = "test-002";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function Home() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!question.trim() || loading) return;

    const currentQuestion = question.trim();

    setMessages((prev) => [
      ...prev,
      { role: "user", content: currentQuestion },
    ]);

    setQuestion("");
    setLoading(true);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId,
          question: currentQuestion,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to get response");
      }

      const data = await response.json();

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer,
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Something went wrong. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col">
      <div className="w-full max-w-3xl mx-auto flex flex-col h-screen">

        {/* Header */}
        <div className="border-b border-gray-800 px-6 py-4">
          <h1 className="text-xl font-semibold text-white">
            RAG Chat
          </h1>
        </div>

        {/* Conversation */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 mt-20">
              Ask something about your document
            </div>
          )}

          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${
                message.role === "user"
                  ? "justify-end"
                  : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  message.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-100"
                }`}
              >
                <p className="whitespace-pre-wrap leading-6">
                  {message.content}
                </p>
              </div>
            </div>
          ))}

          {/* Loader */}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-800 text-gray-300 rounded-2xl px-4 py-3">
                <span className="animate-pulse">
                  Thinking...
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-gray-800 p-4">
          <form
            onSubmit={handleSubmit}
            className="flex gap-3"
          >
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question..."
              disabled={loading}
              className="flex-1 rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-white placeholder-gray-500 outline-none focus:border-blue-500 disabled:opacity-50"
            />

            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="rounded-xl bg-blue-600 px-5 py-3 font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "..." : "Send"}
            </button>
          </form>
        </div>

      </div>
    </main>
    
  );
}
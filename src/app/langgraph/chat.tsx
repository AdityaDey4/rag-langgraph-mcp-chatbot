"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

// 1. The shapes used on this page.
type Message = {
  role: "user" | "assistant" | "error";
  text: string;
};

type Call = {
  name: string;
  args: Record<string, unknown>;
};

// 2. The chat. It talks to POST /api/langgraph (see src/langgraph/api.ts).
export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);

  // The server picks the threadId on the first answer. Sending it back keeps the conversation.
  const [threadId, setThreadId] = useState<string | null>(null);

  // A run that is waiting for a human to approve a tool call.
  const [pendingCalls, setPendingCalls] = useState<Call[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [editedArgs, setEditedArgs] = useState("");

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pendingCalls, loading]);

  function addMessage(role: Message["role"], text: string) {
    setMessages((previous) => [...previous, { role, text }]);
  }

  // 3. Send one request and show what comes back: an answer, an approval request, or an error.
  async function send(body: Record<string, unknown>) {
    setLoading(true);

    try {
      const response = await fetch("/api/langgraph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();

      if (!response.ok) {
        addMessage("error", data.error ?? "Something went wrong.");
        return;
      }

      setThreadId(data.threadId);

      if (data.status === "needs_approval") {
        setPendingCalls(data.approval.calls);
        setEditedArgs(JSON.stringify(data.approval.calls[0].args, null, 2));
      } else {
        addMessage("assistant", data.answer);
      }
    } catch {
      addMessage("error", "Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  // 4. The user asks a question.
  async function ask(event: FormEvent) {
    event.preventDefault();

    const text = question.trim();
    if (!text || loading || pendingCalls) return;

    addMessage("user", text);
    setQuestion("");

    await send({ question: text, threadId: threadId ?? undefined });
  }

  // 5. The user decides about the tool call that is waiting.
  async function decide(approve: boolean) {
    let args: Record<string, unknown> | undefined;

    if (approve && editing) {
      try {
        args = JSON.parse(editedArgs);
      } catch {
        addMessage("error", "The arguments are not valid JSON.");
        return;
      }
    }

    const calls = pendingCalls;
    setPendingCalls(null);
    setEditing(false);
    // Show what was really approved, because the model's own reply may still repeat the first request.
    const approved = args ? `Approved ${calls?.[0].name} with ${JSON.stringify(args)}.` : `Approved ${calls?.[0].name}.`;
    addMessage("user", approve ? approved : `Rejected ${calls?.[0].name}.`);

    await send({ threadId, decision: { approve, args } });
  }

  function newChat() {
    setMessages([]);
    setThreadId(null);
    setPendingCalls(null);
    setEditing(false);
  }

  return (
    <main className="mx-auto flex h-screen w-full max-w-2xl flex-col p-4">
      <header className="flex items-center justify-between border-b border-black/10 pb-3 dark:border-white/15">
        <div>
          <h1 className="text-lg font-semibold">LangGraph agent</h1>
          <p className="text-xs opacity-60">{threadId ? `Thread ${threadId.slice(0, 8)}` : "New conversation"}</p>
        </div>

        <button onClick={newChat} className="rounded-md border border-black/15 px-3 py-1 text-sm dark:border-white/20">
          New chat
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto py-4">
        {messages.length === 0 && (
          <p className="text-sm opacity-60">
            Ask about your documents, or try: &ldquo;Send an email to ana@example.com with subject Hi and body Hello&rdquo;.
          </p>
        )}

        {messages.map((message, index) => (
          <div key={index} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <p
              className={
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm " +
                (message.role === "user"
                  ? "bg-blue-600 text-white"
                  : message.role === "error"
                    ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
                    : "bg-black/5 dark:bg-white/10")
              }
            >
              {message.text}
            </p>
          </div>
        ))}

        {pendingCalls && (
          <div className="rounded-xl border border-amber-500 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
            <p className="font-semibold">The agent wants to run a tool and needs your approval.</p>

            {pendingCalls.map((call, index) => (
              <p key={index} className="mt-2 font-mono text-xs">
                {call.name}({JSON.stringify(call.args)})
              </p>
            ))}

            {editing && (
              <textarea
                value={editedArgs}
                onChange={(event) => setEditedArgs(event.target.value)}
                rows={6}
                className="mt-3 w-full rounded-md border border-amber-500 bg-white p-2 font-mono text-xs text-black"
              />
            )}

            <div className="mt-3 flex gap-2">
              <button onClick={() => decide(true)} disabled={loading} className="rounded-md bg-green-600 px-3 py-1 text-white disabled:opacity-50">
                {editing ? "Approve with changes" : "Approve"}
              </button>
              <button onClick={() => setEditing(!editing)} disabled={loading} className="rounded-md border border-amber-600 px-3 py-1 disabled:opacity-50">
                {editing ? "Cancel edit" : "Edit"}
              </button>
              <button onClick={() => decide(false)} disabled={loading} className="rounded-md bg-red-600 px-3 py-1 text-white disabled:opacity-50">
                Reject
              </button>
            </div>
          </div>
        )}

        {loading && <p className="text-sm opacity-60">Thinking…</p>}

        <div ref={bottomRef} />
      </div>

      <form onSubmit={ask} className="flex gap-2 border-t border-black/10 pt-3 dark:border-white/15">
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          disabled={loading || pendingCalls !== null}
          placeholder={pendingCalls ? "Approve or reject first" : "Ask a question"}
          maxLength={2000}
          className="flex-1 rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
        />
        <button
          type="submit"
          disabled={loading || pendingCalls !== null || !question.trim()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </main>
  );
}

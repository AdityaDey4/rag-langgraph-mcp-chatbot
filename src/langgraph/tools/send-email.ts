import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { wrapToolResult } from "../prompt";

// The tool calls that already sent an email. The same call is never sent twice (idempotency).
const sentCalls = new Set<string>();

// A pretend "risky" tool: it only prints, nothing is really sent. approve.ts makes a human approve it first.
export const sendEmail = tool(
  // Example: { to: "ana@example.com", subject: "Hi", body: "Hello" } returns "Email sent to ana@example.com (simulated, nothing was really sent)."
  async ({ to, subject }, config) => {
    // 1. If this exact tool call already ran (a retry or a replay), do not send again.
    const callId = config?.toolCall?.id;
    if (callId && sentCalls.has(callId)) {
      return wrapToolResult("send_email", "This email was already sent. Nothing was sent again.");
    }
    if (callId) sentCalls.add(callId);

    console.log(`   ✉ SENDING EMAIL to ${to}: "${subject}"`);
    return wrapToolResult("send_email", `Email sent to ${to} (simulated, nothing was really sent).`);
  },
  {
    name: "send_email",
    description:
      "Send an email to one person. Use it only when the user explicitly asks you to send an email. " +
      "A human approves every email before it is sent, so just request it.",
    schema: z.object({
      to: z.string().email().describe("Recipient email address."),
      subject: z.string().min(1).max(200).describe("Email subject."),
      body: z.string().min(1).max(5000).describe("Email text."),
    }),
    verboseParsingErrors: true,
  }
);

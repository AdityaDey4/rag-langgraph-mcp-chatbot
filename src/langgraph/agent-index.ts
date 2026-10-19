// Run the agent from the terminal:  npm run langgraph -- "your question"
// Without a question it runs the Phase 4 demo: two questions in thread "a", then one in thread "b".
import { createInterface } from "node:readline/promises";
import { resumeAgent, runAgent, type AgentResult } from "./agent";
import type { Decision } from "./approve";
import { log } from "./log";

const question = process.argv.slice(2).join(" ");
const terminal = createInterface({ input: process.stdin, output: process.stdout });

// Example: for a pending send_email, prints the call and returns { approve: true } after you type "y"; "e" lets you type new arguments as JSON
async function askHuman(calls: { name: string; args: Record<string, unknown> }[]): Promise<Decision> {
  for (const call of calls) {
    console.log(`\n  ⏸  The agent wants to run ${call.name} ${JSON.stringify(call.args)}`);
  }

  const answer = await terminal.question("  Approve? [y]es / [n]o / [e]dit: ");
  const reply = answer.trim().toLowerCase();

  if (reply === "e") {
    const json = await terminal.question('  New arguments as JSON, e.g. {"to":"bob@example.com"}: ');
    return { approve: true, args: JSON.parse(json) };
  }

  return { approve: reply === "y" };
}

// Example: prints "[a] Question: What is 2 + 2?", then "[a] Answer: 4"
async function ask(threadId: string, text: string) {
  console.log(`\n[${threadId}] Question: ${text}`);
  let result: AgentResult = await runAgent(text, threadId);
  log(`${threadId}] Result: ${JSON.stringify(result)}`);

  // Each pause asks the human, then continues the same thread.
  while ("approval" in result) {
    const decision = await askHuman(result.approval.calls);
    result = await resumeAgent(decision, threadId);
  }

  console.log(`[${threadId}] Answer: ${result.answer}`);
}

async function main() {
  if (question) return ask("a", question);
  // await ask("a", "What is 48213 * 317? then send an email to : dayadi424@gmail.com");
  // await ask("a", "Now divide that result by 3.");
  // await ask("b", "Now divide that result by 3.");
}

main()
  .catch((error) => {
    console.error("Agent failed:", error);
    process.exitCode = 1;
  })
  .finally(() => terminal.close());

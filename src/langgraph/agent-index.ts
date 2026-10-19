// Run the agent from the terminal:  npm run langgraph -- "your question"
// Without a question it runs the Phase 4 demo: two questions in thread "a", then one in thread "b".
import { runAgent } from "./agent";

const question = process.argv.slice(2).join(" ") || "Show me the passage with chunk id abc123, and if that does not work tell me what Kafka is";

// Example: prints "[a] Question: What is 2 + 2?", then "[a] Answer: 4"
async function ask(threadId: string, text: string) {
  console.log(`\n[${threadId}] Question: ${text}`);
  console.log(`[${threadId}] Answer: ${await runAgent(text, threadId)}`);
}

async function main() {
  if (question) await ask("a", question);
  await ask("a", "What is 48213 * 317?");
  await ask("a", "Now divide that result by 3.");
  await ask("b", "Now divide that result by 3.");
}

main().catch((error) => {
  console.error("Agent failed:", error);
  process.exit(1);
});

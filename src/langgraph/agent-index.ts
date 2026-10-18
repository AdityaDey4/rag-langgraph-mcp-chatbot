// Try the agent from the terminal:
//
//   npx tsx src/langgraph/agent-index.ts "What documents are available?"
//
// With no question given, it asks the default one below.
import { runAgent } from "./agent";

const question = process.argv.slice(2).join(" ") || "What documents are available? Comparison between kafka and redis ?what's todays date? 23 * 34 = ?";

// `await` is wrapped in a function because this project's scripts are CommonJS,
// which does not allow `await` at the top level of a file.
// Example return: nothing (void). It prints instead:
//   Question: What is Kafka?
//   Answer: Apache Kafka is a distributed event-streaming platform ...
async function main() {
  console.log(`Question: ${question}\n`);
  const answer = await runAgent(question);
  console.log(`Answer: ${answer}`);
}

main().catch((error) => {
  console.error("Agent failed:", error);
  process.exit(1);
});

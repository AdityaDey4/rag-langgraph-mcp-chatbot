// Run the agent from the terminal:  npm run langgraph -- "your question"
import { runAgent } from "./agent";

const question = process.argv.slice(2).join(" ") || "Show me the passage with chunk id abc123, and if that does not work tell me what Kafka is";

// Example: prints "Question: What is Kafka?", then "Answer: Apache Kafka is a distributed …"
async function main() {
  console.log(`Question: ${question}\n`);
  const answer = await runAgent(question);
  console.log(`Answer: ${answer}`);
}

main().catch((error) => {
  console.error("Agent failed:", error);
  process.exit(1);
});

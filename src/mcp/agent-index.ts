// Ask the MCP agent a question from the terminal:  npm run mcp:agent -- "What is Kafka?"
// It starts our MCP server as a subprocess, uses the tools that the server lists, and stops the server at the end.
import { createMcpAgent } from "./agent";

const question = process.argv.slice(2).join(" ") || "What is Kafka? Answer in one sentence.";

async function main() {
  const agent = await createMcpAgent();

  try {
    console.log("Tools found on the server:", agent.toolNames.join(", "));
    console.log("\nQuestion:", question);

    const run = await agent.ask(question);

    for (const call of run.toolCalls) {
      console.log(`  tool: ${call.name} ${JSON.stringify(call.args)}${call.isError ? "  (failed)" : ""}`);
    }

    console.log("\nAnswer:", run.answer);
    console.log(`\n${run.modelCalls} model calls, ${run.toolCalls.length} tool calls, ${run.inputTokens} tokens in, ${run.outputTokens} out`);
  } finally {
    await agent.close();
  }
}

main().catch((error) => {
  console.error("MCP agent failed:", error);
  process.exitCode = 1;
});

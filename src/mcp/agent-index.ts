// Ask the MCP agent a question from the terminal:
//   npm run mcp:agent -- "What is Kafka?"
//   npm run mcp:agent -- --files C:/shared "What is in notes.txt? Then save a file called todo.txt that says: buy milk"
// It starts our MCP server (and, with --files, the reference filesystem server limited to that folder) as subprocesses.
// A tool that needs approval (writing a file) asks you here first.
import { createInterface } from "node:readline/promises";
import { createMcpAgent } from "./agent";
import type { Approve } from "./safety";
import { documentsServer, filesServer } from "./servers";

// 1. The arguments: an optional --files <folder>, then the question.
const args = process.argv.slice(2);
const filesFlag = args.indexOf("--files");
const folder = filesFlag >= 0 ? args[filesFlag + 1] : undefined;
const question = args.filter((_, index) => filesFlag < 0 || (index !== filesFlag && index !== filesFlag + 1)).join(" ") || "What is Kafka? Answer in one sentence.";

const terminal = createInterface({ input: process.stdin, output: process.stdout });

// 2. The approval: show what is about to run and wait for a yes.
// Example: askAPerson({ server: "files", tool: "write_file", args: { path: "…", content: "buy milk" } }) prints the call and returns true after you type "y"
const askAPerson: Approve = async ({ server, tool, args }) => {
  console.log(`\n  ⏸  The ${server} server wants to run ${tool} ${JSON.stringify(args)}`);
  const answer = await terminal.question("  Allow it? [y]es / [n]o: ");

  return answer.trim().toLowerCase() === "y";
};

async function main() {
  const servers = folder ? [documentsServer, filesServer(folder)] : [documentsServer];
  const agent = await createMcpAgent(servers, askAPerson);

  try {
    console.log("Tools the agent may use:", agent.toolNames.join(", "));
    console.log("\nQuestion:", question);

    const run = await agent.ask(question);

    for (const call of run.toolCalls) {
      console.log(`  tool: ${call.name} ${JSON.stringify(call.args)}${call.isError ? "  (failed)" : ""}`);
    }

    console.log("\nAnswer:", run.answer);
    console.log(`\n${run.modelCalls} model calls, ${run.toolCalls.length} tool calls, ${run.inputTokens} tokens in, ${run.outputTokens} out`);
  } finally {
    await agent.close();
    terminal.close();
  }
}

main().catch((error) => {
  console.error("MCP agent failed:", error);
  process.exitCode = 1;
  terminal.close();
});

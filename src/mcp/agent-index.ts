// Ask the MCP agent a question from the terminal:
//   npm run mcp:agent -- "What is Kafka?"
//   npm run mcp:agent -- --files C:/shared "What is in notes.txt? Then save a file called todo.txt that says: buy milk"
//   npm run mcp:agent -- --url http://127.0.0.1:3333/mcp "What is Kafka?"     (our server over HTTP: start it first with npm run mcp:http)
// It starts our MCP server (and, with --files, the reference filesystem server limited to that folder) as subprocesses.
// A tool that needs approval (writing a file) asks you here first.
import { createInterface } from "node:readline/promises";
import "./config"; // loads .env (the token for --url)
import { createMcpAgent } from "./agent";
import type { Approve } from "./safety";
import { documentsHttpServer, documentsServer, filesServer } from "./servers";

// 1. The arguments: an optional --files <folder>, an optional --url <address>, then the question.
const args = process.argv.slice(2);

// Example: valueOf("--files") returns "C:/shared" for the arguments ["--files", "C:/shared", "What is Kafka?"], and undefined when the flag is missing
function valueOf(flag: string) {
  const position = args.indexOf(flag);
  return position >= 0 ? args[position + 1] : undefined;
}

const folder = valueOf("--files");
const url = valueOf("--url");
const words = args.filter((word, index) => !["--files", "--url"].includes(word) && !["--files", "--url"].includes(args[index - 1]));
const question = words.join(" ") || "What is Kafka? Answer in one sentence.";

const terminal = createInterface({ input: process.stdin, output: process.stdout });

// 2. The approval: show what is about to run and wait for a yes.
// Example: askAPerson({ server: "files", tool: "write_file", args: { path: "…", content: "buy milk" } }) prints the call and returns true after you type "y"
const askAPerson: Approve = async ({ server, tool, args }) => {
  console.log(`\n  ⏸  The ${server} server wants to run ${tool} ${JSON.stringify(args)}`);
  const answer = await terminal.question("  Allow it? [y]es / [n]o: ");

  return answer.trim().toLowerCase() === "y";
};

async function main() {
  // Our documents server: over HTTP when an address is given (it needs the token from .env), otherwise started as a subprocess.
  const documents = url ? documentsHttpServer(url, process.env.MCP_HTTP_TOKEN ?? "") : documentsServer;
  const servers = folder ? [documents, filesServer(folder)] : [documents];
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

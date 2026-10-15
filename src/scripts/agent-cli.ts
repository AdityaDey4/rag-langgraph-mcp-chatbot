import { randomUUID } from "node:crypto";
import { loadBudgets } from "../lib/agent/budget";
import { runAgent } from "../lib/agent/loop";
import { OpenAILlmClient } from "../lib/agent/openai-llm";
import { ToolRegistry } from "../lib/agent/registry";
import { createDefaultRegistry } from "../lib/agent/tools";
import type { AgentEvent, Budgets } from "../lib/agent/types";
import { CHAT_MODEL } from "../lib/config";

const USAGE = `Usage: npm run agent -- [options] "your question"

Options:
  --max-steps <n>   Limit model calls (default from AGENT_MAX_STEPS or 6)
  --json            Print every event as one JSON line instead of a readable trace
  --no-tools        Run the model with no tools (baseline for comparison)
  --help            Show this message`;

type Options = {
  question: string;
  json: boolean;
  noTools: boolean;
  budgets: Partial<Budgets>;
};

function parseArgs(argv: string[]): Options | null {
  const options: Options = { question: "", json: false, noTools: false, budgets: {} };
  const words: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return null;
    else if (arg === "--json") options.json = true;
    else if (arg === "--no-tools") options.noTools = true;
    else if (arg === "--max-steps") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1) {
        console.error("--max-steps needs a positive integer");
        return null;
      }
      options.budgets.maxSteps = value;
    } else if (arg.startsWith("--")) {
      console.error(`Unknown option: ${arg}`);
      return null;
    } else words.push(arg);
  }

  options.question = words.join(" ").trim();
  return options.question ? options : null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.log(USAGE);
    process.exit(1);
  }

  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());

  const registry = options.noTools ? new ToolRegistry() : createDefaultRegistry();
  const events = runAgent(
    { question: options.question, conversationId: randomUUID(), history: [] },
    {
      llm: new OpenAILlmClient(),
      registry,
      budgets: loadBudgets(options.budgets),
      model: process.env.AGENT_MODEL || CHAT_MODEL,
      signal: controller.signal,
    }
  );

  let failed = false;
  const printer = options.json ? printJson : createPrettyPrinter();

  for await (const event of events) {
    printer(event);
    if (event.type === "error") failed = true;
  }

  if (failed) process.exit(1);
}

function printJson(event: AgentEvent) {
  console.log(JSON.stringify(event));
}

function createPrettyPrinter() {
  let streaming = false;

  const endStream = () => {
    if (streaming) process.stdout.write("\n");
    streaming = false;
  };

  return (event: AgentEvent) => {
    switch (event.type) {
      case "run_start":
        console.log(
          `run ${event.runId.slice(0, 8)} | model ${event.model} | tools: ${event.tools.join(", ") || "none"}`
        );
        break;
      case "step_start":
        endStream();
        console.log(`\n--- step ${event.step}`);
        break;
      case "tool_call":
        console.log(`  call  ${event.name} ${JSON.stringify(event.args)}`);
        break;
      case "tool_result":
        console.log(
          `  ${event.isError ? "ERROR" : "ok   "} ${event.name} (${event.durationMs} ms)${event.truncated ? " [truncated]" : ""}`
        );
        console.log(indent(oneLine(event.preview, 160), "        "));
        break;
      case "usage":
        endStream();
        console.log(`  tokens in ${event.inputTokens} / out ${event.outputTokens}`);
        break;
      case "answer_delta":
        if (!streaming) process.stdout.write("  answer: ");
        streaming = true;
        process.stdout.write(event.text);
        break;
      case "final": {
        endStream();
        const { totals } = event;
        console.log("\n=== final answer");
        console.log(event.answer);
        if (event.citations.length > 0) {
          console.log("\nsources:");
          for (const source of event.citations) {
            console.log(
              `  [${source.chunkId}] ${source.filename ?? "?"} / ${source.section ?? "?"} / p.${source.pages.join(",") || "?"}`
            );
          }
        }
        if (event.stoppedBy) {
          console.log(`\n(stopped early: ${event.stoppedBy}; answer was forced)`);
        }
        const cost = totals.costUsd === null ? "n/a" : `~$${totals.costUsd.toFixed(5)}`;
        console.log(
          `\nsteps ${totals.steps} | tool calls ${totals.toolCalls} | tokens ${totals.inputTokens + totals.outputTokens} (in ${totals.inputTokens} / out ${totals.outputTokens}) | cost ${cost} | ${(totals.latencyMs / 1000).toFixed(1)} s`
        );
        break;
      }
      case "error":
        endStream();
        console.error(`\nERROR [${event.code}]: ${event.message}`);
        break;
    }
  };
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

function indent(text: string, prefix: string): string {
  return prefix + text;
}

main().catch((error) => {
  console.error("Agent CLI crashed:", error);
  process.exit(1);
});

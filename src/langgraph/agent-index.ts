// Run the agent from the terminal:  npm run langgraph -- "your question"
// Without a question it runs the Phase 4 demo: two questions in thread "a", then one in thread "b".
// The answer appears word by word, a line per finished step shows the progress, and Ctrl+C cancels the run.
import { createInterface } from "node:readline/promises";
import { resumeAgent, runAgent, type AgentResult, type RunOptions, type Step } from "./agent";
import type { Decision } from "./approve";
import { log } from "./log";

const question = process.argv.slice(2).join(" ");
const terminal = createInterface({ input: process.stdin, output: process.stdout });

// Example: for a pending send_email, prints the call and returns { approve: true } after you type "y"; "e" lets you type new arguments as JSON
// Ctrl+C while waiting for the answer aborts the question (signal), and that counts as "no".
async function askHuman(calls: { name: string; args: Record<string, unknown> }[], signal: AbortSignal): Promise<Decision> {
  for (const call of calls) {
    console.log(`\n  ⏸  The agent wants to run ${call.name} ${JSON.stringify(call.args)}`);
  }

  try {
    const answer = await terminal.question("  Approve? [y]es / [n]o / [e]dit: ", { signal });
    const reply = answer.trim().toLowerCase();

    if (reply === "e") {
      const json = await terminal.question('  New arguments as JSON, e.g. {"to":"bob@example.com"}: ', { signal });
      return { approve: true, args: JSON.parse(json) };
    }

    return { approve: reply === "y" };
  } catch (error) {
    if (signal.aborted) return { approve: false };
    throw error;
  }
}

// Example: printStep(step) prints "  ▸ llm      1.2s  [1296 in / 24 out tokens]  ai: asks for 1 tool(s) -> …"
function printStep(step: Step) {
  const seconds = (step.ms / 1000).toFixed(1);
  const tokens = step.inputTokens ? `  [${step.inputTokens} in / ${step.outputTokens} out tokens]` : "";
  console.log(`  ▸ ${step.node.padEnd(8)} ${seconds}s${tokens}  ${step.detail.slice(0, 100)}`);
}

// Example: prints "[a] Question: What is 2 + 2?", then a progress line per step, and "[a] Answer: 4" with the 4 appearing as the model writes it
async function ask(threadId: string, text: string) {
  console.log(`\n[${threadId}] Question: ${text}`);

  // Ctrl+C cancels the run. The terminal interface is in raw mode, so Ctrl+C reaches it as its own "SIGINT" event, not the process's.
  const controller = new AbortController();
  const cancel = () => controller.abort();
  terminal.on("SIGINT", cancel);
  process.on("SIGINT", cancel); // for input that is not a terminal

  let lineOpen = false; // is the answer line still being written?
  let stepText = ""; // text streamed during the step that is running now
  let lastStepText = ""; // text streamed during the last finished step
  const options: RunOptions = {
    signal: controller.signal,
    onToken: (piece) => {
      if (!lineOpen) process.stdout.write(`[${threadId}] Answer: `);
      lineOpen = true;
      stepText += piece;
      process.stdout.write(piece);
    },
    onStep: (step) => {
      if (lineOpen) process.stdout.write("\n"); // end the answer line before the progress line
      lineOpen = false;
      lastStepText = stepText;
      stepText = "";
      printStep(step);
    },
  };

  const allSteps: Step[] = [];
  let result: AgentResult;

  try {
    result = await runAgent(text, threadId, options);
    allSteps.push(...result.steps);
    log(`${threadId}] Result: ${JSON.stringify(result)}`);

    // Each pause asks the human, then continues the same thread.
    while ("approval" in result) {
      const decision = await askHuman(result.approval.calls, controller.signal);
      result = await resumeAgent(decision, threadId, options);
      allSteps.push(...result.steps);
    }
  } finally {
    terminal.removeListener("SIGINT", cancel);
    process.removeListener("SIGINT", cancel);
  }

  // The answer is printed unless the last step already streamed exactly that text.
  // (Give-up, step-limit and cancelled messages are not written by the model, so they are printed here.)
  if (lastStepText.trim() !== result.answer.trim()) {
    console.log(`[${threadId}] Answer: ${result.answer}`);
  }

  const seconds = allSteps.reduce((sum, step) => sum + step.ms, 0) / 1000;
  const tokensIn = allSteps.reduce((sum, step) => sum + step.inputTokens, 0);
  const tokensOut = allSteps.reduce((sum, step) => sum + step.outputTokens, 0);
  console.log(`  Total: ${allSteps.length} steps, ${seconds.toFixed(1)}s, ${tokensIn} tokens in, ${tokensOut} out`);
}

async function main() {
  // A new thread for every run. Set THREAD_ID to continue an earlier conversation (it is saved in the database file).
  if (question) return ask(process.env.THREAD_ID ?? `cli-${Date.now()}`, question);
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

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  judge,
  mean,
  oneLine,
  percent,
  runAgentOnce,
  runClassicOnce,
  saveResults,
  toolNames,
  usd,
  type RunSummary,
  type Verdict,
} from "./agent-harness";

const USAGE = `Usage: npm run agent:behaviour -- [options]

Runs eval/agent.jsonl through the agent (and optionally Classic RAG), checks the
expected TOOL BEHAVIOUR with code, and judges the ANSWER with an LLM rubric.

Options:
  --classic       Also run every question through /api/ask for comparison (E5)
  --repeat <n>    Run each question n times (default 1; models are not deterministic)
  --only <id,id>  Only run these question ids
  --help`;

type Checks = {
  minToolCalls?: number;
  maxToolCalls?: number;
  mustCall?: string[];
  mustNotCall?: string[];
  anyOf?: string[];
  minCallsOf?: Array<{ tool: string; n: number }>;
  queryMustMention?: string[];
  queryMustNotMention?: string[];
};

type Question = {
  id: string;
  category: string;
  question: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  expect: string;
  checks: Checks;
};

type Outcome = {
  id: string;
  category: string;
  run: RunSummary;
  toolFailures: string[];
  verdict: Verdict;
  pass: boolean;
};

function parseArgs(argv: string[]) {
  const options = { classic: false, repeat: 1, only: null as string[] | null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--classic") options.classic = true;
    else if (arg === "--repeat") options.repeat = Math.max(1, Number(argv[++i]) || 1);
    else if (arg === "--only") options.only = (argv[++i] ?? "").split(",").filter(Boolean);
    else {
      console.log(USAGE);
      process.exit(arg === "--help" ? 0 : 1);
    }
  }
  return options;
}

function loadQuestions(): Question[] {
  const file = path.join(process.cwd(), "eval", "agent.jsonl");
  const now = new Date();
  const replacements: Record<string, string> = {
    "{{weekdayUtc}}": now.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
    "{{weekdayLocal}}": now.toLocaleDateString("en-US", { weekday: "long" }),
  };

  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      let text = line;
      for (const [key, value] of Object.entries(replacements)) text = text.replaceAll(key, value);
      return JSON.parse(text) as Question;
    });
}

/** The programmatic half of the check: did the agent behave as expected? */
function checkTools(run: RunSummary, checks: Checks): string[] {
  const failures: string[] = [];
  const names = toolNames(run);
  const queries = run.toolCalls
    .filter((call) => call.name === "search_documents")
    .map((call) => String((call.args as { query?: unknown })?.query ?? "").toLowerCase());

  if (checks.maxToolCalls !== undefined && names.length > checks.maxToolCalls) {
    failures.push(`made ${names.length} tool calls (max ${checks.maxToolCalls})`);
  }
  if (checks.minToolCalls !== undefined && names.length < checks.minToolCalls) {
    failures.push(`made ${names.length} tool calls (min ${checks.minToolCalls})`);
  }
  for (const tool of checks.mustCall ?? []) {
    if (!names.includes(tool)) failures.push(`did not call ${tool}`);
  }
  for (const tool of checks.mustNotCall ?? []) {
    if (names.includes(tool)) failures.push(`called ${tool}`);
  }
  if (checks.anyOf && !checks.anyOf.some((tool) => names.includes(tool))) {
    failures.push(`called none of ${checks.anyOf.join(" / ")}`);
  }
  for (const { tool, n } of checks.minCallsOf ?? []) {
    const count = names.filter((name) => name === tool).length;
    if (count < n) failures.push(`${tool} called ${count}x (min ${n})`);
  }
  for (const word of checks.queryMustMention ?? []) {
    if (!queries.some((query) => query.includes(word))) {
      failures.push(`no search query mentions "${word}" (queries: ${queries.join(" | ") || "none"})`);
    }
  }
  for (const word of checks.queryMustNotMention ?? []) {
    if (queries.some((query) => query.includes(word))) {
      failures.push(`a search query leaked the format instruction "${word}"`);
    }
  }
  return failures;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + " ".repeat(width - text.length);
}

function summarise(label: string, outcomes: Outcome[]) {
  const runs = outcomes.map((o) => o.run);
  const passed = outcomes.filter((o) => o.pass).length;
  const toolOk = outcomes.filter((o) => o.toolFailures.length === 0).length;
  const answerOk = outcomes.filter((o) => o.verdict.pass).length;

  console.log(`\n${label}`);
  console.log(`  task success      ${passed}/${outcomes.length} (${percent(passed, outcomes.length)})`);
  if (outcomes.some((o) => o.run.path === "agent")) {
    console.log(`  tool behaviour ok ${toolOk}/${outcomes.length}`);
  }
  console.log(`  answer judged ok  ${answerOk}/${outcomes.length}`);
  console.log(`  mean steps        ${mean(runs.map((r) => r.steps)).toFixed(2)}`);
  console.log(`  mean tool calls   ${mean(runs.map((r) => r.toolCalls.length)).toFixed(2)}`);
  console.log(`  mean tokens       ${mean(runs.map((r) => r.inputTokens + r.outputTokens)).toFixed(0)} chat + ${mean(runs.map((r) => r.embeddingTokens)).toFixed(0)} embedding`);
  console.log(`  mean cost         ${usd(mean(runs.map((r) => r.costUsd ?? 0)))}`);
  console.log(`  mean latency      ${(mean(runs.map((r) => r.latencyMs)) / 1000).toFixed(1)} s`);

  return {
    label,
    n: outcomes.length,
    taskSuccess: passed / outcomes.length,
    toolBehaviourOk: toolOk / outcomes.length,
    answerOk: answerOk / outcomes.length,
    meanSteps: mean(runs.map((r) => r.steps)),
    meanToolCalls: mean(runs.map((r) => r.toolCalls.length)),
    meanChatTokens: mean(runs.map((r) => r.inputTokens + r.outputTokens)),
    meanEmbeddingTokens: mean(runs.map((r) => r.embeddingTokens)),
    meanCostUsd: mean(runs.map((r) => r.costUsd ?? 0)),
    meanLatencyMs: mean(runs.map((r) => r.latencyMs)),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let questions = loadQuestions();
  if (options.only) questions = questions.filter((q) => options.only!.includes(q.id));

  console.log(
    `Running ${questions.length} questions x ${options.repeat} through the agent${options.classic ? " and Classic RAG" : ""}\n`
  );

  const agentOutcomes: Outcome[] = [];
  const classicOutcomes: Outcome[] = [];

  for (const q of questions) {
    for (let attempt = 1; attempt <= options.repeat; attempt++) {
      const tag = options.repeat > 1 ? `${q.id}#${attempt}` : q.id;

      const run = await runAgentOnce(q.question, { history: q.history });
      const toolFailures = run.error ? [`run failed: ${run.error}`] : checkTools(run, q.checks);
      const verdict = await judge(q.question, q.expect, run.answer);
      const outcome: Outcome = {
        id: q.id,
        category: q.category,
        run,
        toolFailures,
        verdict,
        pass: toolFailures.length === 0 && verdict.pass,
      };
      agentOutcomes.push(outcome);

      console.log(
        `${outcome.pass ? "PASS" : "FAIL"} ${pad(tag, 24)} steps=${run.steps} tools=[${toolNames(run).join(",")}] ${(run.latencyMs / 1000).toFixed(1)}s ${usd(run.costUsd)}`
      );
      if (!outcome.pass) {
        for (const failure of toolFailures) console.log(`       tools : ${failure}`);
        if (!verdict.pass) console.log(`       answer: ${verdict.reason}`);
        console.log(`       said  : ${oneLine(run.answer, 160)}`);
      }

      if (options.classic) {
        const classic = await runClassicOnce(q.question, q.history);
        const classicVerdict = await judge(q.question, q.expect, classic.answer);
        classicOutcomes.push({
          id: q.id,
          category: q.category,
          run: classic,
          toolFailures: classic.error ? [classic.error] : [],
          verdict: classicVerdict,
          pass: !classic.error && classicVerdict.pass,
        });
        console.log(
          `  classic ${classicVerdict.pass ? "ok  " : "FAIL"} ${(classic.latencyMs / 1000).toFixed(1)}s ${usd(classic.costUsd)}${classicVerdict.pass ? "" : `  (${classicVerdict.reason})`}`
        );
      }
    }
  }

  const agentSummary = summarise("AGENT", agentOutcomes);
  const classicSummary = options.classic ? summarise("CLASSIC RAG", classicOutcomes) : null;

  // Success by category, to see where each approach wins.
  if (classicSummary) {
    console.log("\nBY CATEGORY (task success)   agent   classic");
    const categories = [...new Set(questions.map((q) => q.category))];
    for (const category of categories) {
      const a = agentOutcomes.filter((o) => o.category === category);
      const c = classicOutcomes.filter((o) => o.category === category);
      console.log(
        `  ${pad(category, 24)} ${pad(`${a.filter((o) => o.pass).length}/${a.length}`, 7)} ${c.filter((o) => o.pass).length}/${c.length}`
      );
    }
  }

  const file = saveResults("behaviour", {
    createdAt: new Date().toISOString(),
    options,
    agent: { summary: agentSummary, outcomes: agentOutcomes },
    classic: classicSummary ? { summary: classicSummary, outcomes: classicOutcomes } : null,
  });
  console.log(`\nSaved ${file}`);
}

main().catch((error) => {
  console.error("Behaviour check crashed:", error);
  process.exit(1);
});

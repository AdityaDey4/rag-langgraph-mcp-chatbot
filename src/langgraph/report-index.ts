// Run the report graph twice with the same questions:  npm run langgraph-report -- "What is Kafka?" "What is Redis?"
// The second run is fast because the research graph remembers each search (cache).
import { makeReportGraph } from "./report";
import { searchChunks } from "./retrieval";

const queries = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["What is Kafka?", "What is Redis?", "What is Java?"];

async function main() {
  let searchCount = 0;

  const graph = makeReportGraph(async (query) => {
    searchCount++;

    const [best] = await searchChunks(query, 1);

    return {
      query,
      section: best?.section ?? null,
      score: best?.score ?? null,
    };
  });

  // 1. First run: every question is searched.
  console.time("First run");
  const first = await graph.invoke({ queries }, { configurable: { thread_id: "report-1" } });
  console.timeEnd("First run");

  console.log(first.report);
  console.log("Searches so far:", searchCount);

  // 2. Second run (a new thread): the same questions come from the cache.
  console.time("Second run");
  const second = await graph.invoke({ queries }, { configurable: { thread_id: "report-2" } });
  console.timeEnd("Second run");

  console.log(second.report);
  console.log("Searches so far:", searchCount);
}

main().catch((error) => {
  console.error("Report failed:", error);
  process.exitCode = 1;
});

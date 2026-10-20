
import { makeResearchGraph, type Found } from "./research";
import { searchChunks } from "./retrieval";

const queries = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["What is Kafka?", "What is ttrhtrtrj?", "What is Java?"];

async function main() {
  let searchCount = 0;

  const graph = makeResearchGraph(
    async (query): Promise<Found> => {
      searchCount++;

      const [best] = await searchChunks(query, 1);

      return {
        query,
        section: best?.section ?? null,
        score: best?.score ?? null,
      };
    },
  );

  // Use a fresh thread for each CLI run.
  const config = {
    configurable: {
      thread_id: `research-${Date.now()}`,
    },
  };

  console.log("Questions:", queries);
  console.time("Total execution");

  const result = await graph.invoke({ queries }, config);

  console.timeEnd("Total execution");

  console.log("\nCombined summary:");
  console.log(result.summary);
  console.log("\nSearches attempted:", searchCount);

  // Inspect the saved checkpoints.
  console.log("\nSaved checkpoints:");

  for await (const snapshot of graph.getStateHistory(config)) {
    console.log("\n------------------------------");
    console.log("Next nodes:", snapshot.next);
    console.log("Full state:");
    console.dir(snapshot.values, { depth: null });
  }
}

main().catch((error) => {
  console.error("Research failed:", error);
  process.exitCode = 1;
});

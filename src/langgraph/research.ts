
import {
  Annotation,
  Command,
  END,
  MemorySaver,
  Send,
  START,
  StateGraph,
} from "@langchain/langgraph";

import { InMemoryCache } from "@langchain/langgraph-checkpoint";

import { searchChunks } from "./retrieval";

// 1. The result returned by one search.
export type Found = {
  query: string;
  section: string | null;
  score: number | null;
};

// 2. The shared state used by the graph.
const ResearchState = Annotation.Root({
  // The questions we need to answer.
  queries: Annotation<string[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),

  // Results from all parallel searches.
  found: Annotation<Found[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),

  // The final combined result.
  summary: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
});

// 3. Search for the best matching document chunk.
async function searchBestPassage(query: string): Promise<Found> {
  const [best] = await searchChunks(query, 1);

  return {
    query,
    section: best?.section ?? null,
    score: best?.score ?? null,
  };
}

// 4. Build the graph.
// The injected search function makes the graph easier to test.
export function makeResearchGraph(
  search: (query: string) => Promise<Found> = searchBestPassage,
) {
  // PLAN: create one search task for every question.
  function plan(state: typeof ResearchState.State) {
    const tasks = state.queries.map(
      (query) => new Send("search", { query }),
    );

    // Command updates state AND routes execution.
    return new Command({
      update: {
        summary: "Searching for answers...",
      },
      goto: tasks,
    });
  }

  // SEARCH: each invocation receives one question.
  async function searchNode(input: { query: string }) {
    const result = await search(input.query);

    // The reducer appends this result to the shared results.
    return {
      found: [result],
    };
  }

  // COMBINE: collect results in the original question order.
  function combine(state: typeof ResearchState.State) {
    const lines = state.queries.map((query) => {
      const result = state.found.find(
        (item) => item.query === query,
      );

      if (!result) {
        return `${query} -> nothing found`;
      }

      const score = result.score?.toFixed(2) ?? "-";
      return `${query} -> ${result.section ?? "nothing found"} (${score})`;
    });

    return {
      summary: lines.join("\n"),
    };
  }

  return new StateGraph(ResearchState)
    .addNode("plan", plan, { ends: ["search"] })

    .addNode("search", searchNode, {
      // Retry a failed search, up to 3 attempts total.
      retryPolicy: {
        maxAttempts: 3,
        initialInterval: 200,
      },

      // Remember the result for 60 seconds. The same question is not searched again.
      cachePolicy: {
        ttl: 60,
      },
    })

    .addNode("combine", combine)

    .addEdge(START, "plan")
    .addEdge("search", "combine")
    .addEdge("combine", END)

    .compile({
      checkpointer: new MemorySaver(),
      cache: new InMemoryCache(),
    });
}

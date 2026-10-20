// A bigger graph that uses the research graph as one of its steps (a subgraph).
//   START -> research (the whole research graph) -> write -> END
import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";

import { makeResearchGraph, type Found } from "./research";

// 1. The state of the report graph.
// queries and summary have the same names as in the research graph, so they are passed in and out of it automatically.
// The research graph's own field (found) stays inside it.
const ReportState = Annotation.Root({
  queries: Annotation<string[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),

  summary: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),

  report: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
});

// 2. Build the graph.
export function makeReportGraph(search?: (query: string) => Promise<Found>) {
  const research = makeResearchGraph(search);

  // WRITE: put a title on the summary that the research graph produced.
  function write(state: typeof ReportState.State) {
    return {
      report: `REPORT (${state.queries.length} questions)\n${state.summary}`,
    };
  }

  return new StateGraph(ReportState)
    // A compiled graph can be used as a node.
    .addNode("research", research)
    .addNode("write", write)

    .addEdge(START, "research")
    .addEdge("research", "write")
    .addEdge("write", END)

    .compile({
      checkpointer: new MemorySaver(),
    });
}

// The state: what the graph remembers while it runs. Each field has a reducer that says how an update is merged in.
import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

export const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec, // messages: new messages are appended to the list

  // Number of search_documents calls only (other tools are not counted). Added up. Example: current 1, update 2 gives 3
  searchCount: Annotation<number>({
    reducer: (current, update) => current + update,
    default: () => 0,
  }),

  // Joined. Example: current ["a"], update ["b"] gives ["a", "b"]
  searchQueries: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),

  // Tool failures in the current question. Replaced; runAgent resets it to 0 for each question. The agent gives up at 3 (see tool-node.ts)
  toolErrors: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),

  // Replaced. Example: current "x", update "y" gives "y"
  lastAnswer: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
});

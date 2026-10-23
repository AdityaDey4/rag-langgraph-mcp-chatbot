# LangGraph.js: what I learned

Notes from building a document question-answering agent with LangGraph.js in this project, one phase at a time, and testing every idea on real runs. Everything here was run in the project (LangGraph 1.5.0, `@langchain/core` 1.2.18, `@langchain/openai` 1.6.2, Node 22, model `gpt-4o-mini`), unless it says "not checked".

The code is in `src/langgraph/`. The long version with every verified fact is `docs/LANGGRAPH-SPEC.md`. This file is the short, readable version.

---

## 1. The big picture

**An agent is a loop.** A model looks at the conversation, decides to answer or to ask for a tool, a tool runs, the result goes back to the model, and this repeats until the model answers.

**LangGraph turns that loop into a graph:**

| Piece | What it is | In this project |
|---|---|---|
| **State** | The data the graph carries from step to step | `AgentState`: messages, counters, the last answer |
| **Node** | A function: takes the state, returns an update | `llm`, `approve`, `tools`, `giveUp` |
| **Edge** | "After this node, go to that node" | `START → llm`, `giveUp → END` |
| **Conditional edge** | A function that picks the next node | `shouldContinue`: tools or end |
| **Reducer** | The rule for merging an update into one state field | Append messages, add counters, replace the answer |
| **Checkpointer** | Saves the state after every step | SQLite file, one saved copy per `thread_id` |
| **Compile** | Turns the definition into something you can run | `.compile({ checkpointer })` |

**The shape of our agent:**

```
START → llm ─(asks for a tool)→ approve ─→ tools ─→ llm …
          └─(final answer)→ END               └─(3 tool failures)→ giveUp → END
```

**One rule worth remembering:** only the `llm` node calls the chat model. The other nodes are ordinary code. The `search_documents` tool calls the *embedding* model, but that is not the model that decides what happens next.

---

## 2. Phase 1: graph fundamentals

**What a graph run is.** You call `graph.invoke(input)`. LangGraph runs the first node, merges what it returned into the state, follows the edge to the next node, and stops at `END`.

```ts
export const graph = new StateGraph(AgentState)
  .addNode("llm", callModel)
  .addNode("tools", runTools)
  .addEdge(START, "llm")
  .addConditionalEdges("llm", shouldContinue, { tools: "tools", [END]: END })
  .addConditionalEdges("tools", afterTools, { llm: "llm", giveUp: "giveUp" })
  .compile();
```

**Things I learned**

- **`bindTools(tools)` only tells the model the tools exist.** It never runs them. The `tools` node runs them. A tool call is a *request* in the model's message (`tool_calls`), and your code carries it out.
- **A conditional edge is just a function** that returns the name of the next node. It reads the last message: if the model asked for a tool, go to `tools`, otherwise `END`.
- **`recursionLimit` stops runaway loops.** Every node run counts as one step. **A run that finishes after S steps needs a limit of at least S + 1.** This was measured: a 1-step run fails at limit 1 and passes at 2. Going over throws `GraphRecursionError`.
- **A visible log makes a graph understandable.** Printing the state and the router's choice at each step was the fastest way to learn what the graph does.

---

## 3. Phase 2: state and reducers

**Nodes return updates, not the whole state.** LangGraph merges each field with that field's reducer.

```ts
export const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,                       // messages: append
  searchCount: Annotation<number>({
    reducer: (current, update) => current + update, // add up
    default: () => 0,
  }),
  searchQueries: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update], // join lists
    default: () => [],
  }),
  lastAnswer: Annotation<string>({
    reducer: (_current, update) => update,          // replace
    default: () => "",
  }),
});
```

| Reducer kind | Example: current → update → result |
|---|---|
| Add | `1` + `2` → `3` |
| Join | `["a"]` + `["b"]` → `["a","b"]` |
| Replace | `"x"` + `"y"` → `"y"` |

**Things I learned**

- **The messages reducer (`addMessages`)** appends new messages, gives each an id, and turns plain `{role, content}` objects into message classes. A message with an **id that already exists replaces** the old one. This is how the approval step later edits a tool call.
- **A field only changes if a node returns it.** A node that returns `{}` changes nothing.
- **`searchCount` counted only `search_documents` calls**, not every tool. That surprised me, and the fix was a clear comment, not different code. Decide what a counter counts, then write it down.
- **A field name and a node name can't be the same.** LangGraph refused a node called `report` when `report` was also a state field.

---

## 4. Phase 3: tool calling and agent loops

**The messages in one tool round:**

```
HumanMessage            "What is Kafka?"
AIMessage               tool_calls: [{ id: "call_1", name: "search_documents", args: { query: "Kafka" } }]
ToolMessage             tool_call_id: "call_1", content: "<result>"
AIMessage               "Apache Kafka is …"      ← final answer
```

**Every tool call needs a `ToolMessage` with the same `tool_call_id`.** Without it, the next model call is rejected.

**Things I learned**

- **I wrote my own `tools` node (`runTools`) instead of the ready-made `ToolNode`.** `ToolNode`'s only option for errors is `handleToolErrors`. A custom node let me control the error text and update the state (`toolErrors`).
- **A failed tool should become a message, not a crash.** The error text says what went wrong and what to do ("fix the arguments, or explain the problem"). The model then recovers. With `10 / 0` the model explained the error to the user. With a bad chunk id it searched instead.
- **Stop after repeated failures.** The router `afterTools` sends the run to `giveUp` after 3 failed tool calls, and `giveUp` returns a plain message.
- **`tool.invoke({ ...call, type: "tool_call" })`** validates the arguments, runs the tool and returns a `ToolMessage` with the right id. Without `type: "tool_call"` the object is treated as plain arguments. This was a real bug I hit.
- **Tool results are untrusted data.** They are wrapped in `<tool_result>` tags (with the tag stripped from inside the text), and the system prompt tells the model to ignore instructions found inside.

---

## 5. Phase 4: persistence and memory

**Memory is the saved state of a thread.** There is no code that "remembers". You compile with a checkpointer, call with a `thread_id`, and LangGraph loads the saved state before the run and saves it after every step.

```ts
.compile({ checkpointer: SqliteSaver.fromConnString("langgraph-checkpoints.db") })

await graph.invoke(
  { messages: [new HumanMessage("Now add 6 to that.")] },   // only the NEW question
  { configurable: { thread_id: "abc" } },                    // which conversation
);
```

**The flow of "Now add 6 to that":**
1. You send only the new question and the `thread_id`.
2. LangGraph loads the thread's saved state (the earlier messages).
3. The messages reducer appends your question to them.
4. `callModel` sends the model the history plus the question.
5. The state is saved again.

**A new `thread_id` has no saved state**, so it knows nothing. That is why "New chat" forgets everything.

**Things I learned**

- **Short-term memory** is the state of one thread (what we built). **Long-term memory** is facts kept across threads (for example a user's preferences). That needs a separate store and is not the checkpointer's job. Not built.
- **Everything in the state is saved, not only the messages.** `toolErrors` was a running total, so failures from one question would have counted against the next. I changed it to "replace" and reset it to 0 with each question.
- **The saved history is complete, but the model sees a trimmed copy.** `messagesForModel` keeps the current question whole and trims only the earlier ones (last 15 messages).
- **Trimming must start on a human message** (`startOn: "human"`). Otherwise the kept part can begin with a tool result whose request was cut off.
- **Never trim the current question.** My first version did, and a question with a long tool loop could leave the model with *nothing*. A test now covers it.
- **`MemorySaver` is lost when the process stops.** `SqliteSaver` writes to a file: the swap changed one line, and a paused run survived a server restart.
- **Summarizing old messages** is the alternative to trimming. It keeps the gist but costs an extra model call. Described, not built.

---

## 6. Phase 5: human in the loop

**`interrupt()` pauses a run and saves it. `Command({ resume })` continues it.**

```ts
// inside the approve node
const decision = interrupt({ calls: risky.map(c => ({ name: c.name, args: c.args })) });
// … on resume, interrupt() returns the human's answer
```

```ts
await graph.invoke(new Command({ resume: { approve: true } }), config);   // same thread_id
```

**Things I learned**

- **On resume the node runs again from its first line.** Code before `interrupt()` runs twice. So the approval node does nothing with side effects before the pause. This was tested with a counter: started once, then twice.
- **A pause is not an error.** `invoke` returns normally. You find the question with `getState(config)`: `tasks[].interrupts[].value` holds the payload, and `next` is `["approve"]` (the node waiting). A thread that never ran has `next: []`.
- **Put the pause in its own node before the tools node.** The tools node runs all calls together, so a pause inside it would restart and re-run the safe calls too.
- **Approve, reject and edit are one mechanism**: the answer is a small object (`approve`, optional `args`).
  - *Reject* returns one rejection `ToolMessage` for **every** tool call of that message (each call needs an answer).
  - *Edit* replaces the model's message using the **same id**, so the reducer swaps it instead of adding a second.
- **Wording matters.** "The user did not approve" made the model offer to send the email anyway. "The user rejected this step. Do not try it again; tell the user it was not done" fixed it.
- **A prompt is not a guard.** The model first asked "Shall I proceed?" itself instead of calling the tool. The approval *node* is the real guard.
- **A model can misreport an edit.** After editing the recipient, the email went to the new address, but the model's reply named the old one. The log and the tool result are the truth, not the model's sentence.

---

## 7. Phase 6: streaming and observability

**`graph.stream()` sends small pieces while the graph runs.** With `streamMode: ["updates", "messages"]` there are two kinds:

| Mode | A chunk is | Used for |
|---|---|---|
| `updates` | One node finished, with what it returned | Progress lines (`▸ llm 1.5s [1294 in / 14 out tokens]`) |
| `messages` | A few characters the model is writing | The typing effect |

**Things I learned**

- **The tools node also shows up in `messages`** (its result). Filter on `langgraph_node === "llm"`, or tool output gets printed as the answer.
- **Many chunks have no text** (pieces of a tool call, a final chunk with token counts). They are skipped.
- **Tokens per step** come from `usage_metadata` on the model's message. Only the `llm` node uses tokens.
- **A pause is also a chunk** (`__interrupt__`), and the final answer and any pending approval are read from `getState` after the stream ends.
- **Cancelling:** pass a `signal` (an `AbortSignal`). When aborted, the stream throws an error named `AbortError`. The code turns it into "Cancelled".
- **Ctrl+C in a terminal:** readline puts the keyboard in raw mode, so the key never reaches the process as `SIGINT`. Listen on the readline interface too. (Not tried in a real terminal.)
- **What the timing showed.** In one run, the search tool took 4.8 s of 7.8 s. Without progress lines that looks like a frozen program. The second model call used about twice the input tokens of the first, because the search results were now in the history.
- **A step-limit side effect.** The `approve` node made each tool round cost 3 steps instead of 2, so the default limit of 6 broke questions that need two tool rounds. I raised it to 15. Adding a node changes the limit you need.

---

## 8. Phase 7: advanced graph patterns

A second, separate graph answers several questions at once:

```
START → plan → search (one per question, in parallel) → combine → END
```

**Fan-out with `Send` and `Command`**

```ts
function plan(state) {
  return new Command({
    update: { summary: "Searching for answers..." },
    goto: state.queries.map((query) => new Send("search", { query })),   // one per question
  });
}
// .addNode("plan", plan, { ends: ["search"] })   ← tells LangGraph where plan may go
```

- **`Send(node, input)`** starts a node with its own input. LangGraph runs all of them in the same step (3 searches in about the time of one).
- **`Command`** returns a state update **and** the routing in one value.
- **The reducer is the join.** Each search returns `found: [one result]`, and the join reducer collects them. `addEdge("search", "combine")` waits for every branch.
- **Parallel branches finish in any order.** `combine` puts results back in the order of the questions.

**Retries.** `retryPolicy: { maxAttempts: 3, initialInterval: 200 }` on a node retries that node only (after 200 ms, then 400 ms). Other branches aren't re-run. If all attempts fail, the original error is thrown. Seen for real when Qdrant was down.

**Caching.** `cachePolicy: { ttl: 60 }` on a node, plus `cache: new InMemoryCache()` in `compile()`. The key is the node's **input**, not the thread. A second run with the same questions took 11 ms instead of 3 s, with no new searches, even on a new thread. `InMemoryCache` comes from `@langchain/langgraph-checkpoint`.

**Subgraph.** A compiled graph can be used as a node of another graph (`addNode("research", researchGraph)`). State fields with the same name pass in and out automatically. The child's own fields stay inside. The parent needs a `thread_id` too, because the child has a checkpointer.

**Time travel**

| Call | What it does |
|---|---|
| `getStateHistory(config)` | One saved step per node, newest first |
| `invoke(null, checkpoint.config)` | **Replay** from that step: only what comes after runs (no searches again) |
| `updateState(checkpoint.config, values, "search")` | **Fork**: the values go through the reducers, then the run continues |

- **A fork needs the third argument.** It names the node that "wrote" the edit. Without it, the edit counts as coming from `START`, and the whole fan-out ran again (7 results instead of 4).
- **Same thread, growing state.** On a reused thread, the join reducer keeps adding results (3, then 6, then 9). Use a new thread per run, or design a reset.
- **A low score is not "nothing found".** A nonsense question still returned a best match (score 0.18). A real version would drop results under a threshold.

---

## 9. Phase 8: production-ready

**The API** (`src/langgraph/api.ts`, called by `POST /api/langgraph`):

| Request | Result |
|---|---|
| `{ question, threadId? }` | `200 answered` or `200 needs_approval` |
| `{ threadId, decision }` | Resumes the paused run; `409` if nothing is waiting |
| Bad input (empty, too long, bad `threadId`, both fields) | `400`, the agent is not called |
| Takes longer than 60 s | `504`, the run is cancelled |
| Empty answer | `502` |
| Anything else breaks | `500` "Something went wrong" (details only in the server log) |

**Things I learned**

- **Validate at the edge** with zod (lengths, allowed characters for `threadId`, "a question or a decision, not both") and check the output too (not empty).
- **Keep the logic out of the route.** The route is about 15 lines. The logic is a plain function, so tests can call it with a fake agent, offline.
- **Never send error details to the caller.** The test checks that a crash's message doesn't appear in the response.
- **Idempotency.** A tool gets its own call id (`config?.toolCall?.id`), so `send_email` can refuse to send the same call twice. The id set is in memory, so it is lost on restart. A real version stores it in the database.
- **A decision can't be sent twice.** The second one gets `409`, because the thread is no longer waiting.
- **Recovery was proven for real.** I paused a run for approval, killed the server, started it again, sent the approval, and the email went out once.
- **One log line per request** with the request id, thread id, status, time, steps and tokens, and never the question or the answer.
- **SQLite allows one server process per database file.** More servers need a database server such as Postgres.
- **Not built:** login, rate limiting, a stored record of sent emails, and a way to write the answer as a stream to the browser.

**The page `/langgraph`** (`src/app/langgraph/`) is a small chat that uses the API: messages, a thread kept for the conversation, an approval card (Approve, Edit as JSON, Reject), and a "New chat" button.

---

## 10. Testing and evaluation

**Two different jobs**

| | Tests | Eval |
|---|---|---|
| Question | Does my code do what I wrote? | Does the agent answer well? |
| Model needed? | No, fake data | Yes, real calls |
| Result | Same every time | Varies, so repeat runs |
| Cost | Free, seconds | Real money, minutes |

**The test files** (`src/langgraph/tests/`): state (7), tool-node (8), memory (7), approve (6), stream (7), research (9), api (18), tools (12). Each one protects an idea from a phase. Tests caught real bugs: trimming the current question away, a shared call id breaking idempotency, a wrong step limit.

**How an eval case is judged.** A line in `eval/agent-fresh.jsonl` has a `question`, an `expect` (a plain description of a correct answer) and `checks` (rules about behaviour).
1. **Code checks the behaviour:** `mustCall`, `mustNotCall`, `maxToolCalls`, and similar. Exact, no model.
2. **An LLM judge checks the answer** against `expect`. It returns `{ pass, reason }` at temperature 0.
3. A run passes only if **both** pass.

**What I ran:** 17 original questions and 16 fresh ones (written before seeing results), 2 repeats each, hand-built agent against LangGraph agent, same judge, no prompt changes.

| | Hand-built | LangGraph |
|---|---|---|
| Original 17 (34 runs) | 32/34 | 32/34 |
| Fresh 16 (32 runs) | 27/32 | 28/32 |
| Chat tokens per run (original / fresh) | 3777 / 4031 | 4040 / 4740 |

**What it showed:** the two agents behave the same. Every failure was shared (a one-line format request, a question that didn't force a search, never mentioning a missing chunk id), so the cause is the prompt and the questions, not the framework. A one-run difference is noise. The judge can be wrong too: it once marked a correct "Wednesday" answer as wrong.

---

## 11. LangGraph versus a hand-built loop

| Need | LangGraph gave | I wrote |
|---|---|---|
| The loop | `StateGraph`, edges, conditional edges | The tools node |
| Memory | Checkpointer and `thread_id` | Trimming what the model sees |
| Pausing for a human | `interrupt()`, `Command({ resume })` | The approval rules and the API |
| Progress and tokens | `stream` modes | Formatting, timing, filtering |
| Cancelling | The `signal` option | Turning it into a message or a `504` |
| Parallel work, retries, caching, replay | `Send`, `retryPolicy`, `cachePolicy`, `getStateHistory` | Choosing what to run in parallel |
| Step limit | `recursionLimit` | Raising it when a node was added |
| Guardrails (error budget, untrusted wrapper, validation, idempotency) | nothing | all of it |

**When it is worth it:** when the agent needs memory, pauses, parallel branches or replay. Those are easy to get wrong by hand. For a single loop with a few tools, the hand-built version did the same job with more guards already built in (it has 6 guardrails the LangGraph agent doesn't: forced answer at the step budget, tool-call budget, repeat guard, hung-tool timeout, token budget, citation check). The guards were the real work in both.

---

## 12. Gotchas in one list

1. A run of S steps needs `recursionLimit` of at least S + 1, and adding a node changes S.
2. `bindTools` doesn't run tools. Every tool call needs a `ToolMessage` with the same `tool_call_id`.
3. A node returns an update, not the whole state, and a field changes only if it is returned.
4. Everything in the state is saved. A counter that should reset needs an explicit reset.
5. A node can't share a name with a state field.
6. Trim history from a human message on, and never trim the current question.
7. On resume, the node runs again from the top, so no side effects before `interrupt()`.
8. A pause is not an error. Read it with `getState`.
9. Reject must answer every tool call. Edit by replacing the message with the same id.
10. In `messages` stream mode, filter by node, or tool output looks like the answer.
11. A fork needs `asNode` as the third argument.
12. Parallel results arrive in any order, so sort them if the order matters.
13. A reused thread keeps old state, which a join reducer keeps growing.
14. A prompt is not a guard. A model's wording can be wrong about what was done.
15. Windows: the SQLite file stays locked until the process ends. Terminal readline needs its own `SIGINT` listener.

---

## 13. Where everything is

```
src/langgraph/
  agent.ts          the graph, runAgent, resumeAgent, streaming
  state.ts          AgentState and its reducers
  tool-node.ts      runTools, afterTools, giveUp
  approve.ts        the approval step (interrupt)
  api.ts            validation, time limit, status codes, logging
  research.ts       parallel search graph (Send, retries, cache)
  report.ts         the subgraph example
  summary.ts        runs one question for the evaluation
  tools/            six tools (search, get chunk, list, calculate, date, send email)
  tests/            eight test files and the real-model check
src/app/api/langgraph/route.ts   the one route
src/app/langgraph/               the chat page
eval/agent.jsonl, agent-fresh.jsonl, results/
docs/LANGGRAPH-SPEC.md           the full record with every verified fact
```

**Commands**

```bash
npm run langgraph -- "What is Kafka?"            # ask from the terminal (streams, asks for approval)
npm run langgraph-research                       # parallel search + saved checkpoints
npm run langgraph-report                         # subgraph + cache on a second run
npm run test:langgraph-api                       # also: -tools -state -tool-node -memory -approve -stream -research
npm run test:langgraph-eval                      # the real agent through the API (needs OpenAI and Qdrant)
npm run agent:behaviour -- --langgraph --repeat 2   # the comparison
```

---

## 14. Glossary

- **Agent:** a loop where a model decides between answering and using tools.
- **Node / edge / state:** a step function / the order between steps / the data they share.
- **Reducer:** the rule that merges a node's update into one state field.
- **Checkpoint / checkpointer:** a saved copy of the state after a step / what saves it.
- **Thread (`thread_id`):** one conversation's saved history.
- **Interrupt / resume:** pause a run for a human / continue it with the human's answer.
- **Fan-out / `Send`:** start the same node several times in parallel, each with its own input.
- **Subgraph:** a graph used as a node of another graph.
- **Replay / fork:** run again from an old checkpoint / change the state there first.
- **Idempotent:** doing it twice has the same effect as once.
- **Eval:** a repeatable check of how well the model-based system behaves.
- **LLM judge:** a model that grades an answer against a written expectation.

---

## 15. Not covered (good next steps)

- Long-term memory across threads (LangGraph's store).
- A Postgres checkpointer for more than one server.
- Login, rate limiting and cost limits on the API.
- Streaming the answer to the browser.
- A larger eval set, human checks of the judge, and running the eval on every change.
- Hosted tracing (LangSmith) and LangGraph Studio.
- The six guardrails the hand-built agent has and this one doesn't.

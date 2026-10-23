# MCP: Specification and Learning Plan

> Learn the **Model Context Protocol (MCP)** by building both sides of it in this project: a server that exposes the document tools, and a client that lets an agent use them. Companion to [`LANGGRAPH-SPEC.md`](./LANGGRAPH-SPEC.md) (the agent built in the LangGraph work) and [`SPEC-AGENT.md`](../SPEC-AGENT.md) (the hand-built agent, which said MCP "will get its own spec when the time comes"). This is that spec.

| | |
|---|---|
| **Status** | Draft v0.1, 2026-10-23. **Plan only: nothing is built yet.** Phase M1 is next. |
| **Owner** | Aditya Dey |
| **Primary goal** | **Understand how MCP works** by using each of its core ideas in real code, with every message visible. |
| **Interface** | A command line, the MCP Inspector, Claude Code or Claude Desktop (as a host), and tests. **No browser UI.** |
| **Not a goal** | Replacing the LangGraph agent, the hand-built agent or the web app. |

**How we work (same rules as the LangGraph work)**

- **One phase at a time.** Each phase ends with this file updated (what was built, what was verified, what was not checked), and only then the next phase starts.
- **Same structure:** a plan with phases, each with topics, a practical task and an outcome, and a "verified facts" table that grows.
- **Redundant code on purpose.** MCP code lives in its own folder, `src/mcp/`, and imports nothing from the rest of the project. Code that already exists elsewhere (retrieval, the document tools, the prompt) is **copied** into that folder. A test enforces it, like the one in `src/langgraph/`.
- **Plain code:** one idea per line, short numbered comments, no clever one-liners, no helpers that only shorten a function (the style asked for in the LangGraph work).
- **One spec file.** Progress goes into this file, not into new README files.
- **No commits unless asked.**

---

## 1. Purpose

The project already has tools: search the documents, get one passage, list the documents, a calculator, the date, and a pretend email. They are defined **inside** the agents. That works, but each new app or agent needs its own copy of the definitions and its own code to run them.

**MCP is the standard that separates the two sides.** A *server* offers tools (and data and prompts) in a standard format. A *client* inside any AI app can then discover and call them without knowing how they are written. The same document tools could be used from Claude Code, Claude Desktop, the LangGraph agent, or any other MCP client.

This plan builds that in small steps, and checks the one risk MCP adds: **using tools written by someone else**, whose descriptions and results cannot be trusted.

### What you should be able to explain at the end

| Question | Phase |
|---|---|
| What are a host, a client and a server, and what travels between them? | M1 |
| What are tools, resources and prompts, and who controls each? | M1, M3 |
| What are the two standard transports, and why must a stdio server never write to stdout? | M1, M2 |
| How does a client find out what a server offers (`tools/list`) and use it (`tools/call`)? | M1, M2, M4 |
| How is a tool defined in MCP, and how is that mapped to a LangChain or LangGraph tool? | M2, M4 |
| Why does MCP treat tool descriptions and results as untrusted, and what do we do about it? | M5 |
| What changes when a server is remote (HTTP, authentication)? | M6 |
| Does using MCP tools change the quality, tokens or speed of the agent? | M6 |

---

## 2. Verified facts

Checked on 2026-10-23 from the official documentation and the npm registry. **"Docs" means read in the documentation, not yet run in this project.** Every item below is re-checked by running it in the phase shown.

| # | Fact | Source | Used in | Run here |
|---|---|---|---|---|
| 1 | The current protocol revision is **2026-07-28** | docs | all | ⬜ |
| 2 | Messages are **JSON-RPC 2.0**. This revision is **stateless**: every request is self-contained and carries its protocol version and client capabilities in `_meta`. Earlier revisions used a connection-scoped session with an `initialize` handshake; clients and servers detect the other side's era and fall back | docs | M1, M2 | ⬜ |
| 3 | A **server** can offer three features: **tools** (functions the model calls), **resources** (data to read) and **prompts** (templates for the user). A **client** can offer **elicitation** (the server asks the user for more input). Optional, opt-in extensions: Tasks, Skills over MCP, MCP Apps | docs | M1, M3 | ⬜ |
| 4 | Two standard **transports**. **stdio:** newline-delimited JSON-RPC over the standard streams of a subprocess that the client launches. **Streamable HTTP:** each message is an HTTP POST to one endpoint, and the reply is a JSON object or a request-scoped SSE stream. Cancel: a `notifications/cancelled` message on stdio, closing the response stream on HTTP | docs | M1, M2, M6 | ⬜ |
| 5 | **A stdio server must never write to stdout** (`console.log` corrupts the messages). Use `console.error` (stderr) or a file. HTTP servers may log to stdout | docs | M2 | ⬜ |
| 6 | TypeScript SDK **v2** is split into packages: `@modelcontextprotocol/server` (2.3.1), `@modelcontextprotocol/client` (2.3.1) and `@modelcontextprotocol/core` (2.3.1). They need Node 20 or newer and zod 4. The older single package `@modelcontextprotocol/sdk` (1.32.1) is still published (v1) | npm | M2, M4 | ⬜ |
| 7 | **Server API (docs):** `import { McpServer } from "@modelcontextprotocol/server"` and `import { serveStdio } from "@modelcontextprotocol/server/stdio"`. A tool is `server.registerTool(name, { description, inputSchema: z.object({...}) }, async (args) => ({ content: [{ type: "text", text }] }))`. Start with `serveStdio(createServer, { onerror })`, where `createServer()` must return a **new** `McpServer` on every call. Wiring it by hand with `server.connect(new StdioServerTransport())` compiles but only serves 2025-era clients | docs | M2 | ⬜ |
| 8 | **Client API (docs):** `import { Client } from "@modelcontextprotocol/client"` and `import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"`. `new Client({ name, version })`, `await client.connect(transport)`, `await client.listTools()`, `await client.callTool({ name, arguments })`, `await client.close()` | docs | M4 | ⬜ |
| 9 | **MCP Inspector** (`@modelcontextprotocol/inspector`, 2.12.0): `npx @modelcontextprotocol/inspector --cli node build/index.js --protocol-era modern --method tools/list` lists a server's tools from the command line | docs, npm | M1, M2 | ⬜ |
| 10 | **Claude Desktop** loads servers from `claude_desktop_config.json` (Windows: `%AppData%\Claude\claude_desktop_config.json`) with `{ "mcpServers": { "name": { "command": "node", "args": ["C:\\path\\to\\index.js"] } } }` (the backslashes are doubled because it is JSON). The server must be built first | docs | M2 | ⬜ |
| 11 | `@langchain/mcp-adapters` **2.0.1**: Node 20.10 or newer, peers `@langchain/core` ^1.2.6 and `@langchain/langgraph` ^1.4.18 (this project has 1.5.0), and it depends on `@modelcontextprotocol/client` ^2.2.0. `new MultiServerMCPClient({ math: { transport: "stdio", command: "node", args: [path] } })` and `await client.getTools()` give LangChain tools. It is stateless by default: every tool call opens a fresh session and closes it | npm, LangChain docs | M4 | ⬜ |
| 12 | **Security (spec):** hosts must get the user's explicit consent before invoking any tool, and descriptions or annotations of tools must be treated as **untrusted** unless the server is trusted. MCP itself cannot enforce this, so the host must | docs | M5 | ⬜ |
| 13 | This machine: Node 22.20 (needs 20 or newer), Windows, Qdrant in Docker for the search tools | checked | all | ✅ |

**Not known yet** (to be found by running it): how `serveStdio` behaves on Windows, the exact `registerTool` and `registerResource` signatures in the installed version, the prompts API, how a Streamable HTTP server is started with the v2 package, what the authentication helpers look like, whether `@langchain/mcp-adapters` works with this project's LangGraph graph, and how `@modelcontextprotocol/server-filesystem` (2.0.0) is started.

---

## 3. Design

**Two programs, one protocol:**

```
 host (an AI app)                                   server (a program that offers tools)
 ┌──────────────────────┐   JSON-RPC over stdio   ┌──────────────────────────────┐
 │  client  ── tools/list ───────────────────────▶ │  search_documents            │
 │          ◀─ tool definitions ─────────────────  │  get_chunk                   │
 │          ── tools/call (name, args) ──────────▶ │  list_documents              │
 │          ◀─ result (content) ─────────────────  │  (M3: resources, prompts)    │
 └──────────────────────┘                          └──────────────────────────────┘
```

**What gets built**

| Side | What | Phase |
|---|---|---|
| Server | `src/mcp/server.ts`: three document tools over stdio, later resources and prompts | M2, M3 |
| Client | `src/mcp/client.ts`: connects to a server, lists and calls its tools | M4 |
| Bridge | `src/mcp/adapter.ts`: turns an MCP tool into a LangChain tool, written by hand first | M4 |
| Agent | `src/mcp/agent.ts`: a small graph (`llm → tools → llm`) that uses MCP tools | M4 |
| Safety | An allowlist, approval of risky tools, time limits, a check of results | M5 |
| Remote | The server over Streamable HTTP with simple authentication | M6 |

### Code principles

1. **Self-contained folder, redundant code.** `src/mcp/` imports nothing outside itself. The search code, the config and the system prompt are copied. A test fails if a file imports from outside the folder.
2. **Use the SDK's own pieces first** (`McpServer`, `serveStdio`, `Client`, the adapters package). Write our own version only when seeing how it works is the lesson (the tool adapter in M4).
3. **Plain, readable code:** one idea per line, short numbered comments, and `Example:` lines above functions, as in `src/langgraph/`.
4. **A small agent only.** The MCP agent in M4 is the simple loop (the Phase 1 to 3 core). Streaming, memory, approval and the API from the LangGraph work are **not** copied unless a phase needs them (M5 adds approval).
5. **The LangGraph agent is not changed.** Comparing the two in M6 needs both to stay as they are.

### Standing technical rules

- **stdio servers log to stderr only.** A `log()` helper in `src/mcp/` writes with `console.error`.
- **Tool results are data, not instructions.** The wrapper from the LangGraph work (`wrapToolResult`) is copied and used for every result from a server we did not write.
- **No secrets in logs or results.** Server environment variables are passed explicitly, never inherited by default (checked in M5).

---

## 4. Concept map: what we have, and what MCP replaces

| In the project today | In MCP |
|---|---|
| A tool is defined inside the agent's folder (`tool({...})`, a zod schema, a description) | A tool is defined in a **server** (`server.registerTool`, a zod schema, a description) and **discovered** by `tools/list` |
| The agent imports the tool and calls it as a function | The client sends `tools/call` and gets the result back |
| `model.bindTools(tools)` tells the model about the tools | The client turns `tools/list` into the model's tool definitions |
| The `tools` node runs the call | The same node, but it calls `client.callTool` |
| Tool result wrapped as untrusted data | The same, and now it matters more because the server may not be ours |
| Risky tools need approval (`approve` node) | Same idea. The spec says the host must ask for consent |
| Only our own code can use the tools | Any MCP client can use them: Claude Code, Claude Desktop, other agents |
| Tools are always available, so nothing can go wrong with "finding" them | A server can be down, slow, change its tools, or return huge output |

**Expected finding (to be checked in M6):** MCP moves the *definition* of tools out of the agent, but not the *guardrails*. Every limit that exists today (approval, time limits, output checks, injection defense) still has to be written by whoever builds the client. MCP adds a boundary where some of those matter more.

---

## 5. Watching it work

MCP is hard to understand from code alone, so each phase shows the messages:

| Tool | Use |
|---|---|
| **MCP Inspector** (CLI and web) | List tools, call a tool, see the JSON-RPC messages and the raw result |
| **stderr log** of our server | One line per request: method, tool name, time, result size (never the document text) |
| **Client log** in `src/mcp/` | What the client sent and received, with the same short style as the LangGraph logs |
| **Claude Code or Claude Desktop** | The real host: does it see the tools, and does it use them |

---

## 6. Module layout (planned)

```
src/mcp/
  config.ts           copy: collection name, embedding model
  log.ts              stderr logger (stdout is the protocol channel)
  retrieval.ts        copy: search, get one chunk, list documents (Qdrant + embeddings)
  prompt.ts           copy: the untrusted-result wrapper (and the system prompt for M4)
  tools/              the three document tools, in MCP format          (M2)
  server.ts           stdio entry point                                 (M2)
  resources.ts        document sections as resources                    (M3)
  prompts.ts          prompt templates                                  (M3)
  client.ts           connect, list tools, call a tool                  (M4)
  adapter.ts          MCP tool → LangChain tool                         (M4)
  agent.ts            the small graph with MCP tools                    (M4)
  safety.ts           allowlist, approval list, limits, output check    (M5)
  http-server.ts      Streamable HTTP entry point                       (M6)
  tests/              offline tests and protocol tests
docs/MCP-SPEC.md      this file
```

**Planned scripts** (added by the phase that needs them): `mcp:server` (run the server), `mcp:inspect` (the Inspector against it), `mcp:agent` (ask the MCP agent a question), `test:mcp-*` (one per area).

**Planned dependencies** (added in the phase that first needs them): `@modelcontextprotocol/server` (M2), `@modelcontextprotocol/client` (M4), `@modelcontextprotocol/inspector` as a dev tool (M1 or M2). `@langchain/mcp-adapters` only if M4's comparison step is done.

---

## 7. The learning path: Phases M1 to M6

Each phase: **topics**, a **practical task**, an **outcome**, how it is **checked**, and a **record** that is filled in when the phase is done.

### Phase M1: The protocol, with no code of ours ⏭️ *next lesson*

Learn what MCP is by watching a ready-made server.

- Host, client and server; the three server features
- JSON-RPC messages: `tools/list`, `tools/call`, and the per-request metadata of this revision
- The two transports, and what "stateless" changes compared with the older handshake
- Reading the MCP Inspector

**Practical task:** run the Inspector against a ready-made server (the reference filesystem server is the candidate; to be confirmed), list its tools, call one, and write down the messages that were sent and received.

**Outcome:** you can draw the message flow for one tool call and name every field in it.

**Checked by:** the written messages in this file's M1 record (no code to test). Facts 1 to 5 and 9 are marked as run.

**Design:** sections 2 and 3, facts 1 to 5, 9.

**Record:** (empty)

---

### Phase M2: Build a server (stdio)

Expose the document tools so any MCP client can use them.

- `McpServer`, `registerTool`, a zod input schema, a text result
- `serveStdio` and why the factory returns a fresh server each time
- Errors: how a failed tool is reported (a result marked as an error, not a crash)
- Logging to stderr
- Copying the retrieval code so the folder stands alone

**Practical task:** build `src/mcp/server.ts` with `search_documents`, `get_chunk` and `list_documents` (the same behaviour as the LangGraph tools). Test it with the Inspector (`tools/list`, then calls), then add it to Claude Code or Claude Desktop and ask a question about the documents.

**Outcome:** the documents can be searched from a host that has never seen this project's code.

**Checked by:** offline tests of each tool handler (no Qdrant, a fake search), a protocol test that starts the server as a subprocess, lists its tools and calls one, a test that nothing is written to stdout except protocol messages, the "stands alone" test, and one real run against Qdrant.

**Design:** sections 3 and 4, facts 5 to 10.

**Record:** (empty)

---

### Phase M3: Resources and prompts

Learn the other two server features.

- **Resources:** data the host can read (a document section as text), and resource templates
- **Prompts:** a template the user picks (for example "summarise this section")
- Who controls what: the model calls tools, the app reads resources, the user picks prompts

**Practical task:** add one resource per document section and one prompt template to the server, then read the resource and use the prompt from the Inspector and from the host.

**Outcome:** you can say when to use a tool, a resource or a prompt for the same information.

**Checked by:** offline tests for the resource list and read, and for the prompt text; a protocol test that lists resources and prompts.

**Design:** fact 3.

**Record:** (empty)

---

### Phase M4: Build a client and use MCP tools in an agent

Learn the other side: an app that uses a server's tools.

- `Client`, `StdioClientTransport`, `connect`, `listTools`, `callTool`, `close`
- Mapping an MCP tool definition (name, description, input schema) to a LangChain tool
- Launching the server as a subprocess, and what happens when it fails or exits
- `@langchain/mcp-adapters` compared with the adapter written by hand

**Practical task:** write `client.ts` and `adapter.ts`, build the small agent graph in `agent.ts`, and ask it the same question that the LangGraph agent answers, with the tools coming from the M2 server. Then try `@langchain/mcp-adapters` instead of the hand-written adapter and compare the code and the behaviour.

**Outcome:** an agent whose tools are not defined in its own code.

**Checked by:** offline tests of the adapter (an MCP definition in, a working LangChain tool out), a protocol test of the client against the M2 server, a real question through the agent, and a note on what the adapters package did differently.

**Design:** sections 3 and 4, facts 6, 8, 11.

**Record:** (empty)

---

### Phase M5: External servers and safety

Learn what changes when the tools are not yours.

- Adding a third-party server (candidate: the reference filesystem server limited to a sample folder)
- An **allowlist** of tools the agent may see, and a list of **risky** tools that need approval (reusing the approval idea from the LangGraph work)
- Untrusted descriptions and results (prompt injection through a tool result or a resource)
- Time limits, output size limits, and what happens when a server hangs or returns too much
- Which environment variables and credentials a server gets

**Practical task:** connect a second server, allow only some of its tools, require approval for any that can change data, and test normal, hostile and failing cases (a result that contains instructions, a tool that never answers, a huge result).

**Outcome:** a client that stays safe when a server misbehaves.

**Checked by:** offline tests with a fake hostile server (injection text, a hang, a huge output), a test that a tool outside the allowlist is never offered or called, a test that a risky tool needs approval, and a real run with the third-party server.

**Design:** sections 3 and 4, fact 12.

**Record:** (empty)

---

### Phase M6: Remote server and evaluation

Learn what changes over HTTP, and measure the result.

- Streamable HTTP: one endpoint, POST requests, a JSON or SSE reply
- Who may call the server: authentication (a simple bearer token first; OAuth only described)
- Binding to localhost and checking the origin
- Re-running the existing evaluation (`agent:behaviour`) with MCP tools, like `--langgraph` before

**Practical task:** serve the same tools over HTTP, call them from the client with a token, and run the evaluation with the MCP agent next to the LangGraph agent on the same questions.

**Outcome:** a measured comparison (success, steps, tokens, cost, time) between local tools and MCP tools, and a clear picture of what a remote server needs.

**Checked by:** offline tests of the token check and the rejected cases, a protocol test over HTTP, and the evaluation results saved in `eval/results/`.

**Design:** section 8, facts 4, 12.

**Record:** (empty)

---

## 8. Evaluation (end of the plan)

The same rules as in the LangGraph evaluation: the same questions, the same judge, 2 repeats or more, no prompt changes between runs, and fresh questions written before looking at results. The harness gets a `--mcp` flag in the same way it got `--langgraph`, which is the one change outside `src/mcp/` that this plan expects.

| Measure | How |
|---|---|
| Task success, model calls, tool calls, tokens, cost, time | `agent:behaviour -- --mcp --langgraph --repeat 2` |
| Extra time per tool call | The difference in time per tool step against the LangGraph agent |
| Extra tokens | The tool definitions are sent to the model on every call, so the difference shows in input tokens |
| Code size and guardrails | Lines in `src/mcp/` against `src/langgraph/`, and which guardrails had to be rewritten |

**Expectation to test:** the success rate is the same (the model sees the same tools), and the time per tool call is a little higher (a process or HTTP hop). If it is not, find out why.

---

## 9. Risks and open questions

| Risk | Plan |
|---|---|
| The protocol and the SDK are new and change (a stateless revision, a v2 SDK split in packages) | Every fact is checked by running it in its phase. Versions are pinned when added. Examples found online may use the older `@modelcontextprotocol/sdk` and the `initialize` handshake. |
| A stdio server that prints to stdout breaks silently | One logger that writes to stderr, and a test that checks stdout |
| Tool descriptions and results from other servers can contain instructions | Treat as untrusted (M5): the wrapper, an allowlist, approval for risky tools |
| A server can hang, crash or return huge output | Time and size limits in the client (M5), tested with a fake server |
| Every tool definition is sent to the model on every call | Offer only the tools that are needed (the allowlist), and measure it (M6) |
| Windows: starting a subprocess (`node`, `npx`) and file paths in the host config | Tested in M2 on this machine; paths written with escaped backslashes |
| Docker and Qdrant must be running for any real test | Real runs are separate from offline tests and are skipped when Qdrant is not available |
| Packages with native or large dependencies | Added only in the phase that needs them |

### Open decisions (proposed answers, to be confirmed before the phase that needs them)

1. **Which SDK:** the v2 packages (`@modelcontextprotocol/server` and `/client`) that the current documentation uses. The old `@modelcontextprotocol/sdk` (1.x) is not used. *Proposed. Decided in M2.*
2. **Adapter:** write `adapter.ts` by hand first, then try `@langchain/mcp-adapters` and compare. *Proposed. Decided in M4.*
3. **Host for the real test in M2:** the MCP Inspector is required; Claude Code or Claude Desktop is the extra. *To be chosen in M2.*
4. **Third-party server in M5:** the reference filesystem server on a sample folder. *To be confirmed in M5.*
5. **Authentication in M6:** a static bearer token is built; OAuth is only described. *Proposed.*
6. **Where the HTTP server runs in M6:** a separate Node process, not a Next.js route. *Proposed.*
7. **Whether `src/mcp/agent.ts` keeps approval, memory and streaming:** no; only the small loop, plus approval in M5. *Proposed.*

---

## 10. Scope

**In scope:** an MCP server (tools, resources, prompts) over stdio and HTTP, an MCP client, a small agent using MCP tools, the safety rules for third-party servers, simple authentication, tests, and the evaluation against the LangGraph agent.

**Out of scope** (until a phase says otherwise):

- Changing `src/langgraph/`, the hand-built agent, the retrieval or the prompt.
- A browser UI for MCP (the existing `/langgraph` page stays as it is).
- OAuth implementation (described only), multi-user accounts, hosting or deployment.
- MCP extensions (Tasks, Skills over MCP, MCP Apps) and the client feature elicitation, except to describe them.
- Writing servers for other data sources.
- Hosted tracing services.

---

## 11. Definition of done

Items are checked off as phases complete.

- [ ] The message flow of one tool call is written down from a real server, with every field explained. *(M1)*
- [ ] `src/mcp/` imports nothing from outside itself (enforced by a test), and nothing in it writes to stdout in the server.
- [ ] The three document tools work over stdio: tested offline, through the Inspector and from a host. *(M2)*
- [ ] Resources and a prompt are served and read. *(M3)*
- [ ] An agent answers a question using tools that come from the server, and the hand-written adapter is compared with `@langchain/mcp-adapters`. *(M4)*
- [ ] A third-party server is connected behind an allowlist and an approval rule; hostile, hanging and oversized results are tested. *(M5)*
- [ ] The server also runs over HTTP with a token check, and the cases without a token or with a wrong one are rejected. *(M6)*
- [ ] The evaluation ran with `--mcp` next to `--langgraph`, and the results and what MCP did and did not change are written here. *(M6)*
- [ ] Existing suites still pass (the LangGraph tests and the hand-built agent's tests).
- [ ] Code follows the principles in section 3 throughout.
- [ ] No outbound calls other than OpenAI, Qdrant and the servers chosen in M5.

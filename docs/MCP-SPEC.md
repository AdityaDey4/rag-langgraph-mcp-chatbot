# MCP: Specification and Learning Plan

> Learn the **Model Context Protocol (MCP)** by building both sides of it in this project: a server that exposes the document tools, and a client that lets an agent use them. Companion to [`LANGGRAPH-SPEC.md`](./LANGGRAPH-SPEC.md) (the agent built in the LangGraph work) and [`SPEC-AGENT.md`](../SPEC-AGENT.md) (the hand-built agent, which said MCP "will get its own spec when the time comes"). This is that spec.

| | |
|---|---|
| **Status** | Draft v0.4, 2026-10-23. **Phases M1 to M3 are done** (the protocol watched on a ready-made server; our own stdio server with the three document tools; resources and a prompt). Phase M4 (a client, and an agent that uses MCP tools) is next. |
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
| 1 | The current protocol revision is **2026-07-28** | docs | all | ◐ the Inspector pins this version in `modern` mode (fact 14) |
| 2 | Messages are **JSON-RPC 2.0**. This revision is **stateless**: every request is self-contained and carries its protocol version and client capabilities in `_meta`. Earlier revisions used a connection-scoped session with an `initialize` handshake; clients and servers detect the other side's era and fall back | docs | M1, M2 | ◐ JSON-RPC and the old handshake ✅ (facts 15, 16); the stateless era needs a server that speaks it (M2) |
| 3 | A **server** can offer three features: **tools** (functions the model calls), **resources** (data to read) and **prompts** (templates for the user). A **client** can offer **elicitation** (the server asks the user for more input). Optional, opt-in extensions: Tasks, Skills over MCP, MCP Apps | docs | M1, M3 | ◐ tools ✅ (fact 17); resources and prompts in M3 |
| 4 | Two standard **transports**. **stdio:** newline-delimited JSON-RPC over the standard streams of a subprocess that the client launches. **Streamable HTTP:** each message is an HTTP POST to one endpoint, and the reply is a JSON object or a request-scoped SSE stream. Cancel: a `notifications/cancelled` message on stdio, closing the response stream on HTTP | docs | M1, M2, M6 | ◐ stdio ✅ (fact 19); HTTP in M6 |
| 5 | **A stdio server must never write to stdout** (`console.log` corrupts the messages). Use `console.error` (stderr) or a file. HTTP servers may log to stdout | docs | M2 | ✅ seen in a real server (fact 19); breaking it on purpose is a test in M2 |
| 6 | TypeScript SDK **v2** is split into packages: `@modelcontextprotocol/server` (2.3.1), `@modelcontextprotocol/client` (2.3.1) and `@modelcontextprotocol/core` (2.3.1). They need Node 20 or newer and zod 4. The older single package `@modelcontextprotocol/sdk` (1.32.1) is still published (v1) | npm | M2, M4 | ✅ installed in M2 (facts 22, 28) |
| 7 | **Server API (docs):** `import { McpServer } from "@modelcontextprotocol/server"` and `import { serveStdio } from "@modelcontextprotocol/server/stdio"`. A tool is `server.registerTool(name, { description, inputSchema: z.object({...}) }, async (args) => ({ content: [{ type: "text", text }] }))`. Start with `serveStdio(createServer, { onerror })`, where `createServer()` must return a **new** `McpServer` on every call. Wiring it by hand with `server.connect(new StdioServerTransport())` compiles but only serves 2025-era clients | docs | M2 | ✅ (fact 22) |
| 8 | **Client API (docs):** `import { Client } from "@modelcontextprotocol/client"` and `import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"`. `new Client({ name, version })`, `await client.connect(transport)`, `await client.listTools()`, `await client.callTool({ name, arguments })`, `await client.close()` | docs | M4 | ✅ in the M2 tests (fact 28) |
| 9 | **MCP Inspector** (`@modelcontextprotocol/inspector`, 2.12.0): `npx @modelcontextprotocol/inspector --cli node build/index.js --protocol-era modern --method tools/list` lists a server's tools from the command line | docs, npm | M1, M2 | ✅ (fact 20) |
| 10 | **Claude Desktop** loads servers from `claude_desktop_config.json` (Windows: `%AppData%\Claude\claude_desktop_config.json`) with `{ "mcpServers": { "name": { "command": "node", "args": ["C:\\path\\to\\index.js"] } } }` (the backslashes are doubled because it is JSON). The server must be built first | docs | M2 | ◐ the config for this server is written below; no host was tried |
| 11 | `@langchain/mcp-adapters` **2.0.1**: Node 20.10 or newer, peers `@langchain/core` ^1.2.6 and `@langchain/langgraph` ^1.4.18 (this project has 1.5.0), and it depends on `@modelcontextprotocol/client` ^2.2.0. `new MultiServerMCPClient({ math: { transport: "stdio", command: "node", args: [path] } })` and `await client.getTools()` give LangChain tools. It is stateless by default: every tool call opens a fresh session and closes it | npm, LangChain docs | M4 | ⬜ |
| 12 | **Security (spec):** hosts must get the user's explicit consent before invoking any tool, and descriptions or annotations of tools must be treated as **untrusted** unless the server is trusted. MCP itself cannot enforce this, so the host must | docs | M5 | ⬜ |
| 13 | This machine: Node 22.20 (needs 20 or newer), Windows, Qdrant in Docker for the search tools | checked | all | ✅ |
| 14 | **The reference filesystem server (`@modelcontextprotocol/server-filesystem` 2.0.0) speaks only the older era.** `server/discover` gets `-32601 Method not found`. The Inspector with `--protocol-era modern` fails with "the server did not offer pinned protocol version 2026-07-28 via server/discover (no fallback in pin mode)". With `legacy` or `auto` it works. So not every server speaks the current revision, and a client has to handle both | run in M1 | M2, M4, M5 | ✅ |
| 15 | **Messages on stdio** are one JSON-RPC 2.0 object per line. A **request** has an `id` and the reply has the same `id`. A **notification** (for example `notifications/initialized`) has no `id` and gets no reply. A failed method is a JSON-RPC **error** (`{ "error": { "code": -32601, "message": "Method not found" } }`) | run in M1 | M1, M2, M4 | ✅ |
| 16 | **The older handshake:** the client sends `initialize` (`protocolVersion`, `capabilities`, `clientInfo`); the server replies with its own `protocolVersion`, `capabilities` and `serverInfo`; the client then sends `notifications/initialized`. This server answered `capabilities: { tools: { listChanged: true } }` only, so it offers **no resources and no prompts** | run in M1 | M2, M4 | ✅ |
| 17 | **A tool definition** (`tools/list`) has `name`, `title`, `description`, `inputSchema` (JSON Schema draft 2020-12), `outputSchema`, `annotations` and `execution`. The annotations are hints: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. The filesystem server lists **14 tools** (10 read-only, 4 that can change data: `write_file`, `edit_file`, `create_directory`, `move_file`). The list is **13,157 characters**, roughly 3,300 tokens (an estimate), so offering every tool to a model costs tokens on every call | run in M1 | M4, M5, M6 | ✅ |
| 18 | **A tool call result** has `content` (a list of typed blocks, here `text`) and optionally `structuredContent`. **A tool failure is a normal result with `isError: true`**, not a JSON-RPC error: a path outside the allowed folder gave `Access denied - path outside allowed directories…`, and a missing argument gave `MCP error -32602: Input validation error…` inside the text. The Inspector turns both into the error `tool_is_error`, and an unknown tool name into `tool_not_found` | run in M1 | M2, M4, M5 | ✅ |
| 19 | **A stdio server writes its own log lines to stderr** ("Secure MCP Filesystem Server running on stdio") and only messages to stdout. This server also asks the client for **roots** (the folders it may use); when the client has no roots support it falls back to the folder given on its command line | run in M1 | M2, M5 | ✅ |
| 20 | **Inspector 2.12.0 CLI:** `npx @modelcontextprotocol/inspector --cli <command and arguments of the server> --method tools/list`, and `--method tools/call --tool-name <name> --tool-arg key=value`. `-q` hides everything except the result, `--output <file>` writes it to a file, `--format json` prints JSON. **A command given on the line defaults to the `legacy` era**; use `--protocol-era auto` or `modern` for the current one. There are also `resources/read`, `prompts/get`, a load test (`--load`) and HTTP options (`--server-url`, `--header`) | run in M1 | M2 to M6 | ✅ |
| 21 | On Windows a Node script starts the server with `spawn("npx", [...], { shell: true })`; without `shell: true` the `npx` command is not found | run in M1 | M2, M4 | ✅ |
| 22 | **The server API works as the documentation says.** `McpServer` and `registerTool(name, { description, inputSchema: z.object({...}) }, handler)` from `@modelcontextprotocol/server` 2.3.1, started with `serveStdio(createServer, { onerror })` from `@modelcontextprotocol/server/stdio`. A handler returns `{ content: [{ type: "text", text }], isError? }`; its argument type is inferred from the zod schema, so `tsc` accepts `(args) => searchDocuments(args)`. The SDK is ESM-only, and it loads fine from this project's CommonJS scripts under `tsx` on Node 22.20 | run in M2 | M2 to M5 | ✅ |
| 23 | **A zod schema becomes the tool's JSON Schema (2020-12) by itself**: `.min()` and `.max()` on a string become `minLength` and `maxLength`, on a number `minimum` and `maximum`, `.describe()` becomes `description`, and an `.optional()` field is left out of `required`. An empty `z.object({})` becomes `{ "type": "object", "properties": {} }` | run in M2 | M2, M4 | ✅ |
| 24 | **Our server answers clients of both eras**: the Inspector with `--protocol-era modern`, `auto` and `legacy` all list the three tools. In the modern era every result carries `_meta["io.modelcontextprotocol/serverInfo"]` (`{ name: "rag-documents", version: "1.0.0" }`), because there is no handshake to tell the client who answered | run in M2 | M2, M4 | ✅ |
| 25 | **Failures are results, as in fact 18.** A tool that fails returns `isError: true` with the message (`Error: No passage found with chunkId "…"`). The SDK's own argument check does the same: `Input validation error: Invalid arguments for tool search_documents: query: Invalid input: expected string, received undefined` comes back as an `isError` result, not a JSON-RPC error. A chunk id that is not a UUID gives `Error: Bad Request` (Qdrant's own message, the same weak message as in the LangGraph tool) | run in M2 | M2, M4, M5 | ✅ |
| 26 | **`dotenv` 17 prints a line to stdout** when it loads `.env` ("injecting env…"), which would corrupt the protocol, so `config.ts` uses `quiet: true`. A test starts the server and checks that stdout stays empty and the log line "running on stdio" goes to stderr. Under `tsx` the first start takes a few seconds, so the test waits for that line | run in M2 | M2 | ✅ |
| 27 | **A host starts the server from another working directory**, so `.env` is found from the file's location (`__dirname`), not from the working directory. Checked by starting the server with absolute paths from the temp folder: `search_documents` worked | run in M2 | M2 | ✅ |
| 28 | **Registering resources and a prompt works as the types say.** A fixed resource: `server.registerResource(name, "rag://documents", { title, description, mimeType }, (uri) => ({ contents: [{ uri: uri.href, mimeType, text }] }))`. A template: `new ResourceTemplate("rag://sections/{section}", { list: () => ({ resources: [...] }) })` with a read callback `(uri, variables)`; the `list` option must be given (it may be `undefined`). A prompt: `server.registerPrompt(name, { title, description, argsSchema: z.object({...}) }, (args) => ({ messages: [...] }))` | run in M3 | M3 | ✅ |
| 29 | **`resources/list`** returns the fixed resources and the ones from every template's `list` callback together, each with `name`, `title`, `uri`, `description` and `mimeType`. **`resources/templates/list`** returns the templates (`name`, `title`, `uriTemplate`, `description`). Our 6 sections gave 7 resources: the document list and one per section | run in M3 | M3 | ✅ |
| 30 | **`resources/read`** returns `contents: [{ uri, mimeType, text }]`. In the modern era the result also has the cache hints `ttlMs: 0` and `cacheScope: "private"`, and the `_meta` with the server's name and version (as in fact 24) | run in M3 | M3, M4 | ✅ |
| 31 | **`prompts/list`** gives `name`, `title`, `description` and `arguments: [{ name, description, required }]`, built from the zod schema. **`prompts/get`** returns `messages`, each with a `role` and **one** content block; a block can be `text` or an embedded `resource` (`{ type: "resource", resource: { uri, mimeType, text } }`). Our prompt returns the instruction as text and then the section as an attached resource | run in M3 | M3, M4 | ✅ |
| 32 | **Errors for resources and prompts are protocol errors, not `isError` results.** An unknown section: `No section called "Nope".`; an address that is not a resource: `Resource not found: file:///etc/passwd`; a prompt without its argument: `Invalid arguments for prompt summarize_section: section: Invalid input: expected string, received undefined`. The SDK client rejects with them, and the Inspector shows `{"error": …}`. Only tool calls use `isError` (facts 18 and 25) | run in M3 | M3, M4 | ✅ |
| 33 | **The capabilities follow the registrations.** After the first `registerTool`, `registerResource` and `registerPrompt`, the client sees `tools`, `resources` and `prompts` in `getServerCapabilities()`; the filesystem server of fact 16 only had `tools` | run in M3 | M3, M4 | ✅ |
| 34 | **A failing template list breaks the whole `resources/list`.** With Qdrant unreachable, `resources/list` returns an error (`fetch failed`) and even the fixed resource is not listed; `resources/read rag://documents` fails the same way, while a tool call would return an `isError` result. A real server could catch the error in the list callback and return only the fixed resources; this one does not | run in M3 | M3, M5 | ✅ |

**Not known yet** (to be found by running it): how a client copes with servers of both eras (M4), whether `@langchain/mcp-adapters` works with this project's LangGraph graph (M4), how a Streamable HTTP server is started with the v2 package and what the authentication helpers look like (M6), and how a real host (Claude Code or Claude Desktop) shows the server (not tried). (How the filesystem server is started is now known: fact 20.)

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
  config.ts           copy: collection name, embedding model; loads .env from the project root        (M2, exists)
  log.ts              stderr logger (stdout is the protocol channel)                                  (M2, exists)
  retrieval.ts        copy: search, get one chunk, list documents (Qdrant + embeddings)               (M2, exists)
  prompt.ts           copy: the untrusted-result wrapper (and the system prompt for M4)               (M2, exists)
  tools/              search-documents.ts, get-chunk.ts, list-documents.ts, in MCP format             (M2, exists)
  server.ts           stdio entry point                                                               (M2, exists)
  resources.ts        the document list and the sections as resources                                (M3, exists)
  prompts.ts          the summarize_section prompt                                                   (M3, exists)
  client.ts           connect, list tools, call a tool                  (M4)
  adapter.ts          MCP tool → LangChain tool                         (M4)
  agent.ts            the small graph with MCP tools                    (M4)
  safety.ts           allowlist, approval list, limits, output check    (M5)
  http-server.ts      Streamable HTTP entry point                       (M6)
  m1-wire-trace.ts    M1: raw messages to a ready-made server, printed (learning script, exists)
  tests/              offline tests and protocol tests
docs/MCP-SPEC.md      this file
```

**Scripts that exist:** `mcp:m1-trace`, `mcp:server` (run the server), `test:mcp-tools`, `test:mcp-resources`, `test:mcp-server`. **Planned** (added by the phase that needs them): `mcp:inspect` (the Inspector against it), `mcp:agent` (ask the MCP agent a question), `test:mcp-*` (one per area).

**Dependencies:** `@modelcontextprotocol/server` and `@modelcontextprotocol/client` (both 2.3.1, installed in M2; the client is needed by the protocol tests, and M4 uses it again). The Inspector is run with `npx` and is not installed. `@langchain/mcp-adapters` only if M4's comparison step is done.

---

## 7. The learning path: Phases M1 to M6

Each phase: **topics**, a **practical task**, an **outcome**, how it is **checked**, and a **record** that is filled in when the phase is done.

### Phase M1: The protocol, with no code of ours ✅

Learn what MCP is by watching a ready-made server.

- Host, client and server; the three server features
- JSON-RPC messages: `tools/list`, `tools/call`, and the per-request metadata of this revision
- The two transports, and what "stateless" changes compared with the older handshake
- Reading the MCP Inspector

**Practical task:** run the Inspector against a ready-made server (the reference filesystem server is the candidate; to be confirmed), list its tools, call one, and write down the messages that were sent and received.

**Outcome:** you can draw the message flow for one tool call and name every field in it.

**Checked by:** the written messages in this file's M1 record (no code to test). Facts 1 to 5 and 9 are marked as run.

**Design:** sections 2 and 3, facts 1 to 5, 9.

**Record (done 2026-10-23)**

*What was run.* The reference filesystem server (`@modelcontextprotocol/server-filesystem` 2.0.0) on a temporary folder, from a scratch directory outside the project, through the Inspector 2.12.0 CLI:

```bash
npx @modelcontextprotocol/inspector --cli npx -y @modelcontextprotocol/server-filesystem <folder> --method tools/list --protocol-era legacy -q
npx @modelcontextprotocol/inspector --cli npx -y @modelcontextprotocol/server-filesystem <folder> --method tools/call --tool-name read_text_file --tool-arg path=<folder>/notes.txt --protocol-era legacy -q
```

The Inspector hides the messages, so a small script, `src/mcp/m1-wire-trace.ts` (`npm run mcp:m1-trace`), starts the same server and writes the raw messages itself. This is the message flow of one tool call, as it ran (long lines cut):

```
1. CLIENT -> SERVER  {"jsonrpc":"2.0","id":1,"method":"server/discover","params":{}}
   SERVER -> CLIENT  {"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}      <- this server is older than 2026-07-28

2. CLIENT -> SERVER  {"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"m1-wire-trace","version":"0.0.1"}}}
   SERVER -> CLIENT  {"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"secure-filesystem-server","version":"1.0.0"}},"jsonrpc":"2.0","id":2}

3. CLIENT -> SERVER  {"jsonrpc":"2.0","method":"notifications/initialized"}                                <- no id, no reply

4. CLIENT -> SERVER  {"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}
   SERVER -> CLIENT  {"result":{"tools":[{"name":"read_file","title":"Read File (Deprecated)","description":"…","inputSchema":{…}, …}, … 14 tools]},"jsonrpc":"2.0","id":3}   (13,157 characters)

5. CLIENT -> SERVER  {"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"read_text_file","arguments":{"path":"<folder>/notes.txt"}}}
   SERVER -> CLIENT  {"result":{"content":[{"type":"text","text":"Kafka is a distributed event-streaming platform.\n…"}],"structuredContent":{"content":"…"}},"jsonrpc":"2.0","id":4}

6. CLIENT -> SERVER  {"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"read_text_file","arguments":{"path":"C:/Windows/win.ini"}}}
   SERVER -> CLIENT  {"result":{"content":[{"type":"text","text":"Access denied - path outside allowed directories: …"}],"isError":true},"jsonrpc":"2.0","id":5}
```

*Every field of a tool call.* `jsonrpc` is always `"2.0"`. `id` ties a reply to its request. `method` says what to do (`tools/call`). `params.name` is the tool and `params.arguments` its arguments, checked against the tool's `inputSchema`. The result has `content` (typed blocks the model can read) and `structuredContent` (the same data as JSON); a failure is `isError: true` inside a normal result. Anything that is not a tool failure (an unknown method) is a JSON-RPC `error` with a code.

*Outcome check.* The flow above is drawn from a real server, not from the documentation, and facts 14 to 21 were found by running it.

*What surprised me.*
- **The reference server does not speak the current revision.** The Inspector in `modern` mode refuses it. Our server in M2 will use `serveStdio`, which answers both eras, and our client in M4 must cope with servers of both eras (like this one).
- **Tool failures are not errors.** The server returns a normal result with `isError: true`; the model gets text it can read. This matches how the LangGraph agent already turns failed tools into messages.
- **A server's tool list is big.** 14 tools are about 13 KB, so an allowlist (M5) is also a cost control (M6).
- **Four of the 14 tools can change data** and carry `destructiveHint`. Hints are untrusted, so the approval list in M5 must not rely on them alone.

*Not checked.* The stateless era on the wire (needs a server that supports it: M2). Resources, prompts and HTTP (M3, M6). Claude Code or Claude Desktop as a host (M2).


---

### Phase M2: Build a server (stdio) ✅

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

**Record (done 2026-10-23)**

*What was built.* Files in `src/mcp/`:

| File | What it is |
|---|---|
| `config.ts`, `retrieval.ts`, `prompt.ts` | Copies of the LangGraph versions (collection name and embedding model, search, get one chunk, list documents, the untrusted-result wrapper), so the folder stands alone. `config.ts` loads `.env` from the project root by the file's location, with `quiet: true` |
| `log.ts` | `log(text)` writes to **stderr** |
| `tools/search-documents.ts`, `get-chunk.ts`, `list-documents.ts` | Each exports a description, a zod schema and a plain function (`searchDocuments`, `getChunk`, `listDocuments`). The function takes the real lookup as an optional last argument, so tests can pass a fake. A failure is returned as `isError: true`, never thrown |
| `server.ts` | `createServer()` makes a new `McpServer` and registers the three tools by name, with their description and schema. `serveStdio(createServer, { onerror })` serves it over stdio |

The tools behave like the ones in `src/langgraph/tools/`; the differences are the MCP result format (`content` blocks and `isError`) and that errors are returned instead of thrown.

*How to run it.* `npm run mcp:server` starts it (it waits for a client on stdin). With the Inspector (the `modern` era is the current revision):

```bash
npx @modelcontextprotocol/inspector --cli node node_modules/tsx/dist/cli.mjs src/mcp/server.ts --method tools/list --protocol-era modern -q
npx @modelcontextprotocol/inspector --cli node node_modules/tsx/dist/cli.mjs src/mcp/server.ts --method tools/call --tool-name search_documents --tool-args-json '{"query":"What is Kafka?","topK":1}' --protocol-era modern -q
```

*Host configuration (written, not tried in a real host).* For Claude Desktop, in `%AppData%\Claude\claude_desktop_config.json`; the server is started by `node` running the project's own `tsx`, with absolute paths, so no build step is needed:

```json
{
  "mcpServers": {
    "rag-documents": {
      "command": "node",
      "args": [
        "C:\\Users\\DELL\\Documents\\rag-chatbot\\node_modules\\tsx\\dist\\cli.mjs",
        "C:\\Users\\DELL\\Documents\\rag-chatbot\\src\\mcp\\server.ts"
      ]
    }
  }
}
```

For Claude Code the same command is added with `claude mcp add rag-documents -- node <path to tsx cli.mjs> <path to server.ts>` (the command form is from memory, not run). Docker and Qdrant must be running for the search tools to work.

*What was checked.*

| Check | Result |
|---|---|
| `test:mcp-tools` (14 tests, offline): the folder imports nothing from outside; search returns the passages best first, asks for 4 unless `topK` says otherwise, cuts long passages at 1200 characters, treats "no passages" as a normal result, and returns a failure as `isError`; the same for `get_chunk` (unknown id) and `list_documents`; a passage cannot close the wrapper early | 14 passed |
| `test:mcp-server` (6 tests): the server is started as a subprocess and used through the SDK client: it lists the three tools with descriptions and schemas, a call with a missing argument is an error result, it still answers afterwards, nothing is written to stdout and the log line goes to stderr, and with Qdrant up `list_documents` and `search_documents` followed by `get_chunk` work | 6 passed |
| Inspector, `modern` era: `tools/list`, then `list_documents`, `search_documents`, `get_chunk` with an unknown id, with a non-UUID id and `search_documents` with no query | all as in facts 22 to 25 |
| Inspector, `legacy` era: `tools/list` | the same three tools |
| Server started from the temp folder with absolute paths (as a host does) | worked; `.env` was found |

*What surprised me.*
- **`dotenv` printed to stdout.** The first idea, `import "dotenv/config"` as in the LangGraph folder, would have broken a stdio server. It needed `quiet: true`, and a test now guards it.
- **A schema is written once.** The zod object gives the model's tool definition, the argument check and the TypeScript type of the handler, all from one place.
- **Errors need no special code.** The SDK turns a thrown error or a bad argument into an `isError` result by itself, but a returned `isError` result lets us write a clear message, so the tools catch and return.
- **Plain functions, not tool objects.** Keeping each tool as a plain function with a description and a schema made the server file read like a catalog, and made the tests simple.

*Not checked.* A real host (Claude Code or Claude Desktop) using the server; the config above is untested. The learning script `m1-wire-trace.ts` was left in the folder (it only runs the filesystem server).


---

### Phase M3: Resources and prompts ✅

Learn the other two server features.

- **Resources:** data the host can read (a document section as text), and resource templates
- **Prompts:** a template the user picks (for example "summarise this section")
- Who controls what: the model calls tools, the app reads resources, the user picks prompts

**Practical task:** add one resource per document section and one prompt template to the server, then read the resource and use the prompt from the Inspector and from the host.

**Outcome:** you can say when to use a tool, a resource or a prompt for the same information.

**Checked by:** offline tests for the resource list and read, and for the prompt text; a protocol test that lists resources and prompts.

**Design:** fact 3.

**Record (done 2026-10-23)**

*What was built.*

| File | What it is |
|---|---|
| `resources.ts` | `readDocumentsResource` (the fixed resource `rag://documents`: the list of documents as JSON), `listSectionResources` (the list a host shows: one entry per section of every document) and `readSectionResource` (the text of one section: its passages in document order, separated by an empty line). An unknown section throws |
| `prompts.ts` | `summarize_section`: one argument (`section`), returns the instruction as a text message and then the section text as an attached resource. An unknown section throws |
| `retrieval.ts` | One new function, `getSectionChunks(section)`: a Qdrant scroll with a filter on `section`, sorted by `chunkIndex`. (This copy now differs from the LangGraph one.) |
| `server.ts` | Registers the fixed resource, the template `rag://sections/{section}` and the prompt, next to the three tools |

*Tool, resource, prompt: who uses what.*

| | Tool | Resource | Prompt |
|---|---|---|---|
| Who decides to use it | The **model** (with the user's approval) | The **application** or the user: an item to attach or read | The **user**: picked from a menu |
| Ours | `search_documents`, `get_chunk`, `list_documents` | `rag://documents`, `rag://sections/{section}` | `summarize_section` |
| What it takes | Arguments checked against a schema | An address (a URI) | Arguments checked against a schema |
| What comes back | `content` blocks, or `isError: true` | `contents` with the text | `messages` for the model |
| A failure | A result with `isError: true` (the model can read it) | A protocol error (the host sees it) | A protocol error |

The same information can be offered all three ways: *search for Kafka* is a tool call, *the text of the section Kafka* is a resource, and *summarise the section Kafka* is a prompt that attaches that resource.

*How to see them* (Inspector, `modern` era; add `-q` to hide the status lines):

```bash
npx @modelcontextprotocol/inspector --cli node node_modules/tsx/dist/cli.mjs src/mcp/server.ts --protocol-era modern --method resources/list
npx @modelcontextprotocol/inspector --cli node node_modules/tsx/dist/cli.mjs src/mcp/server.ts --protocol-era modern --method resources/templates/list
npx @modelcontextprotocol/inspector --cli node node_modules/tsx/dist/cli.mjs src/mcp/server.ts --protocol-era modern --method resources/read --uri rag://sections/DBMS
npx @modelcontextprotocol/inspector --cli node node_modules/tsx/dist/cli.mjs src/mcp/server.ts --protocol-era modern --method prompts/list
npx @modelcontextprotocol/inspector --cli node node_modules/tsx/dist/cli.mjs src/mcp/server.ts --protocol-era modern --method prompts/get --prompt-name summarize_section --prompt-args section=n8n
```

*What was checked.*

| Check | Result |
|---|---|
| `test:mcp-resources` (12 tests, offline): the fixed resource returns the document list as JSON with the address asked for; one resource per section, named after the section and file (or the document id); the section text in the given order, joined by an empty line; unknown section is an error; the prompt returns the text message and the attached resource, with the name encoded in the address; the argument must be 1 to 60 characters; the text is passed on unchanged; strange characters in a section name are encoded | 12 passed |
| `test:mcp-server` (13 tests, now with M3): the server declares tools, resources and prompts; the template and the prompt (with its required argument) are listed; a prompt without its argument and a foreign address are refused; with Qdrant up the resource list has the document list and every section, reading `DBMS` returns both of its passages and `Nope` is an error, and the prompt for `n8n` returns two messages | 13 passed |
| `test:mcp-tools` (M2, 14 tests) | still 14 passed |
| Inspector, `modern` era: all five commands above, plus an unknown section, an unknown address, a prompt with an unknown section and a prompt without its argument | as in facts 28 to 32 |
| Inspector, `legacy` era: `prompts/list` | the same prompt |
| Qdrant unreachable (`-e QDRANT_URL=http://localhost:1`): `resources/list` and `resources/read rag://documents` | both fail with `fetch failed` (fact 34) |

*What surprised me.*
- **The template needs a list callback to be useful.** Without `list`, a host can read `rag://sections/Kafka` if it knows the address, but cannot show the user what exists. The SDK makes you write `list: undefined` on purpose, so it is never forgotten.
- **One broken list breaks the whole list.** With Qdrant down, the fixed resource disappears too (fact 34). Tools never did this, because a tool failure is a result. Whether that matters depends on the host.
- **A prompt can carry data.** The summary prompt does not paste the section text into a string: it attaches it as a resource with its address, so the host can show where it came from.
- **Resources are not wrapped as untrusted.** The tools wrap their output with the `<tool_result … untrusted>` tag; a resource is data that the user or the host chose to read, so it is returned as it is (a test fixes this). The text still comes from documents, so a **client** should treat it as untrusted (M5).
- **Names in addresses must be encoded.** A section name with `/`, `?` or `#` would break the address, so `encodeURIComponent` is used and decoded when the template variable is read.

*Not checked.* How a real host presents resources (an attach menu) and prompts (a command menu), and whether it handles the embedded resource in the prompt; completion of the `{section}` variable (the SDK supports it, not used); a resource that changes while the server runs (no change notifications).


---

### Phase M4: Build a client and use MCP tools in an agent ⏭️ *next lesson*

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

1. ~~Which SDK.~~ **Decided in M2: the v2 packages** (`@modelcontextprotocol/server` and `/client`, 2.3.1), as in the current documentation. The old `@modelcontextprotocol/sdk` (1.x) is not used.
2. **Adapter:** write `adapter.ts` by hand first, then try `@langchain/mcp-adapters` and compare. *Proposed. Decided in M4.*
3. ~~Host for the real test in M2.~~ **The Inspector was used.** A real host (Claude Code or Claude Desktop) is still open: the config is written and untested.
4. **Third-party server in M5:** the reference filesystem server on a sample folder. *To be confirmed in M5.* (M1 showed it works in the older era only, which is fine for M5 as long as the client handles both.)
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

- [x] The message flow of one tool call is written down from a real server, with every field explained. *(M1: the Phase M1 record)*
- [x] `src/mcp/` imports nothing from outside itself (enforced by `test:mcp-tools`), and the server writes nothing to stdout (enforced by `test:mcp-server`).
- [x] The three document tools work over stdio: tested offline and through the Inspector in both protocol eras; **a real host was not tried**. *(M2)*
- [x] Resources and a prompt are served and read: tested offline, through the SDK client and through the Inspector. *(M3; a real host was not tried)*
- [ ] An agent answers a question using tools that come from the server, and the hand-written adapter is compared with `@langchain/mcp-adapters`. *(M4)*
- [ ] A third-party server is connected behind an allowlist and an approval rule; hostile, hanging and oversized results are tested. *(M5)*
- [ ] The server also runs over HTTP with a token check, and the cases without a token or with a wrong one are rejected. *(M6)*
- [ ] The evaluation ran with `--mcp` next to `--langgraph`, and the results and what MCP did and did not change are written here. *(M6)*
- [ ] Existing suites still pass (the LangGraph tests and the hand-built agent's tests).
- [ ] Code follows the principles in section 3 throughout.
- [ ] No outbound calls other than OpenAI, Qdrant and the servers chosen in M5.

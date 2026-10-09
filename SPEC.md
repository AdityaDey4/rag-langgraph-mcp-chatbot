# DocuMind RAG — Product & Engineering Specification

> Working name: **DocuMind**. A production-style Retrieval-Augmented Generation (RAG) system that lets users upload documents and hold grounded, cited, multi-turn conversations with them.

| | |
|---|---|
| **Status** | Draft v1.0 |
| **Owner** | Aditya Dey |
| **Stack** | Next.js 16 (App Router) · React 19 · TypeScript · OpenAI · Qdrant · PostgreSQL · Docker |
| **Goal** | A portfolio-grade project that demonstrates retrieval quality, measurable evaluation, and production engineering, not just "call the OpenAI API". |

---

## 1. Purpose and Positioning

Most RAG demos are a single endpoint: embed the question, fetch top-k, stuff into a prompt. They break on follow-ups ("how does *it* work?"), hallucinate when context is missing, give no evidence, and have no way to prove they work.

DocuMind's differentiators, and what the resume should highlight:

1. **Conversational query understanding**: a dedicated LLM stage that rewrites context-dependent follow-ups into standalone search queries *and* separates answer-format instructions ("in one line") from the retrieval query.
2. **Measured retrieval quality**: an evaluation harness (Recall@k, MRR, faithfulness) with before/after numbers for each retrieval improvement.
3. **Hybrid retrieval + reranking**: dense + sparse search fused with RRF, then reranked.
4. **Grounded answers with citations**: every claim links to a source chunk, section and page.
5. **Production engineering**: streaming, persistence, rate limiting, observability, cost tracking, tests, CI, containerised deployment.

### Non-goals

- Not a general-purpose chat product or agent framework.
- No fine-tuning of models.
- No multi-tenant billing or SaaS admin features.
- No OCR/parsing engine of its own; parsing is delegated to LlamaParse.

---

## 2. Current State (baseline)

What exists in the repo today, so the gap to the target is explicit.

| Area | Today | File |
|---|---|---|
| UI | Single-page chat, hard-coded `conversationId = "test-002"`, no streaming, no sources shown | `src/app/page.tsx` |
| Parsing | LlamaParse upload → poll (5 s × 60) → Markdown. Blocks the HTTP request for up to 5 min | `src/app/api/parse/route.ts` |
| Chunking | Split on Markdown headings; one chunk per section; no size limits, no overlap | `src/app/api/chunk/route.ts` |
| Ingestion | Script reads a pasted **n8n output** file, embeds with `text-embedding-3-large`, upserts to Qdrant. Hard-coded `school.pdf` / `document_001` | `src/scripts/embed-and-store.ts`, `src/data/n8n-output.ts` |
| Vector DB | Qdrant via Docker, 3072-d cosine, single collection `rag_documents` | `src/scripts/setup-qdrant.ts`, `docker-compose.yml` |
| Query understanding | `gpt-4o-mini`, JSON mode, rewrites query + extracts `answerInstruction` | `src/lib/query-understanding.ts` |
| Memory | In-process `Map`, lost on restart, unbounded, not shared across instances | `src/lib/conversation-memory.ts` |
| Retrieval | Dense top-3, no filter, no score threshold | `src/app/api/ask/route.ts` |
| Generation | `gpt-4o-mini`, full history + context, non-streaming | `src/app/api/ask/route.ts` |

### Known defects to fix (tracked in the roadmap)

| ID | Defect | Impact |
|---|---|---|
| D1 | Stored "user" history is the *rewritten* `searchQuery`, not what the user typed | The assistant's view of the conversation diverges from reality |
| D2 | Full history (unbounded) is sent to the answer model | Token cost grows per turn; eventual context overflow |
| D3 | System prompt contradicts itself: "casual chat allowed" vs "Answer using only the document context" | Inconsistent behaviour on greetings |
| D4 | Retrieval has no score threshold; top-3 is always injected | Irrelevant chunks for off-topic questions, hallucination risk |
| D5 | `JSON.parse` of model output is unvalidated | Malformed output crashes the request |
| D6 | No input limits, auth or rate limiting on `/api/ask` | Cost-abuse vector |
| D7 | Clients (`OpenAI`, `Qdrant`) and `"rag_documents"` constant duplicated across files | Drift, hard to test |
| D8 | Whole-section chunks can be huge or tiny | Poor embedding quality, wasted tokens |
| D9 | Raw Qdrant points (incl. full text + vectors metadata) returned to the browser | Over-exposure, large payloads |
| D10 | `parse` route uses `any`, polls inside a request | Timeouts on serverless, poor typing |
| D11 | No tests, no CI, no README describing the project | Not presentable |

---

## 3. Users and Use Cases

**Primary persona:** a student/analyst/employee with a PDF (policy, handbook, paper, manual) who wants fast, trustworthy answers.

| # | User story | Acceptance |
|---|---|---|
| U1 | Upload a PDF/DOCX and see when it's ready | Progress states: uploaded → parsing → chunking → embedding → ready / failed |
| U2 | Ask a question and get an answer with sources | Answer streams; each citation shows document, section and page, expandable to the exact passage |
| U3 | Ask follow-ups with pronouns | "What is Kafka?" → "How does it work?" retrieves for *Kafka* |
| U4 | Change format without changing topic | "…in one line" keeps the previous topic, adjusts style only |
| U5 | Get told honestly when the document doesn't say | Returns "not found in the document" rather than inventing |
| U6 | Resume a conversation later | History persists across reloads and restarts |
| U7 | Scope a question to one or more documents | Document picker filters retrieval |
| U8 | Delete a document and all its data | Vectors, chunks and metadata removed |

---

## 4. Functional Requirements

### 4.1 Document ingestion
- **FR-1.** Accept PDF, DOCX, TXT, MD; max 20 MB (configurable); validate MIME **and** magic bytes.
- **FR-2.** Ingestion is **asynchronous**: `POST /api/documents` returns `202` with a `documentId`; status is polled (or streamed) via `GET /api/documents/:id`.
- **FR-3.** Parse via LlamaParse to Markdown (retain page numbers). Fallback for TXT/MD: no parsing.
- **FR-4.** Chunk with a **structure-aware, size-bounded** strategy:
  - Split on headings first, then on paragraphs/sentences to a target of ~500 tokens, max 800, ~80-token overlap.
  - Never split inside a table or code block; tables are kept whole (or split by row groups with the header repeated).
  - Prepend the heading path (`Chapter > Section`) to the embedded text (contextual chunk headers).
  - Each chunk stores: `documentId`, `chunkIndex`, `section`, `headingPath`, `pageNumbers`, `tokenCount`, `text`, `contentHash`.
- **FR-5.** Embed in batches (≤ 100 inputs/request) with retry + exponential backoff; store both dense and sparse (BM25-style) vectors.
- **FR-6.** **Idempotent**: re-uploading identical content (SHA-256) does not duplicate; chunk point IDs are deterministic (`uuidv5(documentId + chunkIndex)`) so re-ingestion upserts.
- **FR-7.** Delete a document → remove its Postgres rows and Qdrant points (filter on `documentId`).

### 4.2 Conversation & query understanding
- **FR-8.** Conversations are persisted; the client holds only a `conversationId` (server-generated UUID).
- **FR-9.** The query-understanding stage outputs, validated with a schema (Zod):
  ```ts
  { searchQuery: string; answerInstruction: string | null; intent: "document_question" | "chitchat" | "off_topic" }
  ```
- **FR-10.** Rules (already prototyped, to be kept and covered by tests):
  - A question with its own explicit subject is **standalone**; history is not injected ("What about TTL?" stays "What about TTL?").
  - A question with unresolved references (it/this/that/they…) is resolved from prior **raw** user messages.
  - A message that only changes format reuses the previous subject as `searchQuery`, and sets `answerInstruction`.
  - `answerInstruction` never leaks into `searchQuery`.
- **FR-11.** `chitchat` intents skip retrieval entirely (saves cost and avoids D3/D4).
- **FR-12.** Invalid/malformed model output → one retry, then fall back to `{ searchQuery: question, answerInstruction: null }`.
- **FR-13.** History sent to the answer model is a **sliding window** (last N turns, token-budgeted) plus an optional rolling summary of older turns.

### 4.3 Retrieval
- **FR-14.** **Hybrid search**: dense (`text-embedding-3-large`) + sparse vectors, fused with Reciprocal Rank Fusion via Qdrant's Query API (`prefetch` + `fusion: rrf`).
- **FR-15.** Retrieve top-20 candidates, **rerank** to top-5 (cross-encoder, e.g. Cohere Rerank or an LLM-as-reranker behind a provider interface).
- **FR-16.** Apply a **relevance threshold**; if nothing passes, the answer path returns the "not found" response without calling the LLM with junk context.
- **FR-17.** Support payload filters (`documentId` in selected set).
- **FR-18.** Optional: multi-query expansion / HyDE behind a feature flag, evaluated against the baseline (keep only if it moves metrics).

### 4.4 Answer generation
- **FR-19.** Streamed response over **Server-Sent Events** with typed events: `sources`, `token`, `done`, `error`.
- **FR-20.** The prompt enforces: answer only from provided sources; cite as `[1]`, `[2]`; say "I couldn't find that in the document" when unsupported; apply `answerInstruction` for style only.
- **FR-21.** Retrieved text is treated as **untrusted data**: delimited in the prompt, with an instruction to ignore directives found inside documents (prompt-injection mitigation).
- **FR-22.** Return sanitized sources only: `{ id, documentId, filename, section, pageNumbers, snippet, score }`. No raw vectors, no full payloads (fixes D9).
- **FR-23.** Per-request usage recorded: embedding tokens, understanding tokens, answer tokens, estimated cost, latency per stage.

### 4.5 Frontend
- **FR-24.** Chat UI with streaming text, Markdown rendering, copy button, stop-generation button, and error/retry states.
- **FR-25.** Inline citation chips; clicking opens a side panel with the source passage, section and page.
- **FR-26.** Document sidebar: upload (drag and drop), per-document ingestion status, delete, select-for-scope.
- **FR-27.** Conversation list (new / rename / delete), persisted.
- **FR-28.** Accessible (keyboard navigation, ARIA live region for streamed output) and responsive down to mobile width.
- **FR-29.** Dev-only **debug panel** showing the rewritten query, answer instruction, retrieved chunks with scores, per-stage latency and token usage. This is a strong demo feature for interviews.

### 4.6 Evaluation (the standout feature)
- **FR-30.** A golden dataset `eval/golden.jsonl` with ≥ 50 questions over a public document: `{ question, expectedChunkIds, referenceAnswer, type }` where `type` ∈ `factual | multi-hop | follow-up | format-instruction | unanswerable`.
- **FR-31.** `npm run eval` reports:
  - **Retrieval:** Recall@k (k=1,3,5), MRR, nDCG@5.
  - **Generation:** faithfulness (answer supported by context) and answer relevance via LLM-as-judge with a fixed rubric; refusal accuracy on `unanswerable`.
  - **Query understanding:** accuracy of standalone vs. resolved rewriting on a labelled follow-up set.
  - **Ops:** p50/p95 latency, mean tokens and cost per question.
- **FR-32.** Results written to `eval/results/<timestamp>.json` and summarised in `docs/EVAL.md` as a table comparing configurations (dense-only → hybrid → hybrid+rerank → +chunking changes).
- **FR-33.** CI runs a small smoke subset and fails on regression beyond a tolerance.

---

## 5. Non-Functional Requirements

| Category | Target |
|---|---|
| **Latency** | Time-to-first-token p50 < 1.5 s, p95 < 3 s (excluding cold start). Non-LLM retrieval stage < 400 ms p95 |
| **Reliability** | Timeouts and bounded retries on every external call; graceful degradation (reranker down → skip rerank; understanding fails → raw question) |
| **Security** | See §9 |
| **Cost** | Per-request cost visible; `gpt-4o-mini` default for understanding; conversation/summary windows cap tokens |
| **Observability** | Structured JSON logs with `requestId`; per-stage timings; token/cost counters; health endpoint |
| **Scalability** | Stateless API instances (state in Postgres + Qdrant); ingestion decoupled from request path |
| **Maintainability** | Strict TypeScript (no `any`), ESLint clean, single config module, dependency-injected clients for testability |
| **Portability** | `docker compose up` brings up the whole system |
| **Privacy** | No document content or API keys in logs; user data deletable |

---

## 6. System Architecture

```
                       ┌─────────────────────────────────────────────┐
                       │                Next.js App                   │
 Browser ── SSE/HTTP ─▶│  UI (React 19)                               │
                       │  Route Handlers: /api/chat, /api/documents   │
                       └───────┬──────────────┬──────────────┬────────┘
                               │              │              │
                     ┌─────────▼──┐   ┌───────▼──────┐  ┌────▼─────────┐
                     │ PostgreSQL │   │    Qdrant    │  │ Ingestion    │
                     │ convs, msgs│   │ dense+sparse │  │ worker (job) │
                     │ docs, jobs │   │ chunk vectors│  └────┬─────────┘
                     │ usage      │   └──────────────┘       │
                     └────────────┘                  LlamaParse · OpenAI
```

### 6.1 Chat request flow (`POST /api/chat`)

```
1. Validate input (Zod), rate-limit, load conversation window from Postgres
2. Query understanding  ── gpt-4o-mini (JSON schema) ──▶ { searchQuery, answerInstruction, intent }
3. If intent = chitchat/off_topic ─────────────────────▶ skip to 7 (no retrieval)
4. Embed searchQuery (dense) + sparse encode
5. Qdrant hybrid query (prefetch dense+sparse, RRF) top-20, filtered by documentId
6. Rerank → top-5 → threshold gate (none pass ⇒ "not found" response)
7. Build prompt: system rules + history window + delimited sources + answerInstruction
8. Stream completion over SSE (sources first, then tokens, then done+usage)
9. Persist raw user message, assistant message, citations, usage
```

### 6.2 Ingestion flow

```
Upload ─▶ validate + hash ─▶ store file ─▶ create Document(status=queued) ─▶ 202
Worker: parsing (LlamaParse) ─▶ chunking ─▶ embedding (batched) ─▶ upsert Qdrant ─▶ status=ready
Any failure ─▶ status=failed + error reason; retry endpoint re-runs from the failed stage
```

The worker can begin as an in-process queue (simple, demoable) behind a `JobQueue` interface, swappable for BullMQ/Redis or Inngest later. Decision recorded in an ADR.

### 6.3 Module layout (target)

```
src/
  app/
    api/
      chat/route.ts               # SSE chat
      conversations/…             # CRUD
      documents/…                 # upload, status, delete
      health/route.ts
    (ui)/…                        # chat page, components
  server/
    config.ts                     # validated env (Zod), single source of truth
    clients/{openai,qdrant,db}.ts # singletons, injectable
    rag/
      understanding.ts            # query understanding + schema
      retrieval.ts                # hybrid search, rerank, threshold
      prompt.ts                   # prompt construction, injection guards
      generate.ts                 # streaming generation
      pipeline.ts                 # orchestrates the chat flow
    ingestion/{parse,chunk,embed,pipeline}.ts
    memory/{store,window,summarise}.ts
    observability/{logger,usage}.ts
  db/schema.ts                    # Drizzle schema + migrations
eval/
  golden.jsonl  run.ts  metrics.ts  judge.ts  results/
docs/
  ARCHITECTURE.md  EVAL.md  adr/
```

---

## 7. Data Model

### 7.1 PostgreSQL

```
documents      id uuid PK, filename, mime, size_bytes, sha256 UNIQUE, status enum
               (queued|parsing|chunking|embedding|ready|failed), error, page_count,
               chunk_count, created_at, updated_at
chunks         id uuid PK (deterministic), document_id FK, chunk_index, section,
               heading_path, page_numbers int[], token_count, text, content_hash
conversations  id uuid PK, title, created_at, updated_at
messages       id uuid PK, conversation_id FK, role enum(user|assistant), content,
               rewritten_query, answer_instruction, created_at
message_sources message_id FK, chunk_id FK, rank, score
usage_events   id, message_id FK, stage enum(understand|embed|rerank|generate),
               model, input_tokens, output_tokens, latency_ms, cost_usd
```
Raw user text and the rewritten query are stored **separately** (fixes D1).

### 7.2 Qdrant (`rag_documents`)

- Named vectors: `dense` (3072, cosine) and `sparse` (BM25-style, IDF modifier).
- Payload: `documentId, chunkId, chunkIndex, section, headingPath, pageNumbers, filename`.
- Payload index on `documentId` (keyword) for filtered search.
- The chunk text is stored in Postgres (source of truth) and fetched by ID, which keeps Qdrant payloads small. Storing text in the payload is an acceptable simplification; choose one and record it in an ADR.

---

## 8. API Contracts

All bodies validated with Zod; errors use a common envelope `{ error: { code, message, requestId } }`.

### `POST /api/chat`  (SSE response)
Request:
```json
{ "conversationId": "uuid | null", "question": "string (1–2000)", "documentIds": ["uuid"] }
```
Events:
```
event: meta     data: { conversationId, messageId }
event: sources  data: [{ id, filename, section, pageNumbers, snippet, score }]
event: token    data: { text }
event: done     data: { usage: { inputTokens, outputTokens, costUsd }, timings: {…} }
event: error    data: { code, message }
```

### Documents
| Method | Path | Result |
|---|---|---|
| POST | `/api/documents` (multipart) | `202 { documentId, status }` |
| GET | `/api/documents` | list with status |
| GET | `/api/documents/:id` | status, progress, counts, error |
| POST | `/api/documents/:id/retry` | re-run from failed stage |
| DELETE | `/api/documents/:id` | removes PG rows + Qdrant points |

### Conversations
`GET /api/conversations`, `GET /api/conversations/:id`, `PATCH` (rename), `DELETE`.

### Ops
`GET /api/health` → `{ postgres, qdrant, openai }` readiness.

---

## 9. Security & Safety

| Threat | Mitigation |
|---|---|
| Prompt injection via documents | Sources delimited and labelled as data; system prompt forbids following embedded instructions; eval set includes injection cases |
| Cost abuse / DoS | Per-IP (and per-session) rate limits, max question length, max upload size, request timeouts |
| Malicious uploads | Extension + MIME + magic-byte validation, size cap, files never executed, stored outside the web root |
| Secret leakage | Env validated at boot; `.env` git-ignored; `.env.example` committed; secrets never logged |
| Data over-exposure | Sanitised source DTOs (D9); no raw vectors to the client |
| SQL/NoSQL injection | Drizzle parameterised queries; Zod-validated inputs |
| Hallucination presented as fact | Threshold gate + citation requirement + refusal behaviour, measured in eval |
| Dependency risk | Lockfile, `npm audit` in CI, Dependabot |

Optional stretch: authentication (Auth.js) with per-user document ownership and row-level filtering on `documentId`.

---

## 10. Testing Strategy

| Level | Scope | Tooling |
|---|---|---|
| Unit | Chunker (headings, overlap, tables), RRF/threshold logic, prompt builder, memory windowing, Zod schemas | Vitest |
| Unit (LLM mocked) | Understanding stage against a fixture table of (history, question) → expected rewrite behaviour | Vitest + recorded fixtures |
| Integration | Ingestion → Qdrant → retrieval, chat pipeline against Qdrant + Postgres in containers | Vitest + Testcontainers / compose |
| API contract | Route handlers: validation errors, SSE event order, rate limit | Vitest + fetch |
| E2E | Upload → ready → ask → cited answer → delete | Playwright |
| Evaluation | Quality metrics (§4.6) | `npm run eval` |

The existing `src/scripts/test-conversation.ts` and `test-qdrant.ts` become proper automated tests.

**Coverage target:** ≥ 80 % on `server/rag` and `server/ingestion`.

---

## 11. DevOps & Delivery

- **Docker:** multi-stage `Dockerfile` for the app; `docker-compose.yml` runs app + Qdrant + Postgres with healthchecks and named volumes.
- **CI (GitHub Actions):** install → lint → typecheck → unit/integration tests → build → eval smoke subset. Status badge in the README.
- **Config:** `.env.example` documenting every variable (`OPENAI_API_KEY`, `LLAMA_CLOUD_API_KEY`, `QDRANT_URL`, `DATABASE_URL`, `RERANK_PROVIDER`, …).
- **Deployment:** a one-click-able target (Vercel for the app + Qdrant Cloud + Neon Postgres), with a live demo link pre-loaded with a public document.
- **Migrations:** Drizzle migrations; `npm run db:migrate`, `npm run setup:qdrant` (idempotent).

---

## 12. Implementation Roadmap

Ordered so the project is demo-able after every phase and each phase yields a resume-worthy increment.

### Phase 0: Hygiene (½ day)
Central `config.ts`, shared clients, remove hard-coded constants, `.env.example`, README skeleton, Vitest + CI set up. Fixes **D7, D11**.

### Phase 1: Correctness of the existing flow (1–2 days)
Zod-validated understanding output + fallback (D5), store raw vs. rewritten messages (D1), sliding-window history (D2), intent routing and a unified prompt (D3), score threshold (D4), sanitised sources (D9), input limits (D6).
**Exit:** all known defects closed; unit tests for the understanding rules.

### Phase 2: Real ingestion (2–3 days)
Upload endpoint, async job pipeline, status tracking, size-bounded structure-aware chunker with overlap and heading paths, deterministic IDs, batched embeddings with retry, delete. Removes the n8n dependency (D8, D10).
**Exit:** upload any PDF from the UI and chat with it.

### Phase 3: Persistence (1–2 days)
Postgres + Drizzle, conversations/messages/documents/usage tables, conversation list UI, server-generated IDs.
**Exit:** restart the server, history survives.

### Phase 4: Retrieval quality (2–3 days)
Build the **eval harness first** and record the dense-only baseline. Then add sparse vectors + RRF, then reranking, then chunking tweaks. Record the metric deltas after each change.
**Exit:** `docs/EVAL.md` with a before/after table. *This is the headline resume artifact.*

### Phase 5: Streaming & citations UX (2 days)
SSE endpoint, streaming UI, Markdown rendering, citation chips and source panel, stop button, debug panel.

### Phase 6: Production polish (2 days)
Rate limiting, structured logging, usage/cost tracking and a small stats view, health endpoint, Dockerfile, compose, E2E test, deployment, demo video/GIF, architecture diagram, ADRs.

### Phase 7: Stretch (pick 1–2)
Auth and multi-user; multi-query/HyDE (kept only if metrics improve); conversation summarisation; Redis-backed cache for repeated queries; Langfuse/OpenTelemetry tracing; semantic cache.

**Estimated total:** ~2 weeks part-time for phases 0–6.

---

## 13. Definition of Done

- [ ] `docker compose up` + `npm run dev` yields a working system from a clean clone in under 10 minutes following the README.
- [ ] Upload → ready → streamed, cited answer works end-to-end in the UI.
- [ ] Follow-up and format-instruction behaviours pass the automated fixture suite.
- [ ] Out-of-scope questions are refused, not hallucinated (refusal accuracy reported).
- [ ] `docs/EVAL.md` shows measured improvements across at least three configurations.
- [ ] CI is green: lint, typecheck, tests, build, eval smoke.
- [ ] No `any`, no secrets in the repo, no hard-coded IDs or filenames.
- [ ] README includes: problem statement, architecture diagram, GIF demo, setup, eval results, design decisions and trade-offs, limitations.
- [ ] Live demo link.

---

## 14. Success Metrics (target numbers to claim only once measured)

| Metric | Baseline (dense top-3) | Target |
|---|---|---|
| Recall@5 | measured in Phase 4 | ≥ +15 pts over baseline |
| MRR | measured | ≥ +0.10 |
| Faithfulness (LLM-judge) | measured | ≥ 0.90 |
| Refusal accuracy on unanswerable | measured | ≥ 0.90 |
| Follow-up rewrite accuracy | measured | ≥ 0.90 |
| TTFT p95 | n/a (non-streaming) | < 3 s |

> Do not put numbers on the resume that the eval harness has not produced.

---

## 15. Resume Framing (draft; fill in real numbers after Phase 4)

**DocuMind: Production RAG system** · Next.js, TypeScript, OpenAI, Qdrant, PostgreSQL, Docker

- Built an end-to-end RAG platform with async document ingestion (LlamaParse → structure-aware chunking → batched embeddings) into Qdrant, supporting multi-document, multi-turn Q&A with streamed, cited answers.
- Designed an LLM query-understanding stage that resolves conversational follow-ups and separates answer-format instructions from retrieval queries, validated with a labelled test set (**X %** rewrite accuracy).
- Improved retrieval **Recall@5 from X → Y** and MRR from X → Y by adding hybrid (dense + sparse) search with RRF fusion and cross-encoder reranking, measured with a custom evaluation harness (Recall@k, MRR, LLM-judged faithfulness).
- Reduced hallucinations via relevance-threshold gating, citation-enforced prompts and prompt-injection defences (**X %** refusal accuracy on unanswerable questions).
- Engineered for production: SSE streaming (p95 TTFT **X s**), Postgres-backed conversation memory, rate limiting, per-stage latency/cost tracking, Dockerised stack and CI with lint, tests and eval regression checks.

---

## 16. Open Decisions (record each as an ADR)

1. **Job queue:** in-process vs. BullMQ/Redis vs. Inngest.
2. **Reranker:** Cohere Rerank vs. LLM-as-reranker vs. self-hosted cross-encoder.
3. **Sparse encoder:** Qdrant built-in BM25 vs. SPLADE.
4. **Chunk text storage:** Qdrant payload vs. Postgres lookup.
5. **ORM:** Drizzle vs. Prisma.
6. **Auth:** include in v1 or defer.
7. **Eval document:** which public PDF to use for the golden set (prefer one with tables and multi-section structure).

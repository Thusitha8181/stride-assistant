# Stride Customer Assistant (POC)

An AI customer-service agent for **Stride Footwear**, a fictional shoe brand. It answers questions about the company, products, stock, orders and returns. It is built to fail gracefully across 16 defined failure types and never discloses personal information.

The full spec is in [docs/PRD.md](docs/PRD.md).

**Stack:**
- Backend: TypeScript, Node, Express
- Agent: LangChain.js, with models hosted on Groq
- Retrieval: Qdrant
- Tracing and evals: LangSmith
- Frontend: Next.js

All data is fake.

## Status

| Milestone | Scope | State |
|---|---|---|
| 1 | Monorepo, fake data, Qdrant ingest, tools + tests, CI | ✅ |
| 2 | Model factory, LangChain agent on Groq, streaming chat API, tracing | ✅ |
| 3 | Eval harness: datasets, deterministic evaluators, record/replay, gates (LangSmith sync pending) | ✅ |
| 4 | Guards, privacy layer, resilience (F1–F16) | ⏳ |
| 5 | Next.js chat UI | ⏳ |
| 6 | LLM-as-judge, live experiments, demo | ⏳ |

## Quick start

```bash
cp .env.example .env     # then set GROQ_API_KEY (free at https://console.groq.com/keys)
npm install
docker compose up -d     # Qdrant on :6333
npm run ingest           # embeds the KB + catalog into Qdrant (downloads a ~25 MB local model once)
npm run dev              # API on http://localhost:4000 (prints a health summary)
npm run chat             # in a second terminal: chat with the agent in your terminal
```

The terminal chat shows each tool call, the cards the UI will render, and citations. Type `/new` to start a fresh session.

To trace every turn in LangSmith, set `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY` in `.env`. The `run` id printed after each reply is the trace's run id.

To ingest with no model download, use the deterministic offline embeddings:

```bash
EMBEDDINGS_PROVIDER=hash npm run ingest
```

## Layout

```
apps/server        Chat API (Express + SSE), LangChain agent, domain services, tools, retrieval (Qdrant), ingest
apps/web           Next.js app (chat UI arrives in Milestone 5)
packages/shared    zod contracts shared by server, web and the model (tool I/O, order view)
data/              Fake data: products.json (generated), orders.json, company/*.md (knowledge base)
docs/PRD.md        Product requirements
```

## Chat API (Milestone 2)

`POST /api/chat` takes `{ "message": "...", "sessionId"?: "<uuid>" }` and streams Server-Sent Events. Each `data:` line is one JSON event from the shared contract (`packages/shared/src/chat.ts`):

| Event | Meaning |
|---|---|
| `session` | Always first. Reuse its `sessionId` on later turns to keep conversation memory. |
| `text-delta` | Streamed answer text. Policy citations appear inline as `[[chunk-id]]`. |
| `tool-start` / `tool-end` | Tool calls, with the failure `code` when a tool fails (or `INVALID_ARGUMENTS` for malformed calls, F3). |
| `card` | Products, stock, order, return eligibility or return created, built from tool results. |
| `citation` | Sources the answer cited. Only real knowledge-base chunks are included. |
| `error` | `MODEL_UNAVAILABLE`, `AGENT_LIMIT` or `INTERNAL`, plus a friendly message and `retryable`. |
| `done` | Always last, with the LangSmith `runId`. |

```bash
curl -N localhost:4000/api/chat -H 'Content-Type: application/json' \
  -d '{"message":"Where is order O-1042? My email is jane@example.com"}'
```

`GET /api/health` reports Qdrant, model and tracing status.

**How the agent works:**
- It is built with LangChain's `createAgent`, with per-session memory.
- The model comes from `initChatModel`. Switching provider means changing `LLM_PROVIDER`/`LLM_MODEL` and installing that provider's package.
- Each turn allows at most 5 tool rounds. A runaway model is stopped *before* a 6th round of tools runs.

## Agent evals (Milestone 3)

Unit tests check the code. Evals check the **agent's behavior**: did it pick the right tool with the right arguments, retrieve the right knowledge, stay grounded, protect privacy, and answer helpfully?

```bash
npm run eval:mock      # replay recorded conversations: deterministic, offline, no API key (runs in CI)
npm run eval           # live against the configured model (Groq); paces itself under rate limits
npm run eval:record    # live, and re-record the cassettes eval:mock replays
npm run eval -- --dataset happy-path --case order- --repeats 3 --model openai/gpt-oss-20b
```

- **Datasets** live in `apps/server/evals/cases/*.yaml`:
  - `happy-path`: 26 single-turn cases
  - `multi-turn`: 5 conversations that rely on memory
  - `retrieval`: 18 knowledge-base queries, scored without an LLM

  Each chat turn declares what must happen (tools, arguments, cards, citations, retrieved chunks, content) and what must not happen.
- **Evaluators** are deterministic:
  - tool use and arguments
  - cards
  - expected citations, and invented `[[citation]]` markers
  - retrieval
  - content
  - **grounding**: every price and ID in an answer must come from a tool result
  - **privacy**: no fixture PII in the answer *or in anything sent to the model*, other than what the customer typed
  - unexpected errors
- **Record/replay:** a live run records the model's responses as cassettes (`evals/cassettes/`). `eval:mock` replays them through the real agent, tools and evaluators, so CI catches any code change that breaks a previously good conversation. It also flags drift, where the agent makes more or fewer model calls than were recorded.
- **Gates (PRD §9.3):**
  - task success ≥ 90%
  - tool accuracy ≥ 95%
  - retrieval hit@3 ≥ 90%
  - hallucination ≤ 2%
  - citation validity ≥ 95%
  - privacy violations = 0

  The runner exits non-zero if any gate fails.
- **Reports:** each run writes Markdown and JSON reports, with full transcripts for failing cases, to `evals/reports/`. `--update-baseline` stores pass/fail per case, and later runs report regressions against it.
- Evals use in-memory retrieval with the same embedding model and cosine ranking as Qdrant, and a fixed date, so recordings replay identically without Docker.

## Tools (Milestone 1)

| Tool | What it does |
|---|---|
| `searchKnowledgeBase` | Retrieves policy and FAQ chunks from Qdrant, with stable citation ids (`returns-policy#final-sale-items`) |
| `searchProducts` | Semantic product search with category, price and size filters, annotated with live stock |
| `checkStock` | Checks one variant. When it's sold out, it suggests nearby sizes, other widths or colors, and similar products (F8) |
| `getOrderStatus` | Checks order ID + email inside the tool, then returns a strict order view with no personal information |
| `checkReturnEligibility` | Applies the return rules (30-day window, final sale, worn, not delivered, already returned) with a policy citation (F7) |
| `createReturn` | Creates a mock RMA. An exchange into an out-of-stock size becomes a refund, per policy |

Privacy is enforced in code, not only in the prompt:
- Raw orders, with their fake names, addresses, phones and cards, never leave `OrderService`.
- `OrderView` is a strict zod schema, so adding a personal-info field fails.
- Typo suggestions for order IDs only cover orders under the same email.

## Testing

```bash
npm run lint
npm run typecheck
npm run test:unit          # shared + server (coverage gate ≥ 80%) + web
npm run test:integration   # real Qdrant via Testcontainers (needs Docker); live Groq smoke tests run if GROQ_API_KEY is set
TEST_LOCAL_EMBEDDINGS=1 npm run test:integration   # plus semantic retrieval with the real model
```

- Tests are tagged with the failure codes they cover (`@F5`, `@F7`, `@F16`, …), so the PRD's coverage matrix can be checked automatically.
- A pre-commit hook (husky) runs lint-staged, typecheck and the unit tests.
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, build and integration tests.

## Data

- `data/products.json` is generated by `npm run data:generate`. It uses seeded inventory plus explicit overrides the demo relies on, e.g. Trail Runner X is sold out in 10 wide.
- Order dates are stored relative to today ("delivered 45 days ago"), so return-window demos never go stale.

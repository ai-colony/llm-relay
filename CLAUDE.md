# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Dev server with auto-reload and pretty-printed logs
npm run dev-raw      # Dev server with auto-reload, raw logs
npm run build        # Production build via tsup → /dist (ESM)
npm start            # Run production build (requires npm run build first)
npm run typecheck    # TypeScript type checking only (no emit)
npm run lint:check   # ESLint check
npm run lint:fix     # ESLint auto-fix
npm run format:check # Prettier check
npm run format:fix   # Prettier auto-fix
npm run fix          # format:fix + lint:fix + format:fix
npm run all          # fix + typecheck + build + test (full pipeline)

# Docker (requires .env.docker in the project root):
npm run docker:build # Build image tagged llm-relay:<version>
npm run docker:run   # Run container with --network=host and llm-relay-data volume
npm run docker:it    # Interactive shell in a fresh container

# Database schema changes (Drizzle):
npm run drizzle:push     # Push schema changes directly to the DB (dev)
npm run drizzle:generate # Generate migration files
npm run drizzle:migrate  # Apply generated migrations
```

Tests use **Vitest**: `npm test` (single run), `npm run test:watch`, `npm run test:coverage`.

- `test/unit/` — unit tests with mocked dependencies (e.g. `service.test.ts` mocks `@lib` and `repo`)
- `test/api/` — route-handler tests; each file mounts a single Hono handler and mocks the service/repository layer (no DB, no OpenAI)
- `test/helpers/testDatabase.ts` — in-memory SQLite setup for integration-style tests; mirrors all four production indexes using raw SQL (not Drizzle migrations), so **schema changes also require manual updates here**

Run a single test file: `npx vitest run test/unit/service.test.ts`

Coverage thresholds (enforced): 60% lines / functions / branches / statements.

**Runtime requirement**: Node.js 24 or 26 (ESM, top-level `await`).

## Architecture

`llm-relay` is an HTTP relay server for LLM requests. Clients POST prompts; the server queues them in SQLite, executes them against an OpenAI-compatible API (Llama), and optionally POSTs results back to a callback URL.

### Layers

**HTTP layer** — `src/hono/`  
Hono-based REST API with Zod validation. Routes: `GET /health`, `GET /status`, `GET /metrics`, `GET /openapi.json`, `GET /docs` (Swagger UI), `POST /prompt/add`, `GET /prompt/get`, `GET /prompt/list`, `DELETE /prompt/purge`, `DELETE /prompt/cancel`, `POST /chat/completions`.

Auth middleware (`src/hono/auth.ts`) is applied to `/prompt/*` and `/chat/*` — health, status, metrics, and OpenAPI endpoints are always public. When `API_KEY` is empty the middleware is a no-op.

Prompt-specific routes each live in their own file under `src/hono/prompt/` and are mounted by `src/hono/prompt/index.ts`. The shared `clientName + requestId` query schema is in `src/hono/prompt/schemas.ts` (used by both `get.ts` and `cancel.ts`). Chat routes live under `src/hono/chat/`. New prompt routes go under `src/hono/prompt/`; non-prompt routes go directly under `src/hono/`.

- `GET /health` checks both the SQLite database and the upstream OpenAI endpoint; returns `503` (not just a non-`ok` flag) if either fails.
- `DELETE /prompt/cancel` **deletes** the record rather than marking it cancelled; it only succeeds for `queued`, `failed`, and `failed_retry` statuses — returns `409` if `in_progress` or already `completed`.
- `DELETE /prompt/purge` bulk-deletes `completed` and `failed` records older than `days` days (default 7); accepts optional `clientName` to scope the purge.
- `GET /prompt/list` caps results at 500 records.
- `POST /chat/completions` proxies a chat conversation directly to the upstream LLM and streams the response as SSE (`text/event-stream`). Each event is `data: <JSON chunk>`, ending with `data: [DONE]`. This path bypasses the queue entirely — use it for interactive, low-latency chat.
- `GET /metrics` combines the hand-rolled `llm_relay_*` prompt-queue gauges with `renderMetrics()` from `src/lib/metrics.ts`: `http_requests_total`/`http_request_duration_seconds` (recorded by the `httpMetrics` middleware in `src/hono/httpMetrics.ts`, mounted in `src/hono/index.ts`), `openai_requests_total`/`openai_request_duration_seconds` (worker path), `openai_chat_requests_total`/`openai_chat_request_duration_seconds` (`/chat/completions`), and `callback_deliveries_total`.

**Business logic** — `src/prompt/` (aliased as `@prompt`)

- `src/prompt/service.ts` — worker loop functions called by the `setImmediate` loop in `src/index.ts`; picks up to `config.worker.concurrency` queued prompts per tick, marks them all `in_progress`, then executes them concurrently via `Promise.all`. Also handles callback delivery.
- `src/prompt/repo.ts` — all Drizzle database operations for the prompt lifecycle. `countQueuedPrompts()` provides a lightweight queued count (used by `POST /prompt/add`); `getPromptStatusCounts()` aggregates all status counts in a single query (used by `GET /status` and startup logging).

**Shared library** — `src/lib/` (aliased as `@lib`)  
`src/lib/index.ts` is the barrel; it re-exports `config`, `logger`, `executeOpenAIPrompt`, `isCallbackUrlAllowed`, `checkCallbackAvailability`, `incCounter`, `observeHistogram`, and `renderMetrics`. Add new lib exports there when creating new modules.

- `src/lib/openAI.ts` — OpenAI SDK streaming integration; lazy-resolves the model name once on first use; tracks reasoning vs response tokens separately and calculates tokens-per-second metrics. The "Sending prompt" log includes a `sizes` field with character counts for system and user prompts. Exports `executeOpenAIPrompt` (used by the worker) and `streamChatCompletion` (used by `POST /chat/completions`); only the former is re-exported from the `@lib` barrel.
- `src/lib/config.ts` — environment variables parsed with `env-var`; see `.env.example` for all options (`PORT`, `LOG_LEVEL`, `DATABASE_FILENAME`, `OPENAI_URL/MODEL/KEY/TIMEOUT`, `OPENAI_MAX_RETRY_COUNT`, `WORKER_CONCURRENCY`, `CALLBACK_URL_ALLOWLIST`, `CALLBACK_RETRY_TTL_HOURS`, `CALLBACK_HMAC_SECRET`).
- `src/lib/logger.ts` — Pino logger; use structured fields, not string interpolation. Every log call includes a `component` field (`'server'`, `'http'`, `'worker'`, `'callback'`, `'openai'`) to identify the source layer.
- `src/lib/callbackUrl.ts` — `isCallbackUrlAllowed(url)` checks a URL against the `CALLBACK_URL_ALLOWLIST` regex (always passes when the env var is unset); `checkCallbackAvailability(url)` sends a `GET` probe (5 s timeout) and returns a boolean.
- `src/lib/metrics.ts` — in-process Prometheus-text-format registry (no external dependency): `incCounter(name, help, labels, value?)` and `observeHistogram(name, help, labels, valueSeconds, buckets?)` record into module-level `Map`s keyed by metric name + sorted-serialized labels; `renderMetrics()` emits standard `# HELP`/`# TYPE` exposition text; `resetMetrics()` clears the registry (test-only, not re-exported from the barrel). Histogram buckets default to `DEFAULT_DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30]` seconds.

**Data layer** — `src/db/` (aliased as `@db`)  
SQLite via Drizzle ORM (`drizzle-orm/node-sqlite`) using the Node.js built-in `node:sqlite` module. Schema is defined in `src/db/schema.ts`. Schema changes are **not** auto-applied — run `npm run drizzle:push` (dev) or generate+migrate (prod) after editing the schema. The `prompts` table enforces a unique index on `(clientName, requestId)` — duplicate pairs are rejected at the DB layer.

### Key patterns

- **Worker loop**: `src/index.ts` uses `setImmediate` + a 100 ms `setTimeout` between iterations to call `processQueuedPrompts` then `processCallbackPendingPrompts`. Each tick fetches up to `WORKER_CONCURRENCY` queued prompts (lowest `priority` first, FIFO on ties), marks them all `in_progress`, then processes them concurrently. Up to 50 callbacks are delivered per tick (FIFO).
- **Prompt state machine**: `queued` → `in_progress` → `completed | failed | failed_retry`. `failed_retry` is re-picked by the worker after an exponential backoff delay (`2^retryCount * 1s`, capped at 60 s) stored in `nextRetryAt`. After `OPENAI_MAX_RETRY_COUNT` transient failures the prompt moves to `failed` with `statusError: "max_retries_exceeded"`. `failed` is terminal (also used for non-transient errors on first failure).
- **Async callback**: Each prompt can carry a `callbackUrl`; the relay POSTs the result there after completion. `callbackCompleted` tracks delivery separately from prompt completion. At enqueue time `POST /prompt/add` validates the URL against `CALLBACK_URL_ALLOWLIST` (regex, SSRF guard) then probes it with a `GET` request — returns `503` if unreachable. Failed deliveries are retried indefinitely per tick until the prompt's `completedAt` age exceeds `CALLBACK_RETRY_TTL_HOURS` (default 24). When `CALLBACK_HMAC_SECRET` is set, each POST carries `X-LLM-Relay-Signature: hmac-sha256=<hex>` over the body.
- **Streaming metrics**: `openAI.ts` detects the phase boundary between `reasoning_content` and `content` chunks to record separate timings and token rates. A `component: 'openai'` info log is emitted on completion with the full timing breakdown.
- **Logging convention**: all log calls include a `component` field. `info`-level covers lifecycle events (prompt completed, callback sent, model resolved). `debug`-level adds per-request HTTP logs and prompt pick-up events — enable with `LOG_LEVEL=debug`.
- **Model resolution**: `resolveModel()` in `openAI.ts` queries the upstream API and caches the result for `OPENAI_MODEL_CACHE_TTL_SECONDS` (default 60s), after which the next call re-queries — this lets `/status` and the model name used for requests self-heal after the backend restarts with a different model, without restarting the relay. It selects by `OPENAI_MODEL` env var or falls back to the first available model.
- **Operational metrics**: `src/hono/httpMetrics.ts` times HTTP requests (`http_requests_total`/`http_request_duration_seconds`), skipping a hardcoded `EXCLUDED_PATHS` set (`/health`, `/status`, `/metrics`, `/openapi.json`, `/docs`, `/favicon.ico`) so monitoring/introspection traffic doesn't dilute the business-endpoint signal; `executePrompt` in `service.ts` times the worker's `executeOpenAIPrompt` call (`openai_requests_total`/`openai_request_duration_seconds`); `completions.ts` times the `/chat/completions` SSE stream (`openai_chat_requests_total`/`openai_chat_request_duration_seconds`); `processCallbackPendingPrompts` records `callback_deliveries_total{result}` and checks `response.ok` before treating a callback POST as delivered. All labels use `result="success"|"failure"` except the HTTP counter, which uses `method`/`path`/`status`.

## Branching

- `feat/<name>` — new features
- `fix/<name>` — bug fixes
- `chore/<name>` — maintenance, deps, tooling

PRs target `main`. One logical change per PR. Run `npm run all` before opening a PR.

## Security concerns

When touching these areas, keep these attack surfaces in mind:

- **`callbackUrl`** — SSRF risk; restrict allowed targets with `CALLBACK_URL_ALLOWLIST` (regex).
- **`API_KEY` / `OPENAI_KEY`** — must never appear in logs, responses, or errors.
- **`callbackUrl` / `DATABASE_FILENAME`** — path traversal / unintended file exposure.
- **Auth middleware** — Bearer token check applies to `/prompt/*` and `/chat/*`; confirm new routes are mounted correctly.

## Tooling notes

- **Prettier**: single quotes, 120-char line width, no trailing commas.
- **ESLint**: flat config (`eslint.config.mjs`) with TypeScript, Unicorn, and Simple Import Sort plugins.
- **Build**: tsup (configured via `tsup.config.ts`) targets Node 24, fully bundles all dependencies into a single ESM file at `dist/index.js` — no `node_modules` needed at runtime.
- **Path aliases**: `@lib` → `src/lib/`, `@db` → `src/db/`, `@prompt` → `src/prompt/` (defined in `tsconfig.json` and resolved by `tsx`/`tsup`). Use the alias when importing from a different folder; use relative imports (`./sibling`) within the same folder.

## Deployment

On startup, `src/index.ts` auto-applies Drizzle migrations from `./drizzle/` — production deployments must ship that folder alongside `/dist`. It also calls `resetInProgressPrompts()` to recover any prompts stuck as `in_progress` from a previous unclean shutdown.

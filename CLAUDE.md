# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Dev server with auto-reload and pretty-printed logs
npm run dev-raw      # Dev server with auto-reload, raw logs
npm run run          # Single run via tsx, no watch
npm run build        # Production build via tsup → /dist (ESM)
npm start            # Run production build (requires npm run build first)
npm run typecheck    # TypeScript type checking (src + test, no emit) via tsconfig.test.json
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

npm run npm:reinstall # Wipe node_modules + package-lock.json and reinstall from scratch

# Database schema changes (Drizzle):
npm run drizzle:push     # Push schema changes directly to the DB (dev)
npm run drizzle:generate # Generate migration files
npm run drizzle:migrate  # Apply generated migrations
```

Tests use **Vitest**: `npm test` (single run), `npm run test:watch`, `npm run test:coverage`.

- `test/unit/` — unit tests with mocked dependencies (e.g. `service.test.ts` mocks `@lib` and `repo`). `database.test.ts` is the one exception: it mocks only `config.database.filename` (to `:memory:`) and runs `src/db/index.ts` for real, since every other suite mocks `@db` away entirely and something has to exercise the real `checkDatabase`/`closeDatabase` implementation.
- `test/api/` — route-handler tests; each file mounts a single Hono handler and mocks the service/repository layer (no DB, no OpenAI). `app.test.ts` is the exception: it mounts the full assembled `app` from `src/hono/index.ts` (mocking every transitively-imported module up front) to test cross-cutting concerns a single-route test can't — which prefixes the auth middleware actually guards, the global `onError` handler, and 404s.
- `test/helpers/testDatabase.ts` — in-memory SQLite setup for integration-style tests; runs the real Drizzle migrations from `./drizzle`, so schema changes propagate automatically and cannot drift. `clearDatabase()` enumerates tables by hand — **a new table must be added there** or its rows leak between tests
- Tests that mock the whole `@lib` barrel must pull the _pure_ helpers back in with `vi.importActual('../../src/lib/jobs')` (and `.../vectors`). Stubbing them turns the retry-backoff, transient-error and encoding assertions vacuous. Where a test also needs to mutate `config`, mock `../../src/lib/config` with the same object the barrel mock returns — otherwise the real `jobs` module reads a different config than the test is setting
- `test/helpers/mocks.ts` — `makeLoggerMock`, `makeStatusCounts`, `postJson`, `withQuery`, `readJson`; `test/helpers/environment.ts` — `withEnvironment(vars, fn)` for env-dependent config tests

Run a single test file: `npx vitest run test/unit/service.test.ts`

Test files are typechecked. `tsconfig.json` covers `src` only (that is what tsup and the editor use); `tsconfig.test.json` extends it to `src + test` and is what `npm run typecheck` runs. It adds `vitest/globals` types and the `ES2025.Iterator` / `ESNext.Array` libs, so tests may use `Array.fromAsync` and iterator helpers that `src` — pinned to the ES2024 baseline — may not. Use `readJson(response)` rather than `await response.json()`, which is typed `unknown`.

Coverage thresholds (enforced): 60% lines / functions / branches / statements.

**Runtime requirement**: Node.js 24 (ESM, top-level `await`).

## Architecture

`llm-relay` is an HTTP relay server for LLM requests. Clients POST prompts; the server queues them in SQLite, executes them against an OpenAI-compatible API (Llama), and optionally POSTs results back to a callback URL. An **optional second backend** (`EMBEDDING_URL`) adds the same queue for embeddings; when it is unset the feature is entirely absent and everything else behaves exactly as before.

### Layers

**HTTP layer** — `src/hono/`  
Hono-based REST API with Zod validation. Routes: `GET /health`, `GET /status`, `GET /metrics`, `GET /openapi.json`, `GET /docs` (Swagger UI), `POST /prompt/add`, `GET /prompt/get`, `GET /prompt/list`, `DELETE /prompt/purge`, `DELETE /prompt/cancel`, `POST /chat/completions`, `POST /embedding/add`, `POST /embedding/run`, `GET /embedding/get`, `GET /embedding/list`, `DELETE /embedding/cancel`, `DELETE /embedding/purge`.

Auth middleware (`src/hono/auth.ts`) is applied to `/prompt/*`, `/chat/*` and `/embedding/*` — health, status, metrics, and OpenAPI endpoints are always public. When `API_KEY` is empty the middleware is a no-op.

Prompt-specific routes each live in their own file under `src/hono/prompt/` and are mounted by `src/hono/prompt/index.ts`. All prompt request schemas live in `src/hono/prompt/schemas.ts` — `PromptKeyQuerySchema` (`clientName + requestId`, used by `get.ts` and `cancel.ts`), `ListQuerySchema`, `PurgeQuerySchema`, and `AddPromptBodySchema`. They are kept there rather than in the route files so `openapi.ts` can generate the spec from them without importing the repo layer. Chat routes live under `src/hono/chat/`; embedding routes under `src/hono/embedding/`, same file-per-route shape and same schemas-in-one-file rule. New prompt routes go under `src/hono/prompt/`; non-prompt routes go directly under `src/hono/`.

- `GET /health` checks the SQLite database and the generative upstream; returns `503` (not just a non-`ok` flag) if either fails. The `checks.embedding` entry is present — and counts toward the verdict — only when `config.embedding` is set, so an unconfigured relay reports exactly what it did before embedding support existed.
- `DELETE /prompt/cancel` **deletes** the record rather than marking it cancelled; it only succeeds for `queued`, `failed`, and `failed_retry` statuses — returns `409` if `in_progress` or already `completed`.
- `DELETE /prompt/purge` bulk-deletes `completed` and `failed` records older than `days` days (default 7); accepts optional `clientName` to scope the purge.
- `GET /prompt/list` caps results at 500 records.
- `POST /prompt/add` detects duplicate `(clientName, requestId)` pairs by catching the SQLite unique-constraint error rather than pre-querying for existence, then returns a `409`. Use `isUniqueConstraintError(error)` from `@db` — Drizzle wraps driver failures in a `DrizzleQueryError` and puts the `node:sqlite` error (carrying `code`/`errcode`) on `cause`, so checking the caught error's own fields silently never matches. The `callbackUrl` HEAD probe runs _after_ the overwrite check so a request destined for a `409` does not pay the probe timeout.
- `GET /openapi.json` is generated: `components.schemas` for request bodies and query parameters comes from `z.toJSONSchema(...)` over the real Zod schemas, so the spec cannot drift from what the routes validate. Only response envelopes and `securitySchemes` are hand-written. `test/api/openapi.test.ts` asserts every mounted route is documented, that `security`/`401` appear on exactly the auth-guarded routes, and that every `$ref` resolves.
- Error responses go through `jsonError(c, status, message, extra?)` in `src/hono/errors.ts` — do not hand-write `c.json({ success: false, ... })` in new routes.
- `POST /chat/completions` proxies a chat conversation directly to the upstream LLM and streams the response as SSE (`text/event-stream`). Each event is `data: <JSON chunk>`, ending with `data: [DONE]`. This path bypasses the queue entirely — use it for interactive, low-latency chat.
- `GET /metrics` sets the `llm_relay_*` queue gauges via `setGauge` and renders everything — gauges, counters, histograms — through the single `renderMetrics()` in `src/lib/metrics.ts`: `http_requests_total`/`http_request_duration_seconds` (recorded by the `httpMetrics` middleware in `src/hono/httpMetrics.ts`, mounted in `src/hono/index.ts`), `generative_requests_total`/`generative_request_duration_seconds` (worker path), `generative_chat_requests_total`/`generative_chat_request_duration_seconds` (`/chat/completions`), `embedding_requests_total`/`embedding_request_duration_seconds` (embedding worker), `embedding_run_requests_total`/`embedding_run_request_duration_seconds` (`/embedding/run`), and `callback_deliveries_total`. The `llm_relay_prompts_*` and `llm_relay_embeddings_*` metrics are gauges, not counters — they are point-in-time DB counts and decrease on purge. The `llm_relay_embeddings_*` and `llm_relay_embedding_callbacks_pending` gauges are emitted only when an embedding backend is configured.

**Embedding routes** — `src/hono/embedding/`

- `src/hono/embedding/index.ts` mounts a `.use('*', …)` guard ahead of every route that returns `503 'Embedding backend is not configured'` when `config.embedding` is undefined. It runs **before** request validation, so an unconfigured relay answers 503 rather than 400 on a malformed body.
- `POST /embedding/add` mirrors `POST /prompt/add` exactly, including the two orderings that matter: the overwrite check runs **before** the `callbackUrl` HEAD probe, and duplicates are detected by catching the insert error and testing it with `isUniqueConstraintError`.
- `POST /embedding/run` is the synchronous sibling — it bypasses the queue and returns the vectors inline. Deliberately relay-native in shape rather than OpenAI-compatible: no OpenAI-shaped paths or payloads are exposed under `/embedding`.
- `input` accepts `string | string[]`; the union is left untransformed in the Zod schema so `z.toJSONSchema` documents both shapes, and `toInputArray()` normalises at the route boundary.
- `encodingFormat` (`float` | `base64`, default `float`) is stored on the row and used for callback delivery; `GET /embedding/get` accepts it as an optional query parameter that overrides the stored value on the way out.

**Embedding business logic** — `src/embedding/` (aliased as `@embedding`)

- `src/embedding/repo.ts` — direct parallel of `prompt/repo.ts`, same projection discipline: `findQueuedEmbeddings` and `findEmbeddingsByClientName` must **never** select the `vectors` blob.
- `src/embedding/service.ts` — `processQueuedEmbeddings` claims up to `WORKER_CONCURRENCY` rows but runs them through a **`for…of await` loop, not `Promise.all`**: embedding backends typically run with `--parallel 1`, so overlapping requests would only queue inside the backend where the relay cannot see or time them. Both exported functions no-op immediately when `config.embedding` is undefined.

**Business logic** — `src/prompt/` (aliased as `@prompt`)

- `src/prompt/service.ts` — worker loop functions called by the tick loop in `src/index.ts`; picks up to `config.worker.concurrency` queued prompts per tick, marks them all `in_progress`, then executes them concurrently via `Promise.all`. Also handles callback delivery, up to `CALLBACK_CONCURRENCY` (10) deliveries in flight at a time.
- `src/prompt/repo.ts` — all Drizzle database operations for the prompt lifecycle. `countQueuedPrompts()` provides a lightweight queued count (used by `POST /prompt/add`); `getPromptStatusCounts()` aggregates all status counts in a single query (used by `GET /status` and startup logging). Finders return a single row (not a one-element array) and project only the columns their callers use — `findPromptStatusByKey` for status-only checks, `findPromptByClientNameAndRequestId` for the full row. Deletes go through `deletePromptByKey(clientName, requestId, statuses)` with the exported `CANCELLABLE_STATUSES` / `OVERWRITABLE_STATUSES` lists.

**Shared library** — `src/lib/` (aliased as `@lib`)  
`src/lib/index.ts` is the barrel; it re-exports `config`, `logger`, `checkGenerative`, `executeGenerativePrompt`, `streamChatCompletion`, `getGenerativeModelInfo`, `checkEmbedding`, `executeEmbedding`, `getEmbeddingModelInfo`, `isEmbeddingEnabled`, the `vectors` helpers, the `jobs` helpers, `isCallbackUrlAllowed`, `checkCallbackAvailability`, `incCounter`, `setGauge`, `observeHistogram`, `recordUpstreamMetrics`, `renderMetrics`, and the chat schema types. Add new lib exports there when creating new modules, and import through `@lib` rather than reaching past it.

- `src/lib/modelInfo.ts` — `createModelResolver(component, getConfig)` returns one independently TTL-cached `{ getModelInfo, check }` pair per upstream. Config is read through a **thunk**, not captured, so tests that reassign the mocked config still take effect. Both `generative.ts` and `embedding.ts` are built on it.
- `src/lib/generative.ts` — OpenAI SDK streaming integration for the chat backend (renamed from `openAI.ts` in 2.0.0); tracks reasoning vs response tokens separately and calculates tokens-per-second metrics. The "Sending prompt" log includes a `sizes` field with character counts for system and user prompts. Exports `checkGenerative` (used by `GET /health`), `getGenerativeModelInfo` (used by `GET /status`), `executeGenerativePrompt` (used by the worker), and `streamChatCompletion` (used by `POST /chat/completions`). Request/message schemas live in `src/lib/chatSchemas.ts` and are re-exported by `src/hono/chat/schemas.ts`, so `@lib` never depends on the HTTP layer.
- `src/lib/embedding.ts` — the embedding backend's counterpart. The `OpenAI` client is built **lazily**: `config.embedding` is absent whenever the feature is off, and constructing it at import time would make the module unloadable for a relay running a generative backend alone. `executeEmbedding` requests `encoding_format: 'base64'` (saves the upstream serialising ~2500 floats per vector as JSON) and normalises whichever shape comes back.
- `src/lib/vectors.ts` — float32 pack/unpack/encode. `asFloat32` copies when a Buffer's `byteOffset` is not 4-byte aligned, which pooled Buffers coming back from SQLite can be — a `Float32Array` view would otherwise throw. `normaliseUpstreamEmbedding` absorbs the fact that `encoding_format: "base64"` support varies by llama.cpp build.
- `src/lib/jobs.ts` — queue machinery shared by both workers: `computeNextRetryAt`, `isTransientError`, `buildCallbackHeaders` (HMAC), `deliverJobCallback`. Marking a row delivered stays with the caller, since only it knows which table to touch. **A future third queue (rerank) needs no refactor here** — that is why these live in `@lib` rather than in `prompt/service.ts`.
- `src/lib/config.ts` — environment variables parsed with `env-var`; see `.env.example` for all options (`PORT`, `LOG_LEVEL`, `DATABASE_FILENAME`, `GENERATIVE_URL/MODEL/KEY`, `EMBEDDING_URL/MODEL/KEY`, `GENERATIVE_CONTEXTSIZE`/`EMBEDDING_CONTEXTSIZE`, `UPSTREAM_TIMEOUT`, `UPSTREAM_MAX_RETRY_COUNT`, `UPSTREAM_MODEL_CACHE_TTL_SECONDS`, `WORKER_CONCURRENCY`, `CALLBACK_URL_ALLOWLIST`, `CALLBACK_RETRY_TTL_HOURS`, `CALLBACK_HMAC_SECRET`). `config.embedding` is `EmbeddingConfig | undefined`, and **that union is what every "is embedding enabled" guard keys off**. Note `asUrlString()` throws on an empty value, hence the raw `.asString()` presence check before it. `GENERATIVE_CONTEXTSIZE`/`EMBEDDING_CONTEXTSIZE` are optional manual fallbacks (`UpstreamConfig.contextSize` in `modelInfo.ts`) consulted only when an upstream's `/models` response has no `meta.n_ctx` of its own (e.g. hosted providers like Scaleway) — the live value always wins.
- `src/lib/logger.ts` — Pino logger; use structured fields, not string interpolation. Every log call includes a `component` field (`'server'`, `'http'`, `'worker'`, `'callback'`, `'generative'`, `'embedding'`, `'chat'`) to identify the source layer.
- `src/lib/callbackUrl.ts` — `isCallbackUrlAllowed(url)` checks a URL against the `CALLBACK_URL_ALLOWLIST` regex (always passes when the env var is unset); `checkCallbackAvailability(url)` sends a `HEAD` probe (5 s timeout) and returns a boolean.
- `src/lib/metrics.ts` — in-process Prometheus-text-format registry (no external dependency): `incCounter(name, help, labels, value?)`, `setGauge(name, help, value, labels?)`, and `observeHistogram(name, help, labels, valueSeconds, buckets?)` record into module-level `Map`s keyed by metric name + sorted-serialized labels; `renderMetrics()` emits standard `# HELP`/`# TYPE` exposition text; `resetMetrics()` clears the registry (test-only, not re-exported from the barrel). `recordUpstreamMetrics(spec, result, startedAtMs)` records the counter+histogram pair around an upstream call and is shared by the worker and `/chat/completions`. Histogram buckets default to `[0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30]` seconds and are fixed by the first observation for a given metric name.

**Data layer** — `src/db/` (aliased as `@db`)  
SQLite via Drizzle ORM (`drizzle-orm/node-sqlite`) using the Node.js built-in `node:sqlite` module. Schema is defined in `src/db/schema.ts`, which is also the single source of truth for both enums — `JOB_STATUSES` (aliased as `PROMPT_STATUSES` / `EMBEDDING_STATUSES`) and `ENCODING_FORMATS` back the types, the Drizzle columns, the Zod enums in the `schemas.ts` files, and the OpenAPI enums. **Keep value imports out of `schema.ts`'s dependency graph** — drizzle-kit loads it with its own bundler, so `src/lib/vectors.ts` imports `EncodingFormat` from `@db/schema` as a _type-only_ import rather than the other way round. The client is reached as `database.client` / `database.schema`. Schema changes are **not** auto-applied — run `npm run drizzle:push` (dev) or generate+migrate (prod) after editing the schema. Both `prompts` and `embeddings` enforce a unique index on `(clientName, requestId)`; being separate tables, the two queues never share a key namespace.

`embeddings.vectors` is a single contiguous little-endian **float32 blob** of `inputCount × dimensions` values. Float32 is not a lossy shortcut: embedding backends emit float32 and pgvector's `vector` type is float32, so a JSON array would have stored only padding at ~5× the size (10 KB vs ~50 KB per 2560-dim vector).

**drizzle-orm and drizzle-kit must be pinned to the same exact version.** They are on `1.0.0-rc.4` — the coordinated release under the `rc` dist-tag, not one of the `1.0.0-rc.4-<commit>` per-branch snapshots. A caret range does _not_ hold them together: with a prerelease in the range it matches every `1.0.0-*` prerelease, so each package drifts to its own highest branch build and `drizzle:generate` dies with `TypeError: drizzle_orm_sqlite_core.SQLiteSyncDialect is not a constructor`. Nothing catches this at install time — drizzle-kit imports drizzle-orm from `node_modules` but declares no `peerDependencies` on it.

### Key patterns

- **Worker loop**: `src/index.ts` schedules each tick with a 100 ms `setTimeout` and runs four functions concurrently via `Promise.all` — `processQueuedPrompts`, `processCallbackPendingPrompts`, `processQueuedEmbeddings`, `processCallbackPendingEmbeddings`. They touch disjoint tables, so a slow callback batch or embedding run must not delay picking up queued prompts. Each tick fetches up to `WORKER_CONCURRENCY` queued rows per queue (lowest `priority` first, FIFO on ties) and marks them all `in_progress`; **prompts are then processed concurrently, embeddings serially**. Up to 50 callbacks are delivered per tick per queue (FIFO), at most 10 in flight.
- **Job state machine** (shared by both tables): `queued` → `in_progress` → `completed | failed | failed_retry`. `failed_retry` is re-picked by the worker after an exponential backoff delay (`2^retryCount * 1s`, capped at 60 s) stored in `nextRetryAt`. After `UPSTREAM_MAX_RETRY_COUNT` transient failures the job moves to `failed` with `statusError: "max_retries_exceeded"`. `failed` is terminal, and is also where non-transient errors land on first failure — only network-shaped errors are transient, so an upstream rejecting the request itself (e.g. llama.cpp's `400 request (N tokens) exceeds the available context size` for an embedding input over `--ctx-size`, or a `500 Compute error.` from a GPU OOM) fails immediately rather than burning the retry budget.
- **Async callback**: Each job can carry a `callbackUrl`; the relay POSTs the result there after completion. `callbackCompleted` tracks delivery separately from job completion. At enqueue time the `add` routes validate the URL against `CALLBACK_URL_ALLOWLIST` (regex, SSRF guard) then probe it with a `HEAD` request — returns `503` if unreachable. Failed deliveries are retried indefinitely per tick until the job's `completedAt` age exceeds `CALLBACK_RETRY_TTL_HOURS` (default 24). When `CALLBACK_HMAC_SECRET` is set, each POST carries `X-LLM-Relay-Signature: hmac-sha256=<hex>` over the body. The embedding callback body is `{ clientName, requestId, model, dimensions, encodingFormat, embedding }`, encoded in the format the job was queued with.
- **Streaming metrics**: `generative.ts` detects the phase boundary between `reasoning_content` and `content` chunks to record separate timings and token rates. A `component: 'generative'` info log is emitted on completion with the full timing breakdown.
- **Logging convention**: all log calls include a `component` field. `info`-level covers lifecycle events (job completed, callback sent, model resolved). `debug`-level adds per-request HTTP logs and job pick-up events — enable with `LOG_LEVEL=debug`.
- **Model resolution**: `createModelResolver` in `modelInfo.ts` queries the upstream API and caches the promise for `UPSTREAM_MODEL_CACHE_TTL_SECONDS` (default 60s), after which the next call re-queries — one independent cache per upstream. The cache timestamp is stamped at promise _creation_, not on resolution, so concurrent callers racing the first lookup share one in-flight request instead of each firing their own — this lets `/status` and the model name used for requests self-heal after the backend restarts with a different model, without restarting the relay. It selects by `GENERATIVE_MODEL` / `EMBEDDING_MODEL` or falls back to the first available model, and `path.basename` strips the directory from llama.cpp's file-path model ids.
- **Operational metrics**: `src/hono/httpMetrics.ts` times HTTP requests (`http_requests_total`/`http_request_duration_seconds`), skipping a hardcoded `EXCLUDED_PATHS` set (`/health`, `/status`, `/metrics`, `/openapi.json`, `/docs`, `/favicon.ico`) so monitoring/introspection traffic doesn't dilute the business-endpoint signal; `executePrompt` in `prompt/service.ts` times the worker's `executeGenerativePrompt` call (`generative_requests_total`/…); `completions.ts` times the `/chat/completions` SSE stream (`generative_chat_requests_total`/…); `runEmbedding` in `embedding/service.ts` and `embedding/run.ts` time their upstream calls (`embedding_requests_total`/…, `embedding_run_requests_total`/…); both `processCallbackPending*` functions record `callback_deliveries_total{result}` through `deliverJobCallback`, which checks `response.ok` before treating a POST as delivered. `UpstreamMetricsSpec` constants are declared at each call site, not in `metrics.ts`. All labels use `result="success"|"failure"` except the HTTP counter, which uses `method`/`path`/`status`. `recordUpstreamMetrics` expects `performance.now()`, not `Date.now()`.

## Branching

- `feat/<name>` — new features
- `fix/<name>` — bug fixes
- `chore/<name>` — maintenance, deps, tooling

PRs target `main`. One logical change per PR. Run `npm run all` before opening a PR.

CI (`.github/workflows/ci-dev.yaml`) runs format, lint, typecheck, build, and `test:coverage` on every push to a non-`main` branch — those check runs attach to the commit, so they surface on the PR too. `ci-publish-docker.yaml` reuses the same job via `workflow_call` before building, so nothing ships to ghcr.io without passing it.

There is deliberately no `pull_request` trigger: it would double every run (branch commit + merge commit). The trade-off is that fork PRs and the merged-into-`main` result are not tested before merge.

## Security concerns

When touching these areas, keep these attack surfaces in mind:

- **`callbackUrl`** — SSRF risk; restrict allowed targets with `CALLBACK_URL_ALLOWLIST` (regex).
- **`API_KEY` / `GENERATIVE_KEY` / `EMBEDDING_KEY`** — must never appear in logs, responses, or errors.
- **`callbackUrl` / `DATABASE_FILENAME`** — path traversal / unintended file exposure.
- **Auth middleware** — Bearer token check applies to `/prompt/*`, `/chat/*` and `/embedding/*`; confirm new routes are mounted correctly. `test/api/openapi.test.ts` hardcodes those prefixes in its `isGuarded` predicate — a new guarded prefix must be added there too.

## Tooling notes

- **Prettier**: single quotes, 120-char line width, no trailing commas.
- **ESLint**: flat config (`eslint.config.mjs`) with TypeScript, Unicorn, and Simple Import Sort plugins. `src` gets an extra type-aware block (`projectService: true`) with `no-floating-promises`, `await-thenable`, `no-unnecessary-condition`, and `switch-exhaustiveness-check`; `test` relaxes `no-shadow`, `no-explicit-any`, `unicorn/no-null`, and `prevent-abbreviations`. `await-thenable` means an `await` on a synchronous call is an error — `migrate()` and `checkDatabase()` are both sync.
- **Build**: tsup (configured via `tsup.config.ts`) targets Node 24, fully bundles all dependencies into a single ESM file at `dist/index.js` — no `node_modules` needed at runtime.
- **Path aliases**: `@lib` → `src/lib/`, `@db` → `src/db/`, `@prompt` → `src/prompt/`, `@embedding` → `src/embedding/` (defined in `tsconfig.json` and resolved by `tsx`/`tsup`). Use the alias when importing from a different folder; use relative imports (`./sibling`) within the same folder. Vitest cannot read them from tsconfig — its native `resolve.tsconfigPaths` is a boolean and honours the base config's `exclude: ["test"]` — so `vitest.config.ts` mirrors the map by hand. **Adding an alias means editing both files.**
- **Dev server**: `tsx watch` (not nodemon — there is no nodemon config and tsx has watch built in).

## Deployment

On startup, `src/index.ts` auto-applies Drizzle migrations from `./drizzle/` — production deployments must ship that folder alongside `/dist`. It also calls `resetInProgressPrompts()` to recover any prompts stuck as `in_progress` from a previous unclean shutdown.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Docker images were published with no checks**: `ci-publish-docker.yaml` built, pushed to ghcr.io, and cut a GitHub release without running lint, typecheck, or tests — `ci-dev.yaml` ignored `main` entirely. The publish workflow is now split into `detect` → `checks` → `build`, where `checks` reuses `ci-dev.yaml` via `workflow_call`, so a release cannot ship without passing the same gate contributors run locally.
- **Coverage thresholds were never enforced**: the 60% thresholds in `vitest.config.ts` (and the claim in the README/CONTRIBUTING) had no effect because CI ran `npm run test`, not `test:coverage`. CI now runs `test:coverage`.
- **Test files were never typechecked**: `tsconfig.json` excludes `test/`, so all 22 test files were invisible to `tsc`. A new `tsconfig.test.json` covers `src + test` and `npm run typecheck` now uses it; the ~20 genuine type errors this surfaced are fixed.
- **`format:fix` masked Prettier failures**: the script piped through `grep | sed`, so the pipeline's exit code came from `sed` and a Prettier crash reported success — including inside `npm run all`. Replaced with Prettier's native `--write --list-different`, which still prints the files it rewrote but propagates the real exit code.
- **Docker `HEALTHCHECK` hardcoded port 3000** while `PORT` is configurable, leaving any container started on another port permanently unhealthy. It now resolves `${PORT:-3000}` at runtime.

### Changed

- Dev server runs on `tsx watch` instead of nodemon; `nodemon` dropped from devDependencies (there was no nodemon config — tsx has watch built in).
- ESLint now enforces `@typescript-eslint/await-thenable` on `src`, which surfaced two `await`s on non-promises: the startup `migrate()` call and `checkDatabase()` in `GET /health` are both synchronous, so awaiting them only added a microtask hop. `GET /health` no longer wraps the two checks in a `Promise.all` that could never overlap.
- `drizzle.config.ts` declares `out: './drizzle'` explicitly instead of relying on the default, since the Dockerfile and the startup migration both depend on that exact path.
- Dockerfile runner stage uses `apk upgrade --no-cache` so the apk index is not baked into the image layer.

### Removed

- `vite-tsconfig-paths` devDependency — it was installed but never imported. (Vite's native `resolve.tsconfigPaths` cannot replace the alias map here: it is a boolean and honours the base tsconfig's `exclude: ["test"]`, which would strip aliases from test files.)
- Dead and duplicated config: stale `**/bin` and `**/demo` eslint ignores, four unicorn rule overrides repeated verbatim in both the `src` and `test` blocks, and inert `tsconfig.json` emit options (`declaration`, `outDir`, `sourceMap`, and friends) on a tsup-built, `--noEmit` project.
- Vestigial `main` field in `package.json` (a private app with no `files`/`exports`).

### Security

- `.gitignore` now ignores `.env*` with a `!.env.example` exception, matching the pattern the Prettier, Docker, and ESLint ignore lists already used. Previously only `.env` and `.env.docker` were listed by name, so a future `.env.production` would have been committed.

## [1.9.0] - 2026-07-25

### Fixed

- **`POST /prompt/add` returned `500` instead of `409` for duplicates**: Drizzle wraps driver failures in a `DrizzleQueryError` and puts the `node:sqlite` error on `cause`, so the unique-constraint check — which inspected the caught error directly — never matched. Re-submitting an existing `(clientName, requestId)` now returns the documented `409`. Detection moved into `isUniqueConstraintError` in `src/db/errors.ts`, which walks the cause chain.
- **Model-resolution stampede**: the cache timestamp was stamped only after the upstream `GET /models` call resolved, so while the first request was in flight every concurrent caller considered the cache stale and fired its own request. It is now stamped at promise creation, so racing callers share one lookup.
- **Callback delivery no longer blocks the worker**: pending callbacks were POSTed strictly one at a time, so a tick of 50 callbacks at the 10 s timeout could stall the whole worker loop for minutes. Deliveries now run concurrently, capped at 10 in flight.
- **Startup race**: the HTTP port opened before `resetInProgressPrompts()` ran, so `GET /prompt/get` could briefly report a stale `in_progress` for a prompt left over from an unclean shutdown. The reset now completes before the server accepts traffic.
- **Queued prompts and callbacks no longer serialize**: the two worker passes are independent and now run concurrently.
- **Histogram bucket mismatch**: observing the same metric name with a different bucket array produced bucket counts that did not line up with the rendered boundaries. The first observation now fixes the boundaries for that metric.
- **`DELETE /prompt/purge`**: `?clientName=` (empty string) was accepted and scoped the purge to a client named `""`; it is now rejected with a `400`.

### Changed

- **BREAKING — `GET /status`**: the `pending` field is renamed to `inProgress`. It counts `in_progress` prompts and collided confusingly with the unrelated `callbackPending` in the same object.
- **BREAKING — `GET /metrics`**: `llm_relay_prompts_pending` is renamed to `llm_relay_prompts_in_progress`. `llm_relay_prompts_completed_total` and `llm_relay_prompts_failed_total` are renamed to `llm_relay_prompts_completed` / `llm_relay_prompts_failed` and retyped from `counter` to `gauge` — they are point-in-time database counts that decrease on `DELETE /prompt/purge`, so the `_total` suffix and counter type were misleading for `rate()` queries.
- **`callbackUrl` reachability probe is stricter**: the `HEAD` probe on `POST /prompt/add` previously treated _any_ response as success, so an endpoint answering `404` or `500` was accepted. It now passes only on a 2xx, or on `405`/`501` (host reachable but `HEAD` not implemented). Callback URLs whose host returns an error status to `HEAD` will now be rejected with `503`.
- The probe also runs _after_ the duplicate/overwrite checks, so a request destined for a `409` no longer pays the probe timeout.
- **OpenAPI document is now generated** from the Zod schemas the routes validate with (`z.toJSONSchema`), so request schemas cannot drift from what is enforced. Newly documented: `securitySchemes` plus `security` on the auth-guarded routes, the `400` responses from request validation, `401`, `500`, the `503` from `POST /prompt/add`, and the `/openapi.json` and `/docs` routes themselves.
- Single sources of truth: the prompt-status enum is defined once in `src/db/schema.ts`; error responses go through one `jsonError` helper; the prompt-queue gauges and the request counters/histograms now share one Prometheus registry instead of two exposition-format implementations.
- Repository finders return a single row instead of a one-element array and project only the columns their callers use, removing full-row `SELECT *` reads from the worker, callback, and status-check paths.
- Test database helper runs the real Drizzle migrations instead of hand-written DDL, which had already drifted from production (`idx_prompts_callback` column order).
- Dependency updates (`hono`, `openai`, `eslint`).

## [1.8.1] - 2026-07-22

### Fixed

- **`clientName` schema in `GET /prompt/list`**: now enforces `clientName` as a non-empty string, consistent with `/prompt/add`, `/prompt/get`, and `/prompt/cancel`.
- **OpenAPI schema**: documented the `path` and `method` fields present on unhandled-error responses.

### Changed

- **Dropped Node.js 26 support**: engine requirement narrowed from `24 || 26` to `24` to match tested runtimes.
- Dependency updates (`hono`, `openai`, `@hono/node-server`, `@hono/zod-validator`, dev tooling).

## [1.8.0] - 2026-07-05

### Added

- **HTTP/OpenAI/callback metrics**: `GET /metrics` now also exposes `http_requests_total`/`http_request_duration_seconds` (business endpoints only — `/health`, `/status`, `/metrics`, `/openapi.json`, `/docs`, and `/favicon.ico` are excluded to keep monitoring/introspection traffic out of the signal), `openai_requests_total`/`openai_request_duration_seconds` (prompt worker), `openai_chat_requests_total`/`openai_chat_request_duration_seconds` (`/chat/completions`), and `callback_deliveries_total` — labeled counters and histograms in the same Prometheus text format as the existing `llm_relay_*` gauges, backed by a new dependency-free registry in `src/lib/metrics.ts`. ([#43](https://github.com/ai-colony/llm-relay/issues/43))

### Fixed

- **Callback delivery treated non-2xx responses as success**: `processCallbackPendingPrompts` never checked `response.ok` after POSTing to `callbackUrl`, so a 4xx/5xx from the receiver was logged and counted as a successful delivery. It now throws (and retries like any other failure) when the callback endpoint returns a non-2xx status.
- **Stale model name after upstream restart**: the resolved model name and context size (used by `GET /status` and every chat/prompt request) were cached for the lifetime of the process, so restarting llama.cpp with a different model left `llm-relay` reporting the old one until it was itself restarted. The cache now expires after `OPENAI_MODEL_CACHE_TTL_SECONDS` (default `60`), so it self-heals automatically. ([#52](https://github.com/ai-colony/llm-relay/issues/52))

## [1.7.0] - 2026-06-30

### Added

- **`model` and `contextSize` in `GET /status`**: the status response now includes the resolved model name and its context-window size, fetched from the upstream API alongside queue counts. Both fields are `null` when the upstream is unreachable at status time.
- **Config validation enforcement**: environment variables are now validated at startup with explicit runtime errors for out-of-range values (e.g. `WORKER_CONCURRENCY` above `16`, negative `OPENAI_TIMEOUT`).

### Fixed

- **Graceful shutdown**: on `SIGTERM`/`SIGINT` the server now waits up to 15 s for the current worker tick to complete before closing, then calls `closeDatabase()` to flush WAL and release the SQLite file handle cleanly.
- **Callback availability probe uses `HEAD`**: `checkCallbackAvailability` now sends a `HEAD` request instead of `GET`, reducing unintended side effects on callback receivers during the pre-submission probe.
- **Unique-constraint error detection**: `POST /prompt/add` now identifies duplicate-key violations by SQLite error code (`ERR_SQLITE_ERROR` / `SQLITE_CONSTRAINT_UNIQUE`) instead of string-matching the error message — more reliable across Node.js versions.
- **`clientName` schema in query routes**: `GET /prompt/get` and `DELETE /prompt/cancel` now enforce `clientName` as a non-empty string, consistent with the add endpoint.
- **OpenAPI schema**: missing fields and components corrected in the generated spec.
- **Migration startup path**: startup migration now handles edge cases that could cause the server to fail on first launch with an empty database.
- **HTTP error logging**: the Hono error handler now logs unhandled errors at `error` level instead of silently swallowing them.

### Changed

- Dependency updates (`openai`, `drizzle-orm`, `drizzle-kit`, dev tooling).

## [1.6.0] - 2026-06-25

### Added

- **`POST /chat/completions`**: new streaming chat endpoint that proxies a multi-turn conversation directly to the upstream LLM and streams the response as SSE (`text/event-stream`). Each event is `data: <JSON chunk>`, ending with `data: [DONE]`. Supports `messages`, `tools`, and `temperature`. Bypasses the queue entirely — designed for interactive, low-latency use cases. Auth middleware applies (`/chat/*`).
- **Tool-call support in chat**: request body accepts an optional `tools` array (OpenAI function-calling format) forwarded verbatim to the upstream model.
- **Temperature control**: `temperature` (0–2, optional) accepted in `POST /chat/completions` and forwarded to the upstream API.

### Fixed

- **Abort signal on chat**: cancellation is now correctly propagated to the upstream SSE stream when the client disconnects mid-response.

### Changed

- Dependency updates (`hono`, `zod`, `drizzle-orm`, dev tooling).

## [1.5.0] - 2026-06-12

### Added

- **Configurable concurrency**: new `WORKER_CONCURRENCY` environment variable (default `1`, max `16`). When set above `1`, the worker picks that many queued prompts per tick and processes them in parallel with `Promise.all`. Useful when the upstream LLM supports concurrent requests (e.g. cloud APIs or multi-GPU setups).
- **Callback URL allowlist** (`CALLBACK_URL_ALLOWLIST`): optional regex environment variable. When set, any `callbackUrl` submitted to `POST /prompt/add` must match the pattern or the request is rejected with `400`. Prevents SSRF against internal hosts.
- **Callback availability check**: before accepting a prompt with a `callbackUrl`, the relay sends a `GET` probe to that URL (5 s timeout). If the probe fails, `POST /prompt/add` returns `503` with `{ "success": false, "error": "callbackUrl is not available" }`. Catches misconfigured endpoints at submission time.
- **Callback retry TTL** (`CALLBACK_RETRY_TTL_HOURS`, default `24`): callbacks that have been pending for longer than this many hours are skipped on the next delivery attempt. Prevents stale callbacks from accumulating indefinitely.
- **Callback HMAC signing** (`CALLBACK_HMAC_SECRET`): when set, each callback POST includes an `X-LLM-Relay-Signature: hmac-sha256=<hex>` header computed with `HMAC-SHA256` over the request body. Lets receivers verify that the request originated from this relay.

### Changed

- **`requestId` type**: changed from `integer` to `string` across the full stack (DB schema, Zod validation, OpenAPI spec, repository, and callback payload). Clients that previously passed numeric IDs must now pass them as strings.

## [1.4.0] - 2026-06-11

### Changed

- **SQLite driver**: replaced `better-sqlite3` (native module) with the Node.js built-in `node:sqlite`. Eliminates native compilation on install; requires Node.js 24+.
- **Build**: tsup configuration moved to `tsup.config.ts`; output is now a fully self-contained ESM bundle — no `node_modules` needed alongside `dist/` at runtime.

### Removed

- **`infra/` directory**: systemd unit, launchd plist, and helper shell scripts removed.
- **`docker-compose.yml`**: removed from the repository.

## [1.3.1] - 2026-06-10

### Fixed

- **OpenAPI schema**: added missing `/prompt/purge` endpoint, `priority` field in `AddPromptRequest` and `PromptListItem`, and `PurgeResponse` component schema. The `priority` field is now also returned by `GET /prompt/list`.

## [1.3.0] - 2026-06-10

### Added

- **API key authentication**: all endpoints are now optionally protected by a Bearer token. Set `API_KEY` in the environment; when set, every request must include `Authorization: Bearer <key>`. Requests without or with the wrong key receive `401`. When `API_KEY` is empty the middleware is bypassed (no breaking change for open deployments).
- **Prometheus metrics**: new `GET /metrics` endpoint returns prompt queue gauges (`llm_relay_prompts_queued`, `llm_relay_prompts_pending`, `llm_relay_prompts_completed_total`, `llm_relay_prompts_failed_total`, `llm_relay_callbacks_pending`) and `llm_relay_uptime_seconds` in the standard text exposition format.
- **Purge endpoint**: `DELETE /prompt/purge?days=7&clientName=` bulk-deletes `completed` and `failed` prompts older than the given number of days. `clientName` is optional; omitting it purges across all clients. Returns `{ "success": true, "deleted": <count> }`.
- **Max retry limit**: transient errors are now retried at most `OPENAI_MAX_RETRY_COUNT` times (default `10`). After the limit is reached the prompt transitions to `failed` with `statusError: "max_retries_exceeded"` instead of retrying indefinitely.
- **Priority queue**: `POST /prompt/add` now accepts an optional `priority` integer (default `0`). Lower values are processed first; ties are broken by creation time (FIFO). Enables interactive requests to skip ahead of background batch jobs without a separate queue.

### Fixed

- **`GET /prompt/get` 404 response**: documented the `{ "success": false, "error": "Prompt not found" }` response shape that was already returned but missing from the README.

### Changed

- Bumped `hono` to `4.12.25`, `@typescript-eslint/*` to `8.61.0`, `eslint-plugin-unicorn` to `65.0.1`, `prettier` to `3.8.4`.

## [1.2.1] - 2026-06-08

### Fixed

- **`isTransientError` depth guard**: recursive error-cause traversal now stops after 5 levels, preventing a potential stack overflow on deeply nested error chains.
- **Callback index column order**: `idx_prompts_callback` now leads with `status` instead of `callbackCompleted`, improving query selectivity for the callback worker query.
- **`checkOpenAI` error handling**: refactored to avoid a variable-scoping issue that could mask non-`ok` HTTP responses when the fetch itself succeeded.

### Changed

- Node.js engine requirement narrowed from `>=22` to `24 || 26` to match tested runtimes.
- OCI image labels (`description`, `source`, `licenses`) added to the Dockerfile.

## [1.2.0] - 2026-06-07

### Added

- **Docker support**: multi-stage `Dockerfile` (Node 24 Alpine), `docker-compose.yml`, and three npm scripts (`docker:build`, `docker:run`, `docker:it`). The SQLite database is stored at `/app/data/database.sqlite` inside the container and persisted via a named volume (`llm-relay-data`).
- **GitHub Container Registry publishing**: CI workflow automatically builds and pushes a versioned image to `ghcr.io` whenever `package.json` version changes on `main`.
- **OpenAPI / Swagger UI**: `GET /openapi.json` serves the OpenAPI 3.1 schema; `GET /docs` serves an interactive Swagger UI.
- **Prompt size logging**: the `openai` component now logs a `sizes` object (`{ system, user }` character counts) alongside the truncated prompt preview in the "Sending prompt" log entry.

## [1.1.0] - 2026-05-23

### Added

- `POST /prompt/add` accepts an optional `overwrite` boolean. When `true`, an existing prompt with the same `clientName + requestId` is deleted and replaced, provided its status is `queued`, `completed`, `failed`, or `failed_retry`. Returns `409` if the prompt is currently `in_progress`.

## [1.0.0] - 2026-05-23

### Added

- Initial release.

[Unreleased]: https://github.com/ai-colony/llm-relay/compare/v1.9.0...HEAD
[1.9.0]: https://github.com/ai-colony/llm-relay/compare/v1.8.1...v1.9.0
[1.8.1]: https://github.com/ai-colony/llm-relay/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/ai-colony/llm-relay/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/ai-colony/llm-relay/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/ai-colony/llm-relay/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/ai-colony/llm-relay/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/ai-colony/llm-relay/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/ai-colony/llm-relay/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/ai-colony/llm-relay/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/ai-colony/llm-relay/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/ai-colony/llm-relay/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/ai-colony/llm-relay/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/ai-colony/llm-relay/releases/tag/v1.0.0

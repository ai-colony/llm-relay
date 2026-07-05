# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

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

[Unreleased]: https://github.com/ai-colony/llm-relay/compare/v1.7.0...HEAD
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

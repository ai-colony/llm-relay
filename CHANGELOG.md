# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[Unreleased]: https://github.com/ai-colony/llm-relay/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/ai-colony/llm-relay/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/ai-colony/llm-relay/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/ai-colony/llm-relay/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/ai-colony/llm-relay/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/ai-colony/llm-relay/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/ai-colony/llm-relay/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/ai-colony/llm-relay/releases/tag/v1.0.0

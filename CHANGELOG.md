# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[Unreleased]: https://github.com/BCsabaEngine/llm-relay/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/BCsabaEngine/llm-relay/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/BCsabaEngine/llm-relay/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/BCsabaEngine/llm-relay/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/BCsabaEngine/llm-relay/releases/tag/v1.0.0

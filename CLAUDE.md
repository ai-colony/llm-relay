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
# Or use docker-compose.yml (uses inline env vars, no .env.docker needed):
# docker compose up

# Database schema changes (Drizzle):
npm run drizzle:push     # Push schema changes directly to the DB (dev)
npm run drizzle:generate # Generate migration files
npm run drizzle:migrate  # Apply generated migrations
```

Tests use **Vitest**: `npm test` (single run), `npm run test:watch`, `npm run test:coverage`.

- `test/unit/` — unit tests with mocked dependencies (e.g. `service.test.ts` mocks `@lib` and `repository`)
- `test/api/` — route-handler tests; each file mounts a single Hono handler and mocks the service/repository layer (no DB, no OpenAI)
- `test/helpers/testDb.ts` — in-memory SQLite setup for integration-style tests; mirrors all four production indexes using raw SQL (not Drizzle migrations), so **schema changes also require manual updates here**

Run a single test file: `npx vitest run test/unit/service.test.ts`

Coverage thresholds (enforced): 60% lines / functions / branches / statements.

**Runtime requirement**: Node.js 24 or 26 (ESM, top-level `await`).

## Architecture

`llm-relay` is an HTTP relay server for LLM requests. Clients POST prompts; the server queues them in SQLite, executes them against an OpenAI-compatible API (Llama), and optionally POSTs results back to a callback URL.

### Layers

**HTTP layer** — `src/hono/`  
Hono-based REST API with Zod validation. Routes: `GET /health`, `GET /status`, `POST /prompt/add`, `GET /prompt/get`, `GET /prompt/list`, `DELETE /prompt/cancel`, `GET /openapi.json`, `GET /docs` (Swagger UI). New routes go under `src/hono/`.

- `GET /health` checks both the SQLite database and the upstream OpenAI endpoint; returns `503` (not just a non-`ok` flag) if either fails.
- `DELETE /prompt/cancel` **deletes** the record rather than marking it cancelled; it only succeeds for `queued`, `failed`, and `failed_retry` statuses — returns `409` if `in_progress` or already `completed`.
- `GET /prompt/list` caps results at 500 records.

**Business logic** — `src/prompt/` (aliased as `@prompt`)

- `src/prompt/service.ts` — worker loop functions called by the `setImmediate` loop in `src/index.ts`; processes one queued prompt per tick and handles callback delivery.
- `src/prompt/repository.ts` — all Drizzle database operations for the prompt lifecycle. `countQueuedPrompts()` provides a lightweight queued count (used by `POST /prompt/add`); `getPromptStatusCounts()` aggregates all status counts in a single query (used by `GET /status` and startup logging).

**Shared library** — `src/lib/` (aliased as `@lib`)

- `src/lib/openAI.ts` — OpenAI SDK streaming integration; lazy-resolves the model name once on first use; tracks reasoning vs response tokens separately and calculates tokens-per-second metrics. The "Sending prompt" log includes a `sizes` field with character counts for system and user prompts.
- `src/lib/config.ts` — environment variables parsed with `env-var`; see `.env.example` for all options (`PORT`, `LOG_LEVEL`, `DATABASE_FILENAME`, `OPENAI_URL/MODEL/KEY/TIMEOUT`).
- `src/lib/logger.ts` — Pino logger; use structured fields, not string interpolation. Every log call includes a `component` field (`'server'`, `'http'`, `'worker'`, `'callback'`, `'openai'`) to identify the source layer.

**Data layer** — `src/db/` (aliased as `@db`)  
SQLite via Drizzle ORM (`drizzle-orm/better-sqlite3`). Schema is defined in `src/db/schema.ts`. Schema changes are **not** auto-applied — run `npm run drizzle:push` (dev) or generate+migrate (prod) after editing the schema. The `prompts` table enforces a unique index on `(clientName, requestId)` — duplicate pairs are rejected at the DB layer.

### Key patterns

- **Worker loop**: `src/index.ts` uses `setImmediate` + a 100 ms `setTimeout` between iterations to call `processQueuedPrompts` then `processCallbackPendingPrompts`. Each tick processes one queued prompt and up to 50 pending callbacks (FIFO).
- **Prompt state machine**: `queued` → `in_progress` → `completed | failed | failed_retry`. `failed_retry` is re-picked by the worker after an exponential backoff delay (`2^retryCount * 1s`, capped at 60 s) stored in `nextRetryAt`; there is no retry limit — transient errors retry indefinitely. `failed` is terminal (non-transient errors only).
- **Async callback**: Each prompt can carry a `callbackUrl`; the relay POSTs the result there after completion. `callbackCompleted` tracks delivery separately from prompt completion.
- **Streaming metrics**: `openAI.ts` detects the phase boundary between `reasoning_content` and `content` chunks to record separate timings and token rates. A `component: 'openai'` info log is emitted on completion with the full timing breakdown.
- **Logging convention**: all log calls include a `component` field. `info`-level covers lifecycle events (prompt completed, callback sent, model resolved). `debug`-level adds per-request HTTP logs and prompt pick-up events — enable with `LOG_LEVEL=debug`.
- **Model resolution**: `resolveModel()` in `openAI.ts` queries the upstream API once and caches the result; it selects by `OPENAI_MODEL` env var or falls back to the first available model.

## Tooling notes

- **Prettier**: single quotes, 120-char line width, no trailing commas.
- **ESLint**: flat config (`eslint.config.mjs`) with TypeScript, Unicorn, and Simple Import Sort plugins.
- **Build**: tsup targets ES2024, outputs ESM to `/dist`.
- **Path aliases**: `@lib` → `src/lib/`, `@db` → `src/db/`, `@prompt` → `src/prompt/` (defined in `tsconfig.json` and resolved by `tsx`/`tsup`). Use the alias when importing from a different folder; use relative imports (`./sibling`) within the same folder.

## Deployment (infra/)

Service files for running the built app as a managed daemon:

- `infra/llm-relay.service` — systemd unit for Linux; uses `EnvironmentFile=` to load `.env`, runs as a dedicated `llm-relay` system user, restarts on failure.
- `infra/com.llm-relay.plist` — launchd daemon plist for macOS; calls `infra/start.sh` to source `.env` before starting, keeps the process alive automatically.
- `infra/start.sh` — env-sourcing wrapper (`set -a; source .env; set +a`) used only by the launchd plist (systemd handles env natively).
- `infra/update.sh` — cross-platform update script: `git pull && npm ci --omit=dev && npm run build`, then prints the platform-specific restart command.
- `infra/llama-server-gemma.sh` / `infra/llama-server-qwen.sh` — example commands for starting a local llama.cpp server for Gemma or Qwen models to back the relay.

On startup, `src/index.ts` auto-applies Drizzle migrations from `./drizzle/` — production deployments must ship that folder alongside `/dist`. It also calls `resetInProgressPrompts()` to recover any prompts stuck as `in_progress` from a previous unclean shutdown.

Both service files use `/opt/llm-relay` as a path placeholder. When installing, pipe through `sed "s|/opt/llm-relay|$(pwd)|g"` before writing to the system location — see the README "Production deployment" section for the exact commands.

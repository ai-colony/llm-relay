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

# Database schema changes (Drizzle):
npm run drizzle:push     # Push schema changes directly to the DB (dev)
npm run drizzle:generate # Generate migration files
npm run drizzle:migrate  # Apply generated migrations
```

No tests are implemented yet (`npm test` is a placeholder).

**Runtime requirement**: Node.js 22+ (ESM, top-level `await`).

## Architecture

`llm-relay` is an HTTP relay server for LLM requests. Clients POST prompts; the server queues them in SQLite, executes them against an OpenAI-compatible API (Llama), and optionally POSTs results back to a callback URL.

### Layers

**HTTP layer** — `src/hono/`  
Hono-based REST API with Zod validation. Routes: `GET /health`, `GET /status`, `POST /prompt/add`, `GET /prompt/get`, `GET /prompt/list`, `DELETE /prompt/cancel`. New routes go under `src/hono/`.

- `GET /health` checks both the SQLite database and the upstream OpenAI endpoint; returns `503` (not just a non-`ok` flag) if either fails.
- `DELETE /prompt/cancel` **deletes** the record rather than marking it cancelled; it only succeeds for `queued`, `failed`, and `failed_retry` statuses — returns `409` if `in_progress` or already `completed`.
- `GET /prompt/list` caps results at 500 records.

**Business logic** — `src/prompt/`

- `src/prompt/service.ts` — worker loop functions called by the `setImmediate` loop in `src/index.ts`; processes one queued prompt per tick and handles callback delivery.
- `src/prompt/repository.ts` — all Drizzle database operations for the prompt lifecycle.

**Shared library** — `src/lib/` (aliased as `@lib`)

- `src/lib/openAI.ts` — OpenAI SDK streaming integration; lazy-resolves the model name once on first use; tracks reasoning vs response tokens separately and calculates tokens-per-second metrics.
- `src/lib/config.ts` — environment variables parsed with `env-var`; see `.env.example` for all options (`PORT`, `LOG_LEVEL`, `DATABASE_FILENAME`, `OPENAI_URL/MODEL/KEY/TIMEOUT`).
- `src/lib/logger.ts` — Pino logger; use structured fields, not string interpolation.

**Data layer** — `src/db/` (aliased as `@db`)  
SQLite via Drizzle ORM (`drizzle-orm/better-sqlite3`). Schema is defined in `src/db/schema.ts`. Schema changes are **not** auto-applied — run `npm run drizzle:push` (dev) or generate+migrate (prod) after editing the schema.

### Key patterns

- **Worker loop**: `src/index.ts` uses `setImmediate` + a 100 ms `setTimeout` between iterations to call `processQueuedPrompts` then `processCallbackPendingPrompts`. Each tick processes one queued prompt and up to 50 pending callbacks (FIFO).
- **Prompt state machine**: `queued` → `in_progress` → `completed | failed | failed_retry`. The `failed_retry` status is re-picked by the worker; `failed` is terminal.
- **Async callback**: Each prompt can carry a `callbackUrl`; the relay POSTs the result there after completion. `callbackCompleted` tracks delivery separately from prompt completion.
- **Streaming metrics**: `openAI.ts` detects the phase boundary between `reasoning_content` and `content` chunks to record separate timings and token rates.
- **Model resolution**: `resolveModel()` in `openAI.ts` queries the upstream API once and caches the result; it selects by `OPENAI_MODEL` env var or falls back to the first available model.

## Tooling notes

- **Prettier**: single quotes, 120-char line width, no trailing commas.
- **ESLint**: flat config (`eslint.config.mjs`) with TypeScript, Unicorn, and Simple Import Sort plugins.
- **Build**: tsup targets ES2024, outputs ESM to `/dist`.
- **Path aliases**: `@lib` → `src/lib/`, `@db` → `src/db/` (defined in `tsconfig.json` and resolved by `tsx`/`tsup`).

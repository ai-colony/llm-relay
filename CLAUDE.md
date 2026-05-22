# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Dev server with auto-reload and pretty-printed logs
npm run build        # Production build via tsup → /dist (ESM)
npm run typecheck    # TypeScript type checking only (no emit)
npm run lint:check   # ESLint check
npm run lint:fix     # ESLint auto-fix
npm run format:check # Prettier check
npm run format:fix   # Prettier auto-fix
npm run fix          # format:fix + lint:fix + format:fix
npm run all          # fix + typecheck + build + test (full pipeline)
```

No tests are implemented yet (`npm test` is a placeholder).

## Architecture

`llm-relay` is an HTTP relay server for LLM requests. Clients POST prompts; the server queues them in SQLite, executes them against an OpenAI-compatible API (Llama), and optionally POSTs results back to a callback URL.

### Layers

**HTTP layer** — `src/hono/`  
Hono-based REST API with Zod validation. Two routes: `GET /health` and `POST /prompt/add`. New routes go under `src/hono/`.

**Business logic**

- `src/openAI.ts` — OpenAI SDK streaming integration; tracks reasoning vs response tokens separately and calculates tokens-per-second metrics.
- `src/promptRepository.ts` — all database operations for the prompt lifecycle.

**Data layer** — `src/db/`  
SQLite via `@andrewitsover/midnight` ORM. Schema is defined in `src/db/schema.ts` and auto-migrates on server startup. The `Prompt` table drives a state machine: `queued → in_progress → completed | failed | failed_retry`.

**Config & logging**

- `src/config.ts` — environment variables parsed with `env-var`; see `.env.example` for all options (`PORT`, `LOG_LEVEL`, `DATABASE_FILENAME`, `OPENAI_URL/MODEL/KEY/TIMEOUT`).
- `src/logger.ts` — Pino logger; use structured fields, not string interpolation.

### Key patterns

- **Async callback**: Each prompt can carry a `callbackUrl`; the relay POSTs the result there on completion.
- **Streaming metrics**: `openAI.ts` accumulates separate timing and token counts for the reasoning phase and the response phase.
- **ORM migrations**: Adding a column to the `Prompt` table means updating `src/db/schema.ts`; the ORM handles the migration automatically on next startup.

## Tooling notes

- **Prettier**: single quotes, 120-char line width, no trailing commas.
- **ESLint**: flat config (`eslint.config.mjs`) with TypeScript, Unicorn, and Simple Import Sort plugins.
- **Build**: tsup targets ES2024, outputs ESM to `/dist`.

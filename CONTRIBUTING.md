# Contributing to llm-relay

## Prerequisites

- Node.js 24 or 26
- npm

## Setup

```bash
git clone https://github.com/ai-colony/llm-relay.git
cd llm-relay
npm install
cp .env.example .env   # edit as needed
```

## Branching

- `feat/<name>` — new features
- `fix/<name>` — bug fixes
- `chore/<name>` — maintenance, deps, tooling

PRs target `main`. One logical change per PR.

## Development

```bash
npm run dev      # auto-reload + pretty-printed logs
npm run dev-raw  # auto-reload + raw JSON logs
```

## Code Quality

```bash
npm run fix       # format + lint (run before committing)
npm run typecheck # TypeScript check only
npm run all       # full pipeline: fix → typecheck → build → test
```

## Testing

```bash
npm test               # single run
npm run test:watch     # watch mode
npm run test:coverage  # with coverage report
```

Tests live in two directories:

- `test/unit/` — unit tests; dependencies (`@lib`, repository) are mocked
- `test/api/` — route-handler tests; each file mounts a single Hono handler with the service/repository layer mocked (no real DB or LLM calls)

60% coverage is enforced on lines, functions, branches, and statements.

> **Note:** If you change `src/db/schema.ts`, you must also update `test/helpers/testDb.ts` manually — it mirrors the schema using raw SQL and is not driven by Drizzle migrations.

## Submitting a PR

1. Run `npm run all` and make sure it passes.
2. Write a clear PR description explaining _why_ the change is needed, not just what changed.
3. Squash fixup commits before requesting review.

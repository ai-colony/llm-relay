# Contributing to llm-relay

## Prerequisites

- Node.js 24
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
npm run typecheck # TypeScript check only (covers src and test)
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
- `test/helpers/` — shared fixtures: `testDatabase.ts` (in-memory SQLite), `mocks.ts` (`makeLoggerMock`, `makeStatusCounts`, `postJson`, `withQuery`, `readJson`), `environment.ts` (`withEnvironment` for env-dependent config tests)

60% coverage is enforced on lines, functions, branches, and statements — CI runs `test:coverage`, so falling below the threshold fails the build.

Test files are typechecked too: `npm run typecheck` uses `tsconfig.test.json`, which extends the base config to cover `test/` alongside `src/`. Read JSON response bodies with `readJson(response)` instead of `await response.json()`, which is typed `unknown`.

> **Note:** `test/helpers/testDatabase.ts` builds its in-memory database by running the real migrations from `./drizzle`, so a schema change needs no manual mirroring here — but you must still generate the migration (`npm run drizzle:generate`) for it to be picked up.

## Submitting a PR

1. Run `npm run all` and make sure it passes. CI runs the same checks on your branch and again on the PR itself, so a red pipeline blocks the merge.
2. Write a clear PR description explaining _why_ the change is needed, not just what changed.
3. Squash fixup commits before requesting review.

# LLM-relay

An HTTP relay server that queues LLM prompts, executes them serially against any OpenAI-compatible API, and optionally delivers results to a callback URL.

[Changelog](CHANGELOG.md) · [Architecture](ARCHITECTURE.md)

<p align="center">
  <img src="llm-relay.png" alt="llm-relay" />
</p>

---

## Why

Local or self-hosted LLMs (e.g. llama.cpp, Ollama, vLLM) typically handle only a few requests at a time. `llm-relay` sits in front of the model and serializes concurrent requests into a priority queue backed by SQLite, so callers never have to manage back-pressure themselves. Clients can either poll for results or receive them via a push callback.

## Infrastructure requirements

- **Node.js** 24+ (ESM, top-level `await`)
- **An OpenAI-compatible API** — any endpoint that implements `GET /models` and `POST /chat/completions` with streaming (llama.cpp server, Ollama, vLLM, LM Studio, the real OpenAI, etc.)
- **SQLite** — no separate database process needed; the file is created automatically on first run

## Setup

```bash
npm install
cp .env.example .env   # then edit .env
```

### Environment variables

| Variable                         | Default                    | Description                                                                                                                                                                                           |
| -------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                           | `3000`                     | HTTP port the relay listens on                                                                                                                                                                        |
| `API_KEY`                        | _(empty)_                  | When set, all `/prompt/*` and `/chat/*` endpoints require `Authorization: Bearer <key>`. `GET /health`, `GET /status`, and `GET /metrics` remain public.                                              |
| `LOG_LEVEL`                      | `info`                     | Pino log level (`trace`, `debug`, `info`, `warn`, `error`)                                                                                                                                            |
| `DATABASE_FILENAME`              | `./database.sqlite`        | Path to the SQLite database file                                                                                                                                                                      |
| `OPENAI_URL`                     | `http://localhost:8080/v1` | Base URL of the OpenAI-compatible API                                                                                                                                                                 |
| `OPENAI_MODEL`                   | _(first available model)_  | Model name to use; if empty, the first model from `/models` is used                                                                                                                                   |
| `OPENAI_KEY`                     | `none`                     | API key (use `none` for local servers that don't require one)                                                                                                                                         |
| `OPENAI_TIMEOUT`                 | `10000`                    | Per-request timeout in milliseconds                                                                                                                                                                   |
| `OPENAI_MAX_RETRY_COUNT`         | `10`                       | Maximum number of transient-error retries before a prompt is permanently failed with `statusError: "max_retries_exceeded"`                                                                            |
| `OPENAI_MODEL_CACHE_TTL_SECONDS` | `60`                       | How often (in seconds) to re-check the upstream `/models` endpoint for the active model name and context size, so a backend restart with a different model is picked up without restarting the relay. |
| `WORKER_CONCURRENCY`             | `1`                        | Number of prompts processed concurrently per worker tick (capped at `16`). Increase when the upstream LLM supports parallel requests.                                                                 |
| `CALLBACK_URL_ALLOWLIST`         | _(empty)_                  | Optional regex. When set, any `callbackUrl` on `POST /prompt/add` must match this pattern or the request is rejected with `400`. Use to prevent SSRF against internal hosts.                          |
| `CALLBACK_RETRY_TTL_HOURS`       | `24`                       | Callbacks that have been pending for longer than this many hours are skipped and not retried again.                                                                                                   |
| `CALLBACK_HMAC_SECRET`           | _(empty)_                  | When set, each callback POST includes `X-LLM-Relay-Signature: hmac-sha256=<hex>` computed over the body. Lets receivers verify authenticity.                                                          |

## Running

```bash
# Development (auto-reload, pretty logs)
npm run dev

# Production
npm run build
npm start
```

## Logs

`llm-relay` uses [Pino](https://github.com/pinojs/pino) structured JSON logging. Every log entry includes a `component` field:

| `component` | Source                                                        |
| ----------- | ------------------------------------------------------------- |
| `server`    | Startup, shutdown, unhandled worker errors                    |
| `http`      | Per-request logs from the Hono middleware (debug only)        |
| `worker`    | Prompt lifecycle — picked up, completed, failed               |
| `callback`  | Callback delivery — sent, failed                              |
| `openai`    | Model resolution, prompt send, completion with timing metrics |

At the default `info` level you see lifecycle events (one log per prompt through its lifecycle). Set `LOG_LEVEL=debug` to also get per-request HTTP logs and the prompt pick-up event.

The `openai` completion log includes inference performance metrics useful for monitoring throughput:

```json
{
  "component": "openai",
  "model": "llama-3.2",
  "reasoningTimeMs": 1240,
  "reasoningTokenPerSecond": 48,
  "responseTimeMs": 320,
  "responseTokenPerSecond": 54,
  "msg": "Prompt completed"
}
```

## Production deployment

### Docker

Images are published to GitHub Container Registry. A new image is built and pushed on every release (when `package.json` version changes on `main`); check the [releases page](https://github.com/ai-colony/llm-relay/releases) for the current version.

#### Image tags

| Tag                       | Example                                   | When to use                                                            |
| ------------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| `<version>`               | `ghcr.io/ai-colony/llm-relay:1.7.0`       | Standard — pin to a known release. There is no `latest` or `main` tag. |
| `<image>@sha256:<digest>` | `ghcr.io/ai-colony/llm-relay@sha256:abc…` | Fully reproducible deployments — immune to tag mutation.               |

To find the digest for a given version:

```bash
docker pull ghcr.io/ai-colony/llm-relay:1.7.0
docker inspect --format='{{index .RepoDigests 0}}' ghcr.io/ai-colony/llm-relay:1.7.0
# ghcr.io/ai-colony/llm-relay@sha256:<digest>
```

Minimal — only the upstream URL needs to be set; everything else has a sensible default:

```bash
docker run -d --rm \
  --name llm-relay \
  -p 3000:3000 \
  -e OPENAI_URL=http://host.docker.internal:8080/v1 \
  -v llm-relay-data:/app/data \
  ghcr.io/ai-colony/llm-relay:1.7.0
```

Full — all available environment variables:

```bash
docker run -d --rm \
  --name llm-relay \
  -p 3000:3000 \
  -e PORT=3000 \
  -e LOG_LEVEL=info \
  -e OPENAI_URL=http://host.docker.internal:8080/v1 \
  -e OPENAI_MODEL= \
  -e OPENAI_KEY=none \
  -e OPENAI_TIMEOUT=10000 \
  -e OPENAI_MODEL_CACHE_TTL_SECONDS=60 \
  -v llm-relay-data:/app/data \
  ghcr.io/ai-colony/llm-relay:1.7.0
```

Key points:

- **SQLite path**: the database lives at `/app/data/database.sqlite` — pre-configured in the image, no env var needed. Always mount a named volume or host directory at `/app/data` so data survives container restarts.
- **`--rm`**: removes the stopped container automatically; the named volume `llm-relay-data` is unaffected, so your data is safe.
- **Network**: uses `host.docker.internal` to reach a local LLM server. On Linux with bridge networking replace it with the host gateway IP, or use `--network host` and `OPENAI_URL=http://localhost:8080/v1` instead.
- **Port**: the relay listens on `PORT` (default `3000`). The `-p 3000:3000` flag exposes it from the container.

#### npm helper scripts

```bash
npm run docker:build   # build image tagged llm-relay:<version>
npm run docker:run     # run with --network=host and llm-relay-data volume
npm run docker:it      # interactive shell in a fresh container
```

These scripts read `OPENAI_*` and other variables from `.env.docker` (create it from `.env.example`).

### From source

```bash
git clone https://github.com/BCsabaEngine/llm-relay /opt/llm-relay
cd /opt/llm-relay
npm install
npm run build
cp .env.example .env   # then edit .env
node --no-warnings=ExperimentalWarning dist/index.js
```

The production bundle is fully self-contained — no `node_modules` are needed at runtime alongside `dist/`. Ship `dist/` and `drizzle/` to any server running Node.js 24+.

## API

All requests and responses use JSON. An interactive OpenAPI reference is available at `GET /docs` (Swagger UI); the raw schema is at `GET /openapi.json`.

### `GET /health`

Returns `200 OK` when both the SQLite database and the upstream OpenAI endpoint are reachable. Returns `503` if either check fails, with a `checks` object describing which component is down.

### `GET /status`

Returns queue counts and server uptime.

```json
{
  "version": "1.7.0",
  "uptime": 42,
  "model": "llama-3.2",
  "contextSize": 131072,
  "queued": 3,
  "pending": 1,
  "completed": 150,
  "failed": 2,
  "callbackPending": 0
}
```

```typescript
import { z } from 'zod';

const StatusResponse = z.object({
  version: z.string(),
  uptime: z.number(),
  model: z.string().nullable(),
  contextSize: z.number().int().nullable(),
  queued: z.number().int(),
  pending: z.number().int(),
  completed: z.number().int(),
  failed: z.number().int(),
  callbackPending: z.number().int()
});
type StatusResponse = z.infer<typeof StatusResponse>;
```

### `GET /metrics`

Returns Prometheus text-exposition format (`Content-Type: text/plain; version=0.0.4`). Combines the prompt-queue gauges also shown in `GET /status` with request-level counters and histograms:

| Metric                                 | Type      | Labels                         | Description                                                     |
| -------------------------------------- | --------- | ------------------------------ | --------------------------------------------------------------- |
| `llm_relay_prompts_queued`             | gauge     | —                              | Prompts currently queued (including `failed_retry`)             |
| `llm_relay_prompts_pending`            | gauge     | —                              | Prompts currently being processed                               |
| `llm_relay_prompts_completed_total`    | counter   | —                              | Prompts successfully completed                                  |
| `llm_relay_prompts_failed_total`       | counter   | —                              | Prompts that failed permanently                                 |
| `llm_relay_callbacks_pending`          | gauge     | —                              | Completed prompts awaiting callback delivery                    |
| `llm_relay_uptime_seconds`             | gauge     | —                              | Process uptime                                                  |
| `http_requests_total`                  | counter   | `method`, `path`, `status`     | Every HTTP request handled by the relay                         |
| `http_request_duration_seconds`        | histogram | `method`, `path`               | HTTP request latency                                            |
| `openai_requests_total`                | counter   | `result` (`success`/`failure`) | OpenAI completion calls from the prompt worker                  |
| `openai_request_duration_seconds`      | histogram | —                              | Worker OpenAI completion call latency                           |
| `openai_chat_requests_total`           | counter   | `result` (`success`/`failure`) | OpenAI calls from `POST /chat/completions`                      |
| `openai_chat_request_duration_seconds` | histogram | —                              | `/chat/completions` full-stream latency                         |
| `callback_deliveries_total`            | counter   | `result` (`success`/`failure`) | Callback POST attempts — a non-2xx response counts as `failure` |

### `POST /prompt/add`

Enqueue a prompt. The `(clientName, requestId)` pair must be unique — re-submitting the same pair returns `409` unless `overwrite` is set to `true`.

**Request body:**

```json
{
  "clientName": "my-app",
  "requestId": "req-001",
  "userPrompt": "What is the capital of France?",
  "systemPrompt": "You are a geography expert.",
  "temperature": 0.7,
  "priority": 0,
  "callbackUrl": "https://my-app.example.com/llm-callback",
  "overwrite": false
}
```

| Field          | Type    | Required | Description                                                                                                                                                                                                                                      |
| -------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clientName`   | string  | yes      | Logical client identifier; scopes `requestId` uniqueness                                                                                                                                                                                         |
| `requestId`    | string  | yes      | Client-assigned ID, non-empty string                                                                                                                                                                                                             |
| `userPrompt`   | string  | yes      | The user turn of the conversation                                                                                                                                                                                                                |
| `systemPrompt` | string  | no       | Optional system prompt                                                                                                                                                                                                                           |
| `temperature`  | float   | yes      | Sampling temperature, `0`–`2`                                                                                                                                                                                                                    |
| `priority`     | integer | no       | Default `0`. Lower values are processed first; ties broken by creation time. Use higher values (e.g. `10`) for background batch jobs so interactive requests at `0` skip ahead.                                                                  |
| `callbackUrl`  | URL     | no       | If provided, the relay POSTs the result here when done                                                                                                                                                                                           |
| `overwrite`    | boolean | no       | Default `false`. When `true`, deletes any existing prompt with the same `clientName + requestId` before adding. Only valid for statuses `queued`, `completed`, `failed`, `failed_retry` — returns `409` if the existing prompt is `in_progress`. |

```typescript
import { z } from 'zod';

const AddPromptBody = z.object({
  clientName: z.string().min(1),
  requestId: z.string().min(1),
  userPrompt: z.string().min(1),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2),
  priority: z.number().int().min(0).optional().default(0),
  callbackUrl: z.string().url().optional(),
  overwrite: z.boolean().optional().default(false)
});
type AddPromptBody = z.infer<typeof AddPromptBody>;
```

**Response `201`:**

```json
{ "success": true, "queued": 4 }
```

```typescript
const AddPromptResponse = z.object({
  success: z.literal(true),
  queued: z.number().int()
});
type AddPromptResponse = z.infer<typeof AddPromptResponse>;
```

### `GET /prompt/get?clientName=&requestId=`

Poll for the result of a specific prompt.

```typescript
import { z } from 'zod';

const GetPromptQuery = z.object({
  clientName: z.string(),
  requestId: z.string().min(1)
});
type GetPromptQuery = z.infer<typeof GetPromptQuery>;
```

**Response when completed:**

```json
{
  "status": "completed",
  "reasoning": "...",
  "response": "Paris.",
  "reasoningTimeMs": 1200,
  "reasoningTokenPerSecond": 45,
  "responseTimeMs": 300,
  "responseTokenPerSecond": 52
}
```

**Response when still processing:**

```json
{ "status": "queued" }
```

**Response on failure:**

```json
{ "status": "failed", "statusError": "ECONNRESET" }
```

**Response `404` — prompt not found:**

```json
{ "success": false, "error": "Prompt not found" }
```

```typescript
const GetPromptResponse = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['queued', 'in_progress', 'failed_retry']) }),
  z.object({ status: z.literal('failed'), statusError: z.string().nullable() }),
  z.object({
    status: z.literal('completed'),
    reasoning: z.string().nullable(),
    response: z.string().nullable(),
    reasoningTimeMs: z.number().nullable(),
    reasoningTokenPerSecond: z.number().nullable(),
    responseTimeMs: z.number().nullable(),
    responseTokenPerSecond: z.number().nullable()
  })
]);
type GetPromptResponse = z.infer<typeof GetPromptResponse>;
```

### `GET /prompt/list?clientName=&status=`

List all prompts for a client. `status` filter is optional and accepts: `queued`, `in_progress`, `completed`, `failed`, `failed_retry`. Results are capped at 500 records.

```typescript
import { z } from 'zod';

const PromptStatus = z.enum(['queued', 'in_progress', 'completed', 'failed', 'failed_retry']);

const ListPromptsQuery = z.object({
  clientName: z.string(),
  status: PromptStatus.optional()
});
type ListPromptsQuery = z.infer<typeof ListPromptsQuery>;

const ListPromptsResponse = z.array(
  z.object({
    priority: z.number().int().min(0),
    id: z.number().int(),
    clientName: z.string(),
    requestId: z.string(),
    status: PromptStatus,
    statusError: z.string().nullable(),
    createdAt: z.coerce.date(),
    completedAt: z.coerce.date().nullable(),
    callbackUrl: z.string().url().nullable(),
    callbackCompleted: z.boolean(),
    systemPrompt: z.string().nullable(),
    userPrompt: z.string(),
    temperature: z.number(),
    retryCount: z.number().int(),
    nextRetryAt: z.coerce.date().nullable(),
    reasoning: z.string().nullable(),
    response: z.string().nullable(),
    reasoningTimeMs: z.number().nullable(),
    reasoningTokenPerSecond: z.number().nullable(),
    responseTimeMs: z.number().nullable(),
    responseTokenPerSecond: z.number().nullable()
  })
);
type ListPromptsResponse = z.infer<typeof ListPromptsResponse>;
```

### `DELETE /prompt/purge?days=&clientName=`

Bulk-delete `completed` and `failed` prompts older than `days` days (default `7`). `clientName` is optional; omitting it purges across all clients.

```typescript
import { z } from 'zod';

const PurgePromptsQuery = z.object({
  days: z.coerce.number().int().min(1).optional().default(7),
  clientName: z.string().optional()
});
type PurgePromptsQuery = z.infer<typeof PurgePromptsQuery>;

const PurgePromptsResponse = z.object({
  success: z.literal(true),
  deleted: z.number().int()
});
type PurgePromptsResponse = z.infer<typeof PurgePromptsResponse>;
```

**Response `200`:**

```json
{ "success": true, "deleted": 42 }
```

### `DELETE /prompt/cancel?clientName=&requestId=`

Cancel and **delete** a prompt. Only succeeds for `queued`, `failed`, and `failed_retry` statuses — returns `409` if the prompt is `in_progress` or already `completed`.

```typescript
import { z } from 'zod';

const CancelPromptQuery = z.object({
  clientName: z.string(),
  requestId: z.string().min(1)
});
type CancelPromptQuery = z.infer<typeof CancelPromptQuery>;

const CancelPromptResponse = z.object({
  success: z.literal(true)
});
type CancelPromptResponse = z.infer<typeof CancelPromptResponse>;
```

### `POST /chat/completions`

Stream a multi-turn conversation directly to the upstream LLM. This path **bypasses the queue** — use it for interactive, low-latency chat. The response is an SSE stream (`text/event-stream`): each event is `data: <JSON chunk>` (OpenAI streaming format), ending with `data: [DONE]`.

**Request body:**

```json
{
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ],
  "tools": [],
  "temperature": 0.7
}
```

| Field         | Type  | Required | Description                                                                                  |
| ------------- | ----- | -------- | -------------------------------------------------------------------------------------------- |
| `messages`    | array | yes      | Conversation history; each message has `role` and `content` (plus optional tool-call fields) |
| `tools`       | array | no       | OpenAI function-calling tool definitions forwarded verbatim to the upstream model            |
| `temperature` | float | no       | Sampling temperature, `0`–`2`                                                                |

```typescript
import { z } from 'zod';

const RelayMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().nullable().optional(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        type: z.literal('function'),
        function: z.object({ name: z.string(), arguments: z.string() })
      })
    )
    .optional(),
  tool_call_id: z.string().optional(),
  name: z.string().optional()
});

const RelayChatRequestSchema = z.object({
  messages: z.array(RelayMessageSchema).min(1),
  tools: z
    .array(
      z.object({
        type: z.literal('function'),
        function: z.object({
          name: z.string(),
          description: z.string().optional(),
          parameters: z.record(z.string(), z.unknown())
        })
      })
    )
    .optional(),
  temperature: z.number().min(0).max(2).optional()
});
type RelayChatRequest = z.infer<typeof RelayChatRequestSchema>;
```

If the client disconnects mid-stream, the abort signal is propagated and the upstream request is cancelled.

## Prompt lifecycle

```
queued → in_progress → completed
                     → failed          (terminal)
                     → failed_retry    (re-queued, retried indefinitely)
```

Transient errors (network timeouts, connection resets, `AbortError`, etc.) trigger `failed_retry` with an exponential backoff delay (`2^retryCount × 1 s`, capped at 60 s). After `OPENAI_MAX_RETRY_COUNT` attempts (default `10`) the prompt transitions to `failed` with `statusError: "max_retries_exceeded"`. Hard failures (e.g. model not found) go straight to `failed` immediately.

On startup, any prompts stuck in `in_progress` from a previous unclean shutdown are automatically reset to `queued`.

## Callback delivery

When a prompt with a `callbackUrl` completes, the relay POSTs the following payload to that URL (10 s timeout):

```json
{
  "clientName": "my-app",
  "requestId": "req-001",
  "reasoning": "...",
  "response": "Paris."
}
```

```typescript
import { z } from 'zod';

const CallbackPayload = z.object({
  clientName: z.string(),
  requestId: z.string(),
  reasoning: z.string().nullable(),
  response: z.string().nullable()
});
type CallbackPayload = z.infer<typeof CallbackPayload>;
```

Callback delivery is tracked separately from prompt completion — a failed HTTP POST is logged and retried on the next worker tick (up to 50 callbacks per tick, FIFO order). Callbacks pending longer than `CALLBACK_RETRY_TTL_HOURS` (default `24`) are abandoned.

**Availability check**: when `callbackUrl` is provided on `POST /prompt/add`, the relay sends a `GET` probe to that URL before accepting the request. If the probe times out or fails, the endpoint returns `503`.

**HMAC signing**: when `CALLBACK_HMAC_SECRET` is set, each callback POST includes an `X-LLM-Relay-Signature: hmac-sha256=<hex>` header. Receivers can verify it by computing `HMAC-SHA256(secret, body)` and comparing the hex digest.

**Allowlist**: set `CALLBACK_URL_ALLOWLIST` to a regex string to restrict which URLs are accepted as `callbackUrl`. Requests with a non-matching URL are rejected with `400`.

## Usage example

```bash
# 1. Enqueue a prompt
curl -s -X POST http://localhost:3000/prompt/add \
  -H 'Content-Type: application/json' \
  -d '{
    "clientName": "demo",
    "requestId": "req-001",
    "userPrompt": "Name three planets.",
    "temperature": 0.5
  }'
# → {"success":true,"queued":1}

# 2. Poll until completed
curl -s 'http://localhost:3000/prompt/get?clientName=demo&requestId=req-001'
# → {"status":"queued"}
# ... wait a moment ...
curl -s 'http://localhost:3000/prompt/get?clientName=demo&requestId=req-001'
# → {"status":"completed","reasoning":null,"response":"Mercury, Venus, Earth.","reasoningTimeMs":null,...}

# 3. Check server status
curl -s http://localhost:3000/status
```

## Testing

Tests use [Vitest](https://vitest.dev/) and are split into two categories:

| Directory    | What it tests                                          | External dependencies                              |
| ------------ | ------------------------------------------------------ | -------------------------------------------------- |
| `test/unit/` | Business logic (`config`, `openAI`, `repo`, `service`) | Mocked via `vi.mock`                               |
| `test/api/`  | Hono route handlers (one file per endpoint)            | Service/repository layer mocked; no real DB or LLM |

60% coverage is enforced on lines, functions, branches, and statements.

```bash
npm test                # single run
npm run test:watch      # watch mode
npm run test:coverage   # with coverage report
```

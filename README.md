# LLM-relay

An HTTP relay server that queues LLM prompts, executes them serially against any OpenAI-compatible API, and optionally delivers results to a callback URL.

## Why

Local or self-hosted LLMs (e.g. llama.cpp, Ollama, vLLM) typically handle only a few requests at a time. `llm-relay` sits in front of the model and serializes concurrent requests into a FIFO queue backed by SQLite, so callers never have to manage back-pressure themselves. Clients can either poll for results or receive them via a push callback.

## Infrastructure requirements

- **Node.js** 22+ (ESM, top-level `await`)
- **An OpenAI-compatible API** — any endpoint that implements `GET /models` and `POST /chat/completions` with streaming (llama.cpp server, Ollama, vLLM, LM Studio, the real OpenAI, etc.)
- **SQLite** — no separate database process needed; the file is created automatically on first run

## Setup

```bash
npm install
cp .env.example .env   # then edit .env
```

### Environment variables

| Variable            | Default                    | Description                                                         |
| ------------------- | -------------------------- | ------------------------------------------------------------------- |
| `PORT`              | `3000`                     | HTTP port the relay listens on                                      |
| `LOG_LEVEL`         | `info`                     | Pino log level (`trace`, `debug`, `info`, `warn`, `error`)          |
| `DATABASE_FILENAME` | `./database.sqlite`        | Path to the SQLite database file                                    |
| `OPENAI_URL`        | `http://localhost:8080/v1` | Base URL of the OpenAI-compatible API                               |
| `OPENAI_MODEL`      | _(first available model)_  | Model name to use; if empty, the first model from `/models` is used |
| `OPENAI_KEY`        | `none`                     | API key (use `none` for local servers that don't require one)       |
| `OPENAI_TIMEOUT`    | `10000`                    | Per-request timeout in milliseconds                                 |

## Running

```bash
# Development (auto-reload, pretty logs)
npm run dev

# Production
npm run build
npm start
```

## API

All requests and responses use JSON.

### `GET /health`

Returns `200 OK` when the server is up.

### `GET /status`

Returns queue counts and server uptime.

```json
{
  "version": "1.0.0",
  "uptime": 42,
  "queued": 3,
  "pending": 1,
  "completed": 150,
  "failed": 2,
  "callbackPending": 0
}
```

### `POST /prompt/add`

Enqueue a prompt. The `(clientName, requestId)` pair must be unique — re-submitting the same pair returns `409`.

**Request body:**

```json
{
  "clientName": "my-app",
  "requestId": 1,
  "userPrompt": "What is the capital of France?",
  "systemPrompt": "You are a geography expert.",
  "temperature": 0.7,
  "callbackUrl": "https://my-app.example.com/llm-callback"
}
```

| Field          | Type    | Required | Description                                              |
| -------------- | ------- | -------- | -------------------------------------------------------- |
| `clientName`   | string  | yes      | Logical client identifier; scopes `requestId` uniqueness |
| `requestId`    | integer | yes      | Client-assigned ID, positive integer                     |
| `userPrompt`   | string  | yes      | The user turn of the conversation                        |
| `systemPrompt` | string  | no       | Optional system prompt                                   |
| `temperature`  | float   | yes      | Sampling temperature, `0`–`2`                            |
| `callbackUrl`  | URL     | no       | If provided, the relay POSTs the result here when done   |

**Response `201`:**

```json
{ "success": true, "queued": 4 }
```

### `GET /prompt/get?clientName=&requestId=`

Poll for the result of a specific prompt.

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

### `GET /prompt/list?clientName=&status=`

List all prompts for a client. `status` filter is optional and accepts: `queued`, `in_progress`, `completed`, `failed`, `failed_retry`.

### `DELETE /prompt/cancel?clientName=&requestId=`

Cancel a queued or retrying prompt. Returns `409` if the prompt is `in_progress` or already `completed`.

## Prompt lifecycle

```
queued → in_progress → completed
                     → failed          (terminal)
                     → failed_retry    (re-queued, up to 3 retries)
```

Transient errors (network timeouts, connection resets, `AbortError`, etc.) trigger `failed_retry` with an exponential backoff delay (`2^retryCount × 1 s`, capped at 60 s). There is no retry limit — transient errors are retried indefinitely. Hard failures (e.g. model not found) go straight to `failed`.

On startup, any prompts stuck in `in_progress` from a previous unclean shutdown are automatically reset to `queued`.

## Callback delivery

When a prompt with a `callbackUrl` completes, the relay POSTs the following payload to that URL (10 s timeout):

```json
{
  "clientName": "my-app",
  "requestId": 1,
  "reasoning": "...",
  "response": "Paris."
}
```

Callback delivery is tracked separately from prompt completion — a failed HTTP POST is logged and retried on the next worker tick.

## Usage example

```bash
# 1. Enqueue a prompt
curl -s -X POST http://localhost:3000/prompt/add \
  -H 'Content-Type: application/json' \
  -d '{
    "clientName": "demo",
    "requestId": 1,
    "userPrompt": "Name three planets.",
    "temperature": 0.5
  }'
# → {"success":true,"queued":1}

# 2. Poll until completed
curl -s 'http://localhost:3000/prompt/get?clientName=demo&requestId=1'
# → {"status":"queued"}
# ... wait a moment ...
curl -s 'http://localhost:3000/prompt/get?clientName=demo&requestId=1'
# → {"status":"completed","reasoning":null,"response":"Mercury, Venus, Earth.","reasoningTimeMs":null,...}

# 3. Check server status
curl -s http://localhost:3000/status
```

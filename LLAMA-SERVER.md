# Running two llama.cpp backends alongside llm-relay

`llm-relay` can drive a generative model and an embedding model at the same time (`GENERATIVE_URL` +
`EMBEDDING_URL`). On a unified-memory Mac the two compete for the same GPU budget, and the default
context settings are large enough that they do not co-reside. This file records the settings that
were measured to work, and why.

Reference hardware: **Apple M1 Pro, 16 GB unified memory.** Scale the numbers for other machines.

## Recommended settings

### Generative — port 8080

```bash
llama-server --model ~/models/Qwen3.5-9B-UD-Q5_K_XL.gguf \
--jinja \
--ctx-size 32768 \
--threads 8 \
--threads-batch 8 \
--n-gpu-layers 99 \
--batch-size 2048 \
--ubatch-size 512 \
--flash-attn on \
--cache-type-k q8_0 \
--cache-type-v q8_0 \
--temp 0.7 \
--top-p 0.8 \
--top-k 20 \
--min-p 0.00 \
--repeat-penalty 1.0 \
--presence-penalty 1.5 \
--port 8080 \
--reasoning off \
--reasoning-format deepseek \
--parallel 1 \
--no-perf
```

Changed from the previous config: `--ctx-size 131072` → `32768`, `--parallel 2` → `1`.

### Embedding — port 8081

Unchanged; it was never the problem.

```bash
llama-server --model ~/models/Qwen3-Embedding-4B-Q4_K_M.gguf \
--embedding \
--pooling last \
--ctx-size 8192 \
--threads 8 \
--threads-batch 8 \
--n-gpu-layers 99 \
--batch-size 512 \
--ubatch-size 512 \
--flash-attn on \
--cache-type-k f16 \
--cache-type-v f16 \
--parallel 1 \
--port 8081 \
--no-perf
```

## What goes wrong without this

With the generative server at `--ctx-size 131072 --parallel 2`, the **embedding** server is the one
that dies — it is second in line for GPU memory:

```
error: Insufficient Memory (00000008:kIOGPUCommandBufferCallbackErrorOutOfMemory)
ggml_metal_synchronize: error: command buffer 0 failed with status 5
ggml_metal_graph_compute: backend is in error state from a previous command buffer failure - recreate the backend to recover
llama_decode: failed to decode, ret = -3
srv    send_error: error: Compute error.
```

Measured on the reference hardware, queueing 10 embedding jobs and 4 prompts together:

| Generative settings              | Embeddings          | Prompts |
| -------------------------------- | ------------------- | ------- |
| `--ctx-size 131072 --parallel 2` | 4 ok, **6 failed**  | 4 ok    |
| `--ctx-size 32768 --parallel 1`  | **10 ok, 0 failed** | 4 ok    |

Two things make this nastier than a normal resource error:

- **It is not self-healing.** `backend is in error state ... recreate the backend to recover` means
  every subsequent request fails until the embedding server is restarted. The first couple of jobs
  succeed, then everything after fails.
- **The relay cannot retry its way out**, and correctly does not try. `500 Compute error.` is not a
  network-shaped failure, so `isTransientError` classifies it as terminal and the job goes straight
  to `failed` with `retryCount = 0` rather than burning `UPSTREAM_MAX_RETRY_COUNT` attempts against a
  backend that will reject every one of them.

## Why `--ctx-size` is the lever, not `--parallel`

In llama.cpp `--ctx-size` is the **total** KV budget, divided across `--parallel` slots. With
`--ctx-size 131072 --parallel 2` each slot gets 65536 tokens — which is exactly what `GET /status`
reported as `contextSize`, and a useful way to confirm what a running server actually allocated.

So:

- Lowering `--parallel` **alone does not free KV memory** — it hands the same total to fewer slots.
  It does cut per-slot compute buffers, which is worth having, but it is the smaller effect.
- Lowering `--ctx-size` is what actually shrinks the KV cache. Going from 131072 to 32768 cuts it
  4×.
- `--cache-type-k q8_0 --cache-type-v q8_0` is already halving KV versus `f16`. Keep it.

32768 tokens on a single slot is still a generous window for relay traffic, and `--parallel 1`
matches how the relay drives this backend anyway — `WORKER_CONCURRENCY` defaults to `1`.

## Interaction with the relay

- **Embedding jobs are executed strictly one at a time**, regardless of `WORKER_CONCURRENCY`. The
  worker claims a batch but runs it through a serial loop, because the embedding backend runs with
  `--parallel 1` and overlapping requests would only queue up inside llama.cpp where the relay
  cannot see or time them. Verified: max 1 concurrent upstream embedding call under load.
- **Raising `WORKER_CONCURRENCY` above 1 only affects prompts**, and needs generative `--parallel`
  raised to match — which costs memory again. On 16 GB, leave both at 1.
- **A single embedding input must fit the embedding backend's `--ctx-size`** (8192 here). Beyond it
  llama.cpp answers `400 request (N tokens) exceeds the available context size (8192 tokens)`, and
  the job fails terminally. Chunk long documents before enqueueing. Batching many chunks into one
  `input` array is fine — each entry is embedded separately, so only the longest single entry has to
  fit.
- **`GET /health` returns 503 when either backend is down**, so a crashed embedding server surfaces
  immediately rather than silently failing jobs.

## If you need the full 131072 context

Options, roughly in order of preference:

1. Run the embedding model on CPU: `--n-gpu-layers 0` on the 8081 server. It is a 4B model and
   embedding is a single forward pass, so the latency cost is modest and it stops competing for GPU
   memory entirely.
2. Raise the Metal budget: `sudo sysctl iogpu.wired_limit_mb=<mb>`. Unset it defaults to roughly 75%
   of RAM (~12 GB of 16 GB). Raising it starves the OS, so treat it as a last resort.
3. Use a smaller generative quant to buy back headroom.
4. Keep the two models on separate machines and point `GENERATIVE_URL` / `EMBEDDING_URL` at each.

import { config as load } from 'dotenv';
import envVar from 'env-var';

import type { UpstreamConfig } from './modelInfo';

load({ quiet: true });

function requireMin(value: number, name: string, min: number): number {
  if (value < min) throw new Error(`${name} must be at least ${min}, got ${value}`);
  return value;
}

// Manual fallback for upstreams whose /models response carries no meta.n_ctx (e.g. Scaleway) — see
// UpstreamConfig.contextSize in modelInfo.ts, which only consults this when the live value is absent.
function parseOptionalContextSize(name: string): number | undefined {
  const raw = envVar.get(name).default('').asString();
  return raw ? requireMin(envVar.get(name).required().asIntPositive(), name, 1) : undefined;
}

export const config = {
  log: {
    level: envVar.get('LOG_LEVEL').default('info').asEnum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
  },
  http: {
    port: requireMin(envVar.get('PORT').default(3000).asPortNumber(), 'PORT', 1),
    apiKey: envVar.get('API_KEY').default('').asString()
  },
  database: {
    filename: envVar.get('DATABASE_FILENAME').default('./database.sqlite').asString()
  },
  // Typed against UpstreamConfig (contextSize optional) rather than left as a plain inferred literal,
  // so code and tests can still build a generative/embedding config without setting contextSize.
  generative: {
    url: envVar.get('GENERATIVE_URL').default('http://localhost:8080/v1').asUrlString(),
    model: envVar.get('GENERATIVE_MODEL').default('').asString(),
    key: envVar.get('GENERATIVE_KEY').default('none').asString(),
    contextSize: parseOptionalContextSize('GENERATIVE_CONTEXTSIZE')
  } as UpstreamConfig,
  // undefined means embedding support is disabled — every embedding guard keys off this union, so
  // the relay runs unchanged with a generative backend alone.
  embedding: (() => {
    // asUrlString() throws on an empty value, so the presence check has to read the raw string first.
    if (!envVar.get('EMBEDDING_URL').default('').asString()) return;
    return {
      url: envVar.get('EMBEDDING_URL').required().asUrlString(),
      model: envVar.get('EMBEDDING_MODEL').default('').asString(),
      key: envVar.get('EMBEDDING_KEY').default('none').asString(),
      contextSize: parseOptionalContextSize('EMBEDDING_CONTEXTSIZE')
    } as UpstreamConfig;
  })(),
  // Shared by both upstreams — they are the same kind of backend and there is no reason to tune
  // timeouts or retry budgets per model.
  upstream: {
    timeout: requireMin(envVar.get('UPSTREAM_TIMEOUT').default(10_000).asInt(), 'UPSTREAM_TIMEOUT', 100),
    maxRetryCount: requireMin(
      envVar.get('UPSTREAM_MAX_RETRY_COUNT').default(10).asInt(),
      'UPSTREAM_MAX_RETRY_COUNT',
      0
    ),
    modelCacheTtlMs:
      requireMin(
        envVar.get('UPSTREAM_MODEL_CACHE_TTL_SECONDS').default(60).asIntPositive(),
        'UPSTREAM_MODEL_CACHE_TTL_SECONDS',
        1
      ) * 1000
  },
  // Reasoning/thinking control for the generative upstream. Deliberately not part of the
  // `generative` block above: that is typed as UpstreamConfig, which `embedding` shares, and
  // reasoning is meaningless for an embedding backend.
  //
  // Unset means 'none' — thinking off. A llama.cpp deployment says this with server flags
  // (--reasoning off), but a hosted backend has none, so this request parameter is the only place
  // to say it; and a reasoning loop that repeats the same passage until the output budget runs out
  // is a failure mode, not something a deployment should have to opt out of. 'default' omits the
  // parameter entirely and leaves the decision to the backend — what a llama.cpp deployment that
  // already configures --reasoning itself wants.
  reasoning: {
    effort: envVar
      .get('GENERATIVE_REASONING_EFFORT')
      .default('none')
      .asEnum(['none', 'minimal', 'low', 'medium', 'high', 'default'])
  },
  worker: {
    concurrency: Math.min(envVar.get('WORKER_CONCURRENCY').default(1).asIntPositive(), 16)
  },
  callback: {
    urlAllowlist: (() => {
      const raw = envVar.get('CALLBACK_URL_ALLOWLIST').default('').asString();
      if (!raw) return;
      try {
        return new RegExp(raw);
      } catch {
        throw new Error(`CALLBACK_URL_ALLOWLIST is not a valid regex: "${raw}"`);
      }
    })(),
    retryTtlHours: requireMin(
      envVar.get('CALLBACK_RETRY_TTL_HOURS').default(24).asInt(),
      'CALLBACK_RETRY_TTL_HOURS',
      1
    ),
    hmacSecret: envVar.get('CALLBACK_HMAC_SECRET').default('').asString()
  }
};

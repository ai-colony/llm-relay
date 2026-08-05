import { config as load } from 'dotenv';
import envVar from 'env-var';

load({ quiet: true });

function requireMin(value: number, name: string, min: number): number {
  if (value < min) throw new Error(`${name} must be at least ${min}, got ${value}`);
  return value;
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
  generative: {
    url: envVar.get('GENERATIVE_URL').default('http://localhost:8080/v1').asUrlString(),
    model: envVar.get('GENERATIVE_MODEL').default('').asString(),
    key: envVar.get('GENERATIVE_KEY').default('none').asString()
  },
  // undefined means embedding support is disabled — every embedding guard keys off this union, so
  // the relay runs unchanged with a generative backend alone.
  embedding: (() => {
    // asUrlString() throws on an empty value, so the presence check has to read the raw string first.
    if (!envVar.get('EMBEDDING_URL').default('').asString()) return;
    return {
      url: envVar.get('EMBEDDING_URL').required().asUrlString(),
      model: envVar.get('EMBEDDING_MODEL').default('').asString(),
      key: envVar.get('EMBEDDING_KEY').default('none').asString()
    };
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

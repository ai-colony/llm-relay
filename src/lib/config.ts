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
  openai: {
    url: envVar.get('OPENAI_URL').default('http://localhost:8080/v1').asUrlString(),
    model: envVar.get('OPENAI_MODEL').default('').asString(),
    key: envVar.get('OPENAI_KEY').default('none').asString(),
    timeout: requireMin(envVar.get('OPENAI_TIMEOUT').default(10_000).asInt(), 'OPENAI_TIMEOUT', 100),
    maxRetryCount: requireMin(envVar.get('OPENAI_MAX_RETRY_COUNT').default(10).asInt(), 'OPENAI_MAX_RETRY_COUNT', 0),
    modelCacheTtlMs:
      requireMin(
        envVar.get('OPENAI_MODEL_CACHE_TTL_SECONDS').default(60).asIntPositive(),
        'OPENAI_MODEL_CACHE_TTL_SECONDS',
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

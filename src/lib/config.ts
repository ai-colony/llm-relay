import { config as load } from 'dotenv';
import envVar from 'env-var';

load({ quiet: true });

export const config = {
  log: {
    level: envVar.get('LOG_LEVEL').default('info').asString()
  },
  http: {
    port: envVar.get('PORT').default(3000).asInt(),
    apiKey: envVar.get('API_KEY').default('').asString()
  },
  database: {
    filename: envVar.get('DATABASE_FILENAME').default('./database.sqlite').asString()
  },
  openai: {
    url: envVar.get('OPENAI_URL').default('http://localhost:8080/v1').asString(),
    model: envVar.get('OPENAI_MODEL').default('').asString(),
    key: envVar.get('OPENAI_KEY').default('none').asString(),
    timeout: envVar.get('OPENAI_TIMEOUT').default(10_000).asInt(),
    maxRetryCount: envVar.get('OPENAI_MAX_RETRY_COUNT').default(10).asInt()
  },
  worker: {
    concurrency: Math.min(envVar.get('WORKER_CONCURRENCY').default(1).asIntPositive(), 16)
  }
};

import { structuredLogger } from '@hono/structured-logger';
import { config, logger } from '@lib';
import { Hono } from 'hono';

import { createAuthMiddleware } from './auth';
import { chat } from './chat';
import { health } from './health';
import { httpMetrics } from './httpMetrics';
import { metrics } from './metrics';
import { openapi } from './openapi';
import { prompt } from './prompt';
import { status } from './status';

const auth = createAuthMiddleware(config.http.apiKey);

export const app = new Hono()
  .onError((error, c) => {
    logger.error({ component: 'http', error }, 'Unhandled route error');
    return c.json({ success: false, error: 'Internal server error', path: c.req.path, method: c.req.method }, 500);
  })
  .use(httpMetrics)
  .use(
    structuredLogger({
      createLogger: () => logger,
      onRequest: (log, c) => log.debug({ component: 'http', method: c.req.method, path: c.req.path }, 'request start'),
      onResponse: (log, c, elapsedMs) =>
        log.debug(
          { component: 'http', method: c.req.method, path: c.req.path, status: c.res.status, elapsedMs },
          'request end'
        )
    })
  )
  .use('/prompt/*', auth)
  .use('/chat/*', auth)
  .route('/', openapi)
  .route('/health', health)
  .route('/metrics', metrics)
  .route('/status', status)
  .route('/prompt', prompt)
  .route('/chat', chat);

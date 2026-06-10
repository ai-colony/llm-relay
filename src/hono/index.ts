import { structuredLogger } from '@hono/structured-logger';
import { logger } from '@lib';
import { Hono } from 'hono';

import { health } from './health';
import { metrics } from './metrics';
import { openapi } from './openapi';
import { prompt } from './prompt';
import { status } from './status';

export const app = new Hono()
  .onError((error, c) => {
    logger.error({ component: 'http', error }, 'Unhandled route error');
    return c.json({ success: false, error: 'Internal server error' }, 500);
  })
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
  .route('/', openapi)
  .route('/health', health)
  .route('/metrics', metrics)
  .route('/status', status)
  .route('/prompt', prompt);

import { structuredLogger } from '@hono/structured-logger';
import { logger } from '@lib';
import { Hono } from 'hono';

import { health } from './health';
import { prompt } from './prompt';
import { status } from './status';

export const app = new Hono()
  .onError((error, c) => {
    logger.error({ error }, 'Unhandled route error');
    return c.json({ success: false, error: 'Internal server error' }, 500);
  })
  .use(
    structuredLogger({
      createLogger: () => logger,
      onRequest: (log, c) => log.debug({ method: c.req.method, path: c.req.path }, 'request start'),
      onResponse: (log, c, elapsedMs) =>
        log.debug({ method: c.req.method, path: c.req.path, status: c.res.status, elapsedMs }, 'request end')
    })
  )
  .route('/health', health)
  .route('/status', status)
  .route('/prompt', prompt);

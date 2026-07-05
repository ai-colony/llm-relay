import { structuredLogger } from '@hono/structured-logger';
import { config, incCounter, logger, observeHistogram } from '@lib';
import { Hono } from 'hono';

import { createAuthMiddleware } from './auth';
import { chat } from './chat';
import { health } from './health';
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
  .use(async (c, next) => {
    const startedAt = performance.now();
    await next();
    const durationSeconds = (performance.now() - startedAt) / 1000;
    incCounter('http_requests_total', 'Total HTTP requests', {
      method: c.req.method,
      path: c.req.path,
      status: String(c.res.status)
    });
    observeHistogram(
      'http_request_duration_seconds',
      'HTTP request duration in seconds',
      { method: c.req.method, path: c.req.path },
      durationSeconds
    );
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
  .use('/prompt/*', auth)
  .use('/chat/*', auth)
  .route('/', openapi)
  .route('/health', health)
  .route('/metrics', metrics)
  .route('/status', status)
  .route('/prompt', prompt)
  .route('/chat', chat);

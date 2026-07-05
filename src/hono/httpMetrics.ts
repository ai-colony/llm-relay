import { incCounter, observeHistogram } from '@lib';
import type { MiddlewareHandler } from 'hono';

const EXCLUDED_PATHS = new Set(['/health', '/status', '/metrics', '/openapi.json', '/docs', '/favicon.ico']);

export const httpMetrics: MiddlewareHandler = async (c, next) => {
  const startedAt = performance.now();
  await next();
  if (EXCLUDED_PATHS.has(c.req.path)) return;

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
};

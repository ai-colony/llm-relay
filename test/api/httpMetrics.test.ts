import { Hono } from 'hono';

import { httpMetrics } from '../../src/hono/httpMetrics';
import { renderMetrics, resetMetrics } from '../../src/lib/metrics';

function makeApp() {
  return new Hono()
    .use('/*', httpMetrics)
    .get('/health', (c) => c.json({ ok: true }))
    .get('/status', (c) => c.json({ ok: true }))
    .get('/metrics', (c) => c.text(''))
    .get('/openapi.json', (c) => c.json({ ok: true }))
    .get('/docs', (c) => c.html('<html></html>'))
    .get('/favicon.ico', (c) => c.body(null, 404))
    .get('/prompt/list', (c) => c.json({ ok: true }));
}

describe('httpMetrics middleware', () => {
  beforeEach(() => resetMetrics());

  it.each(['/health', '/status', '/metrics', '/openapi.json', '/docs', '/favicon.ico'])(
    'does not record metrics for excluded path %s',
    async (path) => {
      const app = makeApp();
      await app.request(path);

      const body = renderMetrics();
      expect(body).not.toContain('http_requests_total');
      expect(body).not.toContain('http_request_duration_seconds');
    }
  );

  it('records http_requests_total and http_request_duration_seconds for a real endpoint', async () => {
    const app = makeApp();
    await app.request('/prompt/list');

    const body = renderMetrics();
    expect(body).toContain('http_requests_total{method="GET",path="/prompt/list",status="200"} 1');
    expect(body).toContain('http_request_duration_seconds_count{method="GET",path="/prompt/list"} 1');
  });
});

import { Hono } from 'hono';

import { createAuthMiddleware } from '../../src/hono/auth';

function makeApp(apiKey: string) {
  return new Hono().use('/*', createAuthMiddleware(apiKey)).get('/test', (c) => c.json({ success: true }));
}

describe('createAuthMiddleware', () => {
  describe('when no API key is configured', () => {
    it('passes all requests through', async () => {
      const app = makeApp('');
      const response = await app.request('/test');
      expect(response.status).toBe(200);
    });
  });

  describe('when an API key is configured', () => {
    const app = makeApp('secret');

    it('returns 401 when Authorization header is missing', async () => {
      const response = await app.request('/test');
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toEqual({ success: false, error: 'Unauthorized' });
    });

    it('returns 401 when the token is wrong', async () => {
      const response = await app.request('/test', { headers: { Authorization: 'Bearer wrong' } });
      expect(response.status).toBe(401);
    });

    it('returns 401 when the scheme is not Bearer', async () => {
      const response = await app.request('/test', { headers: { Authorization: 'Basic secret' } });
      expect(response.status).toBe(401);
    });

    it('passes through with the correct Bearer token', async () => {
      const response = await app.request('/test', { headers: { Authorization: 'Bearer secret' } });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ success: true });
    });
  });
});

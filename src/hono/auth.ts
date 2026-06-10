import type { MiddlewareHandler } from 'hono';

export const createAuthMiddleware =
  (apiKey: string): MiddlewareHandler =>
  async (c, next) => {
    if (!apiKey) return next();
    if (c.req.header('Authorization') !== `Bearer ${apiKey}`)
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    return next();
  };

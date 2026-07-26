import { logger } from '@lib';
import type { MiddlewareHandler } from 'hono';

import { jsonError } from './errors';

export const createAuthMiddleware =
  (apiKey: string): MiddlewareHandler =>
  async (c, next) => {
    if (!apiKey) return next();
    if (c.req.header('Authorization') !== `Bearer ${apiKey}`) {
      logger.warn({ component: 'http', path: c.req.path }, 'Unauthorized request');
      return jsonError(c, 401, 'Unauthorized');
    }
    return next();
  };

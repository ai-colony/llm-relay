import { findEmbeddingsByClientName } from '@embedding/repo';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { ListQuerySchema } from './schemas';

export const list = new Hono().get('/', zValidator('query', ListQuerySchema), async (c) => {
  const { clientName, status } = c.req.valid('query');
  const rows = await findEmbeddingsByClientName(clientName, status);
  return c.json(rows, 200);
});

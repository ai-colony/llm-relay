import { zValidator } from '@hono/zod-validator';
import { findPromptsByClientName } from '@prompt/repo';
import { Hono } from 'hono';

import { ListQuerySchema } from './schemas';

export const list = new Hono().get('/', zValidator('query', ListQuerySchema), async (c) => {
  const { clientName, status } = c.req.valid('query');
  const rows = await findPromptsByClientName(clientName, status);
  return c.json(rows, 200);
});

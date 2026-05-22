import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { findPromptsByClientName } from '../../prompt/repository';

const QuerySchema = z.object({
  clientName: z.string(),
  status: z.enum(['queued', 'in_progress', 'completed', 'failed', 'failed_retry']).optional()
});

export const list = new Hono().get('/', zValidator('query', QuerySchema), async (c) => {
  const { clientName, status } = c.req.valid('query');
  const rows = await findPromptsByClientName(clientName, status);
  return c.json(rows, 200);
});

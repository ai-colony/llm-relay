import { zValidator } from '@hono/zod-validator';
import { purgeCompletedPrompts } from '@prompt/repo';
import { Hono } from 'hono';

import { PurgeQuerySchema } from './schemas';

export const purge = new Hono().delete('/', zValidator('query', PurgeQuerySchema), async (c) => {
  const { clientName, days } = c.req.valid('query');
  const deleted = await purgeCompletedPrompts({ clientName, olderThanDays: days });
  return c.json({ success: true, deleted }, 200);
});

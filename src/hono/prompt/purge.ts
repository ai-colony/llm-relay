import { zValidator } from '@hono/zod-validator';
import { purgeCompletedPrompts } from '@prompt/repository';
import { Hono } from 'hono';
import { z } from 'zod';

const QuerySchema = z.object({
  clientName: z.string().optional(),
  days: z.coerce.number().int().min(1).default(7)
});

export const purge = new Hono().delete('/', zValidator('query', QuerySchema), async (c) => {
  const { clientName, days } = c.req.valid('query');
  const deleted = await purgeCompletedPrompts(days, clientName);
  return c.json({ success: true, deleted }, 200);
});

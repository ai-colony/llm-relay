import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { getPromptStatusCounts } from '../../prompt/repository';
import { createPrompt } from '../../prompt/service';

const BodySchema = z.object({
  clientName: z.string(),
  requestId: z.number().int().positive(),
  callbackUrl: z.string().url().optional(),
  systemPrompt: z.string().optional(),
  userPrompt: z.string(),
  temperature: z.number().min(0).max(2)
});

const ResponseSchema = z.object({
  success: z.boolean(),
  queued: z.number()
});
type ResponseSchema = z.infer<typeof ResponseSchema>;

export const add = new Hono().post('/', zValidator('json', BodySchema), async (c) => {
  const data = c.req.valid('json');
  await createPrompt(data);
  const counts = await getPromptStatusCounts();
  return c.json({ success: true, queued: counts.queued } satisfies ResponseSchema, 201);
});

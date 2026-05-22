import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { findPromptByClientNameAndRequestId } from '../../prompt/repository';

const QuerySchema = z.object({
  clientName: z.string(),
  requestId: z.coerce.number().int().positive()
});

const ResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['queued', 'in_progress', 'failed_retry']) }),
  z.object({ status: z.literal('failed'), statusError: z.string().nullable() }),
  z.object({
    status: z.literal('completed'),
    reasoning: z.string().nullable(),
    response: z.string().nullable(),
    reasoningTimeMs: z.number().nullable(),
    reasoningTokenPerSecond: z.number().nullable(),
    responseTimeMs: z.number().nullable(),
    responseTokenPerSecond: z.number().nullable()
  })
]);
type ResponseSchema = z.infer<typeof ResponseSchema>;

export const get = new Hono().get('/', zValidator('query', QuerySchema), async (c) => {
  const { clientName, requestId } = c.req.valid('query');
  const [prompt] = await findPromptByClientNameAndRequestId(clientName, requestId);

  if (!prompt) return c.json({ success: false, error: 'Prompt not found' }, 404);

  if (prompt.status === 'completed')
    return c.json(
      {
        status: prompt.status,
        reasoning: prompt.reasoning,
        response: prompt.response,
        reasoningTimeMs: prompt.reasoningTimeMs,
        reasoningTokenPerSecond: prompt.reasoningTokenPerSecond,
        responseTimeMs: prompt.responseTimeMs,
        responseTokenPerSecond: prompt.responseTokenPerSecond
      } satisfies ResponseSchema,
      200
    );

  if (prompt.status === 'failed')
    return c.json({ status: prompt.status, statusError: prompt.statusError } satisfies ResponseSchema, 200);

  return c.json({ status: prompt.status } satisfies ResponseSchema, 200);
});

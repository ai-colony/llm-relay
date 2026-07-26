import { zValidator } from '@hono/zod-validator';
import { CANCELLABLE_STATUSES, deletePromptByKey, findPromptStatusByKey } from '@prompt/repo';
import { Hono } from 'hono';

import { jsonError } from '../errors';
import { PromptKeyQuerySchema } from './schemas';

export const cancel = new Hono().delete('/', zValidator('query', PromptKeyQuerySchema), async (c) => {
  const { clientName, requestId } = c.req.valid('query');
  const prompt = await findPromptStatusByKey(clientName, requestId);

  if (!prompt) return jsonError(c, 404, 'Prompt not found');

  if (prompt.status === 'in_progress' || prompt.status === 'completed')
    return jsonError(c, 409, `Cannot cancel a prompt with status '${prompt.status}'`);

  await deletePromptByKey(clientName, requestId, CANCELLABLE_STATUSES);
  return c.json({ success: true }, 200);
});

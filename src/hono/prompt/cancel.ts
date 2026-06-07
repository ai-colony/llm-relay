import { zValidator } from '@hono/zod-validator';
import { deletePromptByClientNameAndRequestId, findPromptByClientNameAndRequestId } from '@prompt/repository';
import { Hono } from 'hono';

import { QuerySchema } from './schemas';

export const cancel = new Hono().delete('/', zValidator('query', QuerySchema), async (c) => {
  const { clientName, requestId } = c.req.valid('query');
  const [prompt] = await findPromptByClientNameAndRequestId(clientName, requestId);

  if (!prompt) return c.json({ success: false, error: 'Prompt not found' }, 404);

  if (prompt.status === 'in_progress' || prompt.status === 'completed')
    return c.json({ success: false, error: `Cannot cancel a prompt with status '${prompt.status}'` }, 409);

  await deletePromptByClientNameAndRequestId(clientName, requestId);
  return c.json({ success: true }, 200);
});

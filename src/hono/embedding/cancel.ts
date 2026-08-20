import { CANCELLABLE_STATUSES, deleteEmbeddingByKey, findEmbeddingStatusByKey } from '@embedding/repo';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { jsonError } from '../errors';
import { EmbeddingKeyQuerySchema } from './schemas';

export const cancel = new Hono().delete('/', zValidator('query', EmbeddingKeyQuerySchema), async (c) => {
  const { clientName, requestId } = c.req.valid('query');
  const embedding = await findEmbeddingStatusByKey(clientName, requestId);

  if (!embedding) return jsonError(c, 404, 'Embedding not found');

  if (embedding.status === 'in_progress' || embedding.status === 'completed')
    return jsonError(c, 409, `Cannot cancel an embedding with status '${embedding.status}'`);

  await deleteEmbeddingByKey(clientName, requestId, CANCELLABLE_STATUSES);
  return c.json({ success: true }, 200);
});

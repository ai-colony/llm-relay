import { isUniqueConstraintError } from '@db';
import {
  addEmbedding,
  countQueuedEmbeddings,
  deleteEmbeddingByKey,
  findEmbeddingStatusByKey,
  OVERWRITABLE_STATUSES
} from '@embedding/repo';
import { zValidator } from '@hono/zod-validator';
import { checkCallbackAvailability } from '@lib';
import { Hono } from 'hono';

import { jsonError } from '../errors';
import { AddEmbeddingBodySchema, toInputArray } from './schemas';

type AddEmbeddingResponse = { success: true; queued: number };

export const add = new Hono().post('/', zValidator('json', AddEmbeddingBodySchema), async (c) => {
  const data = c.req.valid('json');

  if (data.overwrite) {
    const existing = await findEmbeddingStatusByKey(data.clientName, data.requestId);
    if (existing) {
      if (existing.status === 'in_progress')
        return jsonError(c, 409, 'Cannot overwrite an embedding that is currently in progress');
      await deleteEmbeddingByKey(data.clientName, data.requestId, OVERWRITABLE_STATUSES);
    }
  }

  // Probed after the overwrite check so a request destined for a 409 does not pay the HEAD timeout.
  if (data.callbackUrl && !(await checkCallbackAvailability(data.callbackUrl)))
    return jsonError(c, 503, 'callbackUrl is not available');

  try {
    await addEmbedding({ ...data, input: toInputArray(data.input) });
  } catch (error) {
    if (isUniqueConstraintError(error))
      return jsonError(c, 409, 'An embedding with this clientName and requestId already exists');
    throw error;
  }
  const queued = await countQueuedEmbeddings();
  return c.json({ success: true, queued } satisfies AddEmbeddingResponse, 201);
});

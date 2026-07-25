import { isUniqueConstraintError } from '@db';
import { zValidator } from '@hono/zod-validator';
import { checkCallbackAvailability } from '@lib';
import {
  addPrompt,
  countQueuedPrompts,
  deletePromptByKey,
  findPromptStatusByKey,
  OVERWRITABLE_STATUSES
} from '@prompt/repo';
import { Hono } from 'hono';

import { jsonError } from '../errors';
import { AddPromptBodySchema } from './schemas';

type AddPromptResponse = { success: true; queued: number };

export const add = new Hono().post('/', zValidator('json', AddPromptBodySchema), async (c) => {
  const data = c.req.valid('json');

  if (data.overwrite) {
    const existing = await findPromptStatusByKey(data.clientName, data.requestId);
    if (existing) {
      if (existing.status === 'in_progress')
        return jsonError(c, 409, 'Cannot overwrite a prompt that is currently in progress');
      await deletePromptByKey(data.clientName, data.requestId, OVERWRITABLE_STATUSES);
    }
  }

  // Probed after the overwrite check so a request destined for a 409 does not pay the HEAD timeout.
  if (data.callbackUrl && !(await checkCallbackAvailability(data.callbackUrl)))
    return jsonError(c, 503, 'callbackUrl is not available');

  try {
    await addPrompt(data);
  } catch (error) {
    if (isUniqueConstraintError(error))
      return jsonError(c, 409, 'A prompt with this clientName and requestId already exists');
    throw error;
  }
  const queued = await countQueuedPrompts();
  return c.json({ success: true, queued } satisfies AddPromptResponse, 201);
});

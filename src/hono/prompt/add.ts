import type { SqliteError } from '@db';
import { SQLITE_CONSTRAINT_UNIQUE } from '@db';
import { zValidator } from '@hono/zod-validator';
import { checkCallbackAvailability, isCallbackUrlAllowed } from '@lib';
import { countQueuedPrompts, deletePromptForOverwrite, findPromptByClientNameAndRequestId } from '@prompt/repo';
import { createPrompt } from '@prompt/service';
import { Hono } from 'hono';
import { z } from 'zod';

const BodySchema = z.object({
  clientName: z.string().min(1),
  requestId: z.string().min(1),
  callbackUrl: z
    .string()
    .url()
    .refine(isCallbackUrlAllowed, { message: 'callbackUrl is not in the allowlist' })
    .optional(),
  systemPrompt: z.string().optional(),
  userPrompt: z.string().min(1),
  temperature: z.number().min(0).max(2),
  priority: z.number().int().min(0).optional().default(0),
  overwrite: z.boolean().optional().default(false)
});

const ResponseSchema = z.object({
  success: z.boolean(),
  queued: z.number()
});
type ResponseSchema = z.infer<typeof ResponseSchema>;

export const add = new Hono().post('/', zValidator('json', BodySchema), async (c) => {
  const data = c.req.valid('json');

  if (data.callbackUrl && !(await checkCallbackAvailability(data.callbackUrl)))
    return c.json({ success: false, error: 'callbackUrl is not available' }, 503);

  if (data.overwrite) {
    const [existing] = await findPromptByClientNameAndRequestId(data.clientName, data.requestId);
    if (existing) {
      if (existing.status === 'in_progress')
        return c.json({ success: false, error: 'Cannot overwrite a prompt that is currently in progress' }, 409);
      await deletePromptForOverwrite(data.clientName, data.requestId);
    }
  }

  try {
    await createPrompt(data);
  } catch (error) {
    if (
      error instanceof Error &&
      (error as SqliteError).code === 'ERR_SQLITE_ERROR' &&
      (error as SqliteError).errcode === SQLITE_CONSTRAINT_UNIQUE
    )
      return c.json({ success: false, error: 'A prompt with this clientName and requestId already exists' }, 409);
    throw error;
  }
  const queued = await countQueuedPrompts();
  return c.json({ success: true, queued } satisfies ResponseSchema, 201);
});

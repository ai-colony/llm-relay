import { Hono } from 'hono';

import { getPromptStatusCounts } from '../prompt/repository';

export const status = new Hono().get('/', async (c) => {
  const counts = await getPromptStatusCounts();
  return c.json({
    uptime: Math.floor(process.uptime()),
    queued: counts.queued,
    pending: counts.pending,
    completed: counts.completed,
    failed: counts.failed,
    callbackPending: counts.callbackPending
  });
});

import { Hono } from 'hono';

import { version } from '../../package.json';
import { getPromptStatusCounts } from '../prompt/repository';

export const status = new Hono().get('/', async (c) => {
  const counts = await getPromptStatusCounts();
  return c.json({
    version,
    uptime: Math.floor(process.uptime()),
    queued: counts.queued,
    pending: counts.pending,
    completed: counts.completed,
    failed: counts.failed,
    callbackPending: counts.callbackPending
  });
});

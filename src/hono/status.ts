import { getModelInfo } from '@lib';
import { getPromptStatusCounts } from '@prompt/repo';
import { Hono } from 'hono';

import { version } from '../../package.json';

export const status = new Hono().get('/', async (c) => {
  const [counts, modelInfo] = await Promise.all([
    getPromptStatusCounts(),
    getModelInfo().catch(() => ({ model: undefined, contextSize: undefined }))
  ]);
  return c.json({
    version,
    uptime: Math.floor(process.uptime()),
    model: modelInfo.model,
    contextSize: modelInfo.contextSize,
    queued: counts.queued,
    pending: counts.pending,
    completed: counts.completed,
    failed: counts.failed,
    callbackPending: counts.callbackPending
  });
});

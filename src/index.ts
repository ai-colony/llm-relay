import { serve } from '@hono/node-server';
import { config, logger } from '@lib';

import { app } from './hono';
import { processCallbackPendingPrompts, processQueuedPrompts } from './prompt/service';

serve({
  fetch: app.fetch,
  port: config.http.port
});
logger.info(`Server running on port ${config.http.port}`);

const workerThread = async () => {
  await processQueuedPrompts();
  await processCallbackPendingPrompts();
  setImmediate(workerThread);
};
setImmediate(workerThread);

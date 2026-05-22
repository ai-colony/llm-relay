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
  try {
    await processQueuedPrompts();
    await processCallbackPendingPrompts();
  } catch (error) {
    logger.error({ error }, 'Worker thread error');
  }
  await new Promise((r) => setTimeout(r, 100));
  setImmediate(workerThread);
};
setImmediate(workerThread);

const shutdown = () => {
  logger.info('Shutting down...');
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

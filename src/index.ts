import { serve } from '@hono/node-server';
import { config, logger } from '@lib';

import { app } from './hono';
import { resetInProgressPrompts } from './prompt/repository';
import { processCallbackPendingPrompts, processQueuedPrompts } from './prompt/service';

const server = serve({
  fetch: app.fetch,
  port: config.http.port
});
logger.info(`Server running on port ${config.http.port}`);

// Reset any prompts stuck as in_progress from a previous unclean shutdown
await resetInProgressPrompts();

let shuttingDown = false;

const workerThread = async () => {
  try {
    await processQueuedPrompts();
    await processCallbackPendingPrompts();
  } catch (error) {
    logger.error({ error }, 'Worker thread error');
  }
  if (!shuttingDown) {
    await new Promise((r) => setTimeout(r, 100));
    setImmediate(workerThread);
  }
};
setImmediate(workerThread);

const shutdown = () => {
  if (shuttingDown) return;
  logger.info('Shutting down...');
  shuttingDown = true;
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

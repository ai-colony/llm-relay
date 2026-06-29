import { closeDatabase, database } from '@db';
import { serve } from '@hono/node-server';
import { config, logger } from '@lib';
import { getPromptStatusCounts, resetInProgressPrompts } from '@prompt/repo';
import { processCallbackPendingPrompts, processQueuedPrompts } from '@prompt/service';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';

import { app } from './hono';

try {
  await migrate(database.dbClient, { migrationsFolder: './drizzle' });
} catch (error) {
  logger.error({ component: 'server', error }, 'Migration failed');
  process.exit(1);
}

const server = serve({
  fetch: app.fetch,
  port: config.http.port
});
logger.info({ component: 'server', port: config.http.port }, 'Server running');

// Reset any prompts stuck as in_progress from a previous unclean shutdown
await resetInProgressPrompts();
const startupCounts = await getPromptStatusCounts();
logger.info({ component: 'server', ...startupCounts }, 'DB status on startup');

let isShuttingDown = false;

const { promise: workerDone, resolve: workerDoneResolve } = Promise.withResolvers<void>();

const workerThread = async () => {
  try {
    await processQueuedPrompts();
    await processCallbackPendingPrompts();
  } catch (error) {
    logger.error({ component: 'server', error }, 'Worker thread error');
  }
  if (isShuttingDown) {
    workerDoneResolve();
    return;
  }
  await new Promise((r) => setTimeout(r, 100));
  setImmediate(workerThread);
};
setImmediate(workerThread);

const shutdown = async () => {
  if (isShuttingDown) return;
  logger.info({ component: 'server' }, 'Shutting down...');
  isShuttingDown = true;

  await Promise.race([workerDone, new Promise<void>((r) => setTimeout(r, 15_000))]);

  await new Promise<void>((resolve) => server.close(() => resolve()));
  logger.info({ component: 'server' }, 'Server closed');

  closeDatabase();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

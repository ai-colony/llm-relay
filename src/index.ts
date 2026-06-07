import { database } from '@db';
import { serve } from '@hono/node-server';
import { config, logger } from '@lib';
import { getPromptStatusCounts, resetInProgressPrompts } from '@prompt/repository';
import { processCallbackPendingPrompts, processQueuedPrompts } from '@prompt/service';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { app } from './hono';

migrate(database.dbClient, { migrationsFolder: './drizzle' });

const server = serve({
  fetch: app.fetch,
  port: config.http.port
});
logger.info({ component: 'server', port: config.http.port }, 'Server running');

// Reset any prompts stuck as in_progress from a previous unclean shutdown
await resetInProgressPrompts();
const startupCounts = await getPromptStatusCounts();
logger.info({ component: 'server', ...startupCounts }, 'DB status on startup');

let shuttingDown = false;

const workerThread = async () => {
  try {
    await processQueuedPrompts();
    await processCallbackPendingPrompts();
  } catch (error) {
    logger.error({ component: 'server', error }, 'Worker thread error');
  }
  if (!shuttingDown) {
    await new Promise((r) => setTimeout(r, 100));
    setImmediate(workerThread);
  }
};
setImmediate(workerThread);

const shutdown = () => {
  if (shuttingDown) return;
  logger.info({ component: 'server' }, 'Shutting down...');
  shuttingDown = true;
  server.close(() => {
    logger.info({ component: 'server' }, 'Server closed');
    process.exit(0);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

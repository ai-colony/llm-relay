import { closeDatabase, database } from '@db';
import { getEmbeddingStatusCounts, resetInProgressEmbeddings } from '@embedding/repo';
import { processCallbackPendingEmbeddings, processQueuedEmbeddings } from '@embedding/service';
import { serve } from '@hono/node-server';
import { config, logger } from '@lib';
import { getPromptStatusCounts, resetInProgressPrompts } from '@prompt/repo';
import { processCallbackPendingPrompts, processQueuedPrompts } from '@prompt/service';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';

import { app } from './hono';

try {
  migrate(database.client, { migrationsFolder: './drizzle' });
} catch (error) {
  logger.error({ component: 'server', error }, 'Migration failed');
  process.exit(1);
}

// Reset any jobs stuck as in_progress from a previous unclean shutdown. Must happen before the
// port opens, otherwise GET /prompt/get can report a stale in_progress during the startup window.
await resetInProgressPrompts();
await resetInProgressEmbeddings();
const startupCounts = await getPromptStatusCounts();
const startupEmbeddingCounts = config.embedding ? await getEmbeddingStatusCounts() : undefined;
logger.info(
  { component: 'server', ...startupCounts, ...(startupEmbeddingCounts && { embedding: startupEmbeddingCounts }) },
  'DB status on startup'
);

const server = serve({
  fetch: app.fetch,
  port: config.http.port
});
logger.info({ component: 'server', port: config.http.port }, 'Server running');

let isShuttingDown = false;

const { promise: workerDone, resolve: workerDoneResolve } = Promise.withResolvers<void>();

const workerThread = async () => {
  try {
    // Independent of each other — they touch disjoint tables, so a slow callback batch or a slow
    // embedding run must not delay picking up queued prompts.
    await Promise.all([
      processQueuedPrompts(),
      processCallbackPendingPrompts(),
      processQueuedEmbeddings(),
      processCallbackPendingEmbeddings()
    ]);
  } catch (error) {
    logger.error({ component: 'server', error }, 'Worker thread error');
  }
  if (isShuttingDown) {
    workerDoneResolve();
    return;
  }
  setTimeout(() => void workerThread(), 100);
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

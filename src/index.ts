import { serve } from '@hono/node-server';

import { config } from './config';
import { database as database } from './db';
import { app } from './hono';
import { logger } from './logger';

serve({
  fetch: app.fetch,
  port: config.http.port
});
logger.info(`Server running on port ${config.http.port}`);

database.prompt.insert({ name: 'Oak', alive: true });
const rows = database.prompt.many();
for (const row of rows) console.dir(row, { depth: undefined });

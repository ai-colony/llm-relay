import { serve } from '@hono/node-server';

import { config } from './config';
import { database as database } from './db';
import { app } from './hono';

database.prompt.insert({ name: 'Oak', alive: true });
const rows = database.prompt.many();

serve({
  fetch: app.fetch,
  port: config.http.port
});

for (const row of rows) console.dir(row, { depth: undefined });

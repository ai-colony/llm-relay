import { serve } from '@hono/node-server';

import { config } from './config';
import { app } from './hono';
import { logger } from './logger';

serve({
  fetch: app.fetch,
  port: config.http.port
});
logger.info(`Server running on port ${config.http.port}`);

import { serve } from '@hono/node-server';

import { app } from './hono';
import { config } from './lib/config';
import { logger } from './lib/logger';

serve({
  fetch: app.fetch,
  port: config.http.port
});
logger.info(`Server running on port ${config.http.port}`);

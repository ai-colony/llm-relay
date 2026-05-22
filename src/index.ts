import { serve } from '@hono/node-server';
import { config, logger } from '@lib';

import { app } from './hono';

serve({
  fetch: app.fetch,
  port: config.http.port
});
logger.info(`Server running on port ${config.http.port}`);

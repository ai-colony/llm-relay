import { structuredLogger } from '@hono/structured-logger';
import { logger } from '@lib';
import { Hono } from 'hono';

import { health } from './health';
import { prompt } from './prompt';

export const app = new Hono()
  .use(structuredLogger({ createLogger: () => logger }))
  .route('/health', health)
  .route('/prompt', prompt);

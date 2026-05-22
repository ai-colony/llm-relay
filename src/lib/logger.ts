import pino from 'pino';

import { config } from './config';

export const logger = pino({
  name: 'llm-layer',
  level: config.log.level
});

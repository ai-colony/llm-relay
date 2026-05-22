import pino from 'pino';

import { config } from './config';

export const logger = pino({
  name: 'llm-relay',
  level: config.log.level
});

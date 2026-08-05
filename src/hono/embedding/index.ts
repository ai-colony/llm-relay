import { config } from '@lib';
import { Hono } from 'hono';

import { jsonError } from '../errors';
import { add } from './add';
import { cancel } from './cancel';
import { get } from './get';
import { list } from './list';
import { purge } from './purge';
import { run } from './run';

export const embedding = new Hono()
  // The embedding backend is optional. Without one every route here answers 503 rather than 404 —
  // the endpoint exists, it just is not enabled in this deployment.
  .use('*', async (c, next) => {
    if (!config.embedding) return jsonError(c, 503, 'Embedding backend is not configured');
    await next();
    return;
  })
  .route('/add', add)
  .route('/run', run)
  .route('/get', get)
  .route('/list', list)
  .route('/cancel', cancel)
  .route('/purge', purge);

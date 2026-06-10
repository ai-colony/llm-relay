import { Hono } from 'hono';

import { add } from './add';
import { cancel } from './cancel';
import { get } from './get';
import { list } from './list';
import { purge } from './purge';

export const prompt = new Hono()
  .route('/add', add)
  .route('/get', get)
  .route('/list', list)
  .route('/cancel', cancel)
  .route('/purge', purge);

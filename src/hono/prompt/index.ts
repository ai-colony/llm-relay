import { Hono } from 'hono';

import { add } from './add';

export const prompt = new Hono().route('/add', add);

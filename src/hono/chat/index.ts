import { Hono } from 'hono';

import { completions } from './completions';

export const chat = new Hono().route('/completions', completions);

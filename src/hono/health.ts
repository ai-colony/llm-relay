import { checkDatabase } from '@db';
import { checkOpenAI } from '@lib';
import { Hono } from 'hono';

export const health = new Hono().get('/', async (c) => {
  const [database, openai] = await Promise.all([checkDatabase(), checkOpenAI()]);
  const checks = { db: database, openai };
  const success = database.ok && openai.ok;
  return c.json({ success, checks }, success ? 200 : 503);
});

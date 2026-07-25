import { checkDatabase } from '@db';
import { checkOpenAI } from '@lib';
import { Hono } from 'hono';

export const health = new Hono().get('/', async (c) => {
  const [databaseCheck, openaiCheck] = await Promise.all([checkDatabase(), checkOpenAI()]);
  const checks = { db: databaseCheck, openai: openaiCheck };
  const isSuccess = databaseCheck.ok && openaiCheck.ok;
  return c.json({ success: isSuccess, checks }, isSuccess ? 200 : 503);
});

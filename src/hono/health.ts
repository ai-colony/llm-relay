import { checkDatabase } from '@db';
import { checkEmbedding, checkGenerative, config } from '@lib';
import { Hono } from 'hono';

export const health = new Hono().get('/', async (c) => {
  const databaseCheck = checkDatabase();
  // The embedding backend is optional — when it is not configured it contributes neither a check
  // entry nor a failure, so an unconfigured relay reports exactly what it always did.
  const [generativeCheck, embeddingCheck] = await Promise.all([
    checkGenerative(),
    config.embedding ? checkEmbedding() : undefined
  ]);
  const checks = {
    db: databaseCheck,
    generative: generativeCheck,
    ...(embeddingCheck && { embedding: embeddingCheck })
  };
  const isSuccess = databaseCheck.ok && generativeCheck.ok && (embeddingCheck?.ok ?? true);
  return c.json({ success: isSuccess, checks }, isSuccess ? 200 : 503);
});

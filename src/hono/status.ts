import { getEmbeddingStatusCounts } from '@embedding/repo';
import { config, getEmbeddingModelInfo, getGenerativeModelInfo } from '@lib';
import { getPromptStatusCounts } from '@prompt/repo';
import { Hono } from 'hono';

import { version } from '../../package.json';

// A model lookup hitting a dead backend must not turn /status into a 500 — it is the endpoint you
// reach for precisely when something is down.
const UNKNOWN_MODEL = { model: undefined, contextSize: undefined };

const loadEmbeddingStatus = async () => {
  const [counts, modelInfo] = await Promise.all([
    getEmbeddingStatusCounts(),
    getEmbeddingModelInfo().catch(() => UNKNOWN_MODEL)
  ]);
  return { model: modelInfo.model, contextSize: modelInfo.contextSize, ...counts };
};

export const status = new Hono().get('/', async (c) => {
  const [counts, modelInfo, embedding] = await Promise.all([
    getPromptStatusCounts(),
    getGenerativeModelInfo().catch(() => UNKNOWN_MODEL),
    config.embedding ? loadEmbeddingStatus() : undefined
  ]);
  return c.json({
    version,
    uptime: Math.floor(process.uptime()),
    model: modelInfo.model,
    contextSize: modelInfo.contextSize,
    queued: counts.queued,
    inProgress: counts.inProgress,
    completed: counts.completed,
    failed: counts.failed,
    callbackPending: counts.callbackPending,
    // Omitted entirely when no embedding backend is configured.
    embedding
  });
});

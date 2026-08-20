import { getEmbeddingStatusCounts } from '@embedding/repo';
import { config, getEmbeddingModelInfo, getGenerativeModelInfo, type ModelInfo } from '@lib';
import { getPromptStatusCounts } from '@prompt/repo';
import { Hono } from 'hono';

import { version } from '../../package.json';

type QueueCounts = Awaited<ReturnType<typeof getPromptStatusCounts>>;

// A model lookup hitting a dead backend must not turn /status into a 500 — it is the endpoint you
// reach for precisely when something is down.
const UNKNOWN_MODEL = { model: undefined, contextSize: undefined };

const loadModelQueueSummary = async (getCounts: () => Promise<QueueCounts>, getModelInfo: () => Promise<ModelInfo>) => {
  const [counts, modelInfo] = await Promise.all([getCounts(), getModelInfo().catch(() => UNKNOWN_MODEL)]);
  return { model: modelInfo.model, contextSize: modelInfo.contextSize, ...counts };
};

export const status = new Hono().get('/', async (c) => {
  const [generative, embedding] = await Promise.all([
    loadModelQueueSummary(getPromptStatusCounts, getGenerativeModelInfo),
    config.embedding ? loadModelQueueSummary(getEmbeddingStatusCounts, getEmbeddingModelInfo) : undefined
  ]);
  return c.json({
    version,
    uptime: Math.floor(process.uptime()),
    workerConcurrency: config.worker.concurrency,
    generative,
    // Omitted entirely when no embedding backend is configured.
    ...(embedding && { embedding })
  });
});

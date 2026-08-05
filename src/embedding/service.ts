import {
  computeNextRetryAt,
  config,
  deliverJobCallback,
  encodeVectors,
  executeEmbedding,
  isTransientError,
  logger,
  recordUpstreamMetrics,
  type UpstreamMetricsSpec
} from '@lib';

import {
  findCallbackPendingEmbeddings,
  findQueuedEmbeddings,
  updateEmbeddingSetCallbackCompleted,
  updateEmbeddingSetCompleted,
  updateEmbeddingSetFailed,
  updateEmbeddingsSetInProgress
} from './repo';

// Callbacks are delivered concurrently, but capped so one slow host cannot saturate the tick.
const CALLBACK_CONCURRENCY = 10;

const WORKER_METRICS: UpstreamMetricsSpec = {
  counter: { name: 'embedding_requests_total', help: 'Total embedding requests from the embedding worker' },
  histogram: {
    name: 'embedding_request_duration_seconds',
    help: 'Embedding request duration in seconds (embedding worker)'
  }
};

const deliverCallback = async (embedding: Awaited<ReturnType<typeof findCallbackPendingEmbeddings>>[number]) => {
  // findCallbackPendingEmbeddings already filters out null callbackUrl; the guard is only here
  // because Drizzle cannot express that narrowing in the row type.
  if (!embedding.callbackUrl) return;

  const isDelivered = await deliverJobCallback({
    url: embedding.callbackUrl,
    body: JSON.stringify({
      clientName: embedding.clientName,
      requestId: embedding.requestId,
      model: embedding.model,
      dimensions: embedding.dimensions,
      encodingFormat: embedding.encodingFormat,
      embedding:
        embedding.vectors && embedding.dimensions
          ? encodeVectors(embedding.vectors, embedding.dimensions, embedding.encodingFormat)
          : []
    }),
    logContext: {
      component: 'callback',
      clientName: embedding.clientName,
      requestId: embedding.requestId,
      callbackUrl: embedding.callbackUrl
    }
  });
  if (isDelivered) await updateEmbeddingSetCallbackCompleted(embedding.id);
};

export const processCallbackPendingEmbeddings = async () => {
  if (!config.embedding) return;

  const cutoff = new Date(Date.now() - config.callback.retryTtlHours * 60 * 60 * 1000);
  const pending = await findCallbackPendingEmbeddings(cutoff);
  if (pending.length === 0) return;

  for (let index = 0; index < pending.length; index += CALLBACK_CONCURRENCY)
    await Promise.all(
      pending.slice(index, index + CALLBACK_CONCURRENCY).map((embedding) => deliverCallback(embedding))
    );
};

const runEmbedding = async (embedding: Awaited<ReturnType<typeof findQueuedEmbeddings>>[number]) => {
  const startedAt = performance.now();
  try {
    const input = JSON.parse(embedding.input) as string[];
    const { vectors, model, dimensions } = await executeEmbedding(input);
    recordUpstreamMetrics(WORKER_METRICS, 'success', startedAt);
    await updateEmbeddingSetCompleted(embedding.id, {
      model,
      dimensions,
      vectors,
      durationMs: Math.round(performance.now() - startedAt)
    });
    logger.info(
      {
        component: 'worker',
        clientName: embedding.clientName,
        requestId: embedding.requestId,
        count: input.length,
        dimensions
      },
      'Embedding completed'
    );
  } catch (error) {
    recordUpstreamMetrics(WORKER_METRICS, 'failure', startedAt);
    const errorMessage = error instanceof Error ? error.message : String(error);
    // A rejected batch (oversized input, malformed request) fails identically on every attempt, so
    // only network-shaped errors earn a retry.
    const isTransient = isTransientError(error);
    const isRetryable = isTransient && embedding.retryCount + 1 < config.upstream.maxRetryCount;
    const nextRetryAt = isRetryable ? computeNextRetryAt(embedding.retryCount + 1) : undefined;
    await updateEmbeddingSetFailed(
      embedding.id,
      isTransient && !isRetryable ? 'max_retries_exceeded' : errorMessage,
      isRetryable,
      nextRetryAt
    );
    logger.error(
      {
        component: 'worker',
        error,
        clientName: embedding.clientName,
        requestId: embedding.requestId,
        retryable: isRetryable,
        retryCount: embedding.retryCount
      },
      'Embedding failed'
    );
  }
};

export const processQueuedEmbeddings = async () => {
  if (!config.embedding) return;

  const batch = await findQueuedEmbeddings(config.worker.concurrency);
  if (batch.length === 0) return;

  await updateEmbeddingsSetInProgress(batch.map((embedding) => embedding.id));
  for (const embedding of batch)
    logger.debug(
      { component: 'worker', clientName: embedding.clientName, requestId: embedding.requestId },
      'Embedding picked up'
    );

  // Serial, unlike the prompt worker: embedding backends typically run with --parallel 1, so
  // overlapping requests would only queue up inside the backend where the relay cannot time them.
  for (const embedding of batch) await runEmbedding(embedding);
};

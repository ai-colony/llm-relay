import { zValidator } from '@hono/zod-validator';
import { encodeVectors, executeEmbedding, logger, recordUpstreamMetrics, type UpstreamMetricsSpec } from '@lib';
import { Hono } from 'hono';

import { jsonError } from '../errors';
import { RunEmbeddingBodySchema, toInputArray } from './schemas';

const RUN_METRICS: UpstreamMetricsSpec = {
  counter: { name: 'embedding_run_requests_total', help: 'Total synchronous embedding requests' },
  histogram: {
    name: 'embedding_run_request_duration_seconds',
    help: 'Synchronous embedding request duration in seconds'
  }
};

// The synchronous sibling of /embedding/add: bypasses the queue entirely for callers that want the
// vectors in the response. Embedding a short batch takes tens of milliseconds, so the round trip is
// cheaper than enqueueing and polling.
export const run = new Hono().post('/', zValidator('json', RunEmbeddingBodySchema), async (c) => {
  const { input, encodingFormat } = c.req.valid('json');
  const startedAt = performance.now();

  try {
    const { vectors, model, dimensions } = await executeEmbedding(toInputArray(input));
    recordUpstreamMetrics(RUN_METRICS, 'success', startedAt);
    return c.json(
      {
        success: true,
        model,
        dimensions,
        encodingFormat,
        embedding: encodeVectors(vectors, dimensions, encodingFormat)
      },
      200
    );
  } catch (error) {
    recordUpstreamMetrics(RUN_METRICS, 'failure', startedAt);
    logger.error({ component: 'embedding', error }, 'Synchronous embedding failed');
    return jsonError(c, 502, error instanceof Error ? error.message : String(error));
  }
});

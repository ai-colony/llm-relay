import type { EncodingFormat } from '@db/schema';
import { findEmbeddingByKey } from '@embedding/repo';
import { zValidator } from '@hono/zod-validator';
import { encodeVectors } from '@lib';
import { Hono } from 'hono';

import { jsonError } from '../errors';
import { GetEmbeddingQuerySchema } from './schemas';

type GetEmbeddingResponse =
  | { status: 'queued' | 'in_progress' | 'failed_retry' }
  | { status: 'failed'; statusError: string | null }
  | {
      status: 'completed';
      model: string | null;
      dimensions: number | null;
      durationMs: number | null;
      encodingFormat: EncodingFormat;
      embedding: number[][] | string[];
    };

export const get = new Hono().get('/', zValidator('query', GetEmbeddingQuerySchema), async (c) => {
  const { clientName, requestId, encodingFormat } = c.req.valid('query');
  const embedding = await findEmbeddingByKey(clientName, requestId);

  if (!embedding) return jsonError(c, 404, 'Embedding not found');

  if (embedding.status === 'completed') {
    const format = encodingFormat ?? embedding.encodingFormat;
    return c.json(
      {
        status: embedding.status,
        model: embedding.model,
        dimensions: embedding.dimensions,
        durationMs: embedding.durationMs,
        encodingFormat: format,
        embedding:
          embedding.vectors && embedding.dimensions
            ? encodeVectors(embedding.vectors, embedding.dimensions, format)
            : []
      } satisfies GetEmbeddingResponse,
      200
    );
  }

  if (embedding.status === 'failed')
    return c.json({ status: embedding.status, statusError: embedding.statusError } satisfies GetEmbeddingResponse, 200);

  return c.json({ status: embedding.status } satisfies GetEmbeddingResponse, 200);
});

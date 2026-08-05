import OpenAI from 'openai';

import { config } from './config';
import { logger } from './logger';
import { createModelResolver } from './modelInfo';
import { normaliseUpstreamEmbedding, packVectors } from './vectors';

export const isEmbeddingEnabled = (): boolean => config.embedding !== undefined;

const requireEmbeddingConfig = () => {
  const { embedding } = config;
  if (!embedding) throw new Error('Embedding backend is not configured');
  return embedding;
};

// Built lazily: config.embedding is absent whenever the feature is off, and constructing the client
// at import time would make this module unloadable for a relay running a generative backend alone.
let client: OpenAI | undefined;

const getClient = (): OpenAI => {
  const embedding = requireEmbeddingConfig();
  client ??= new OpenAI({ baseURL: embedding.url, apiKey: embedding.key, timeout: config.upstream.timeout });
  return client;
};

const resolver = createModelResolver('embedding', requireEmbeddingConfig);

export const getEmbeddingModelInfo = resolver.getModelInfo;
export const checkEmbedding = resolver.check;

export const executeEmbedding = async (
  input: string[]
): Promise<{ vectors: Buffer; model: string; dimensions: number }> => {
  const { model } = await getEmbeddingModelInfo();

  logger.info(
    { component: 'embedding', model, count: input.length, sizes: input.map((entry) => entry.length) },
    'Sending embedding'
  );

  // base64 asks the upstream to skip serialising ~2500 floats per vector as JSON text. Backends that
  // ignore the hint answer with plain arrays instead, which normaliseUpstreamEmbedding absorbs.
  const response = await getClient().embeddings.create({ model, input, encoding_format: 'base64' });

  const vectors = response.data
    .toSorted((a, b) => a.index - b.index)
    .map((entry) => normaliseUpstreamEmbedding(entry.embedding as unknown as number[] | string));

  const dimensions = vectors[0]?.length ?? 0;
  if (dimensions === 0) throw new Error('Embedding endpoint returned no vectors');
  if (vectors.some((vector) => vector.length !== dimensions))
    throw new Error('Embedding endpoint returned vectors of differing dimensions');

  logger.info({ component: 'embedding', model, count: vectors.length, dimensions }, 'Upstream embedding finished');
  return { vectors: packVectors(vectors), model, dimensions };
};

function makeOpenAIMock() {
  return {
    default: class MockOpenAI {
      embeddings = { create: mockEmbeddingsCreate };
      constructor(options: unknown) {
        mockOpenAIConstructor(options);
      }
    }
  };
}

function makeConfigMock(embedding: { url: string; model: string; key: string } | undefined) {
  return {
    config: {
      generative: { url: 'http://test/v1', model: 'gen-model', key: 'k' },
      embedding,
      upstream: { timeout: 5000, maxRetryCount: 10, modelCacheTtlMs: 60_000 },
      log: { level: 'silent' },
      http: { port: 3000 },
      database: { filename: ':memory:' }
    }
  };
}

function makeLoggerMock() {
  return { logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } };
}

// vi.mock factories are hoisted above regular top-level const declarations, so the shared config
// object has to come from vi.hoisted too, or the factory below would throw a TDZ error.
const { EMBEDDING_CONFIG, mockEmbeddingsCreate, mockOpenAIConstructor } = vi.hoisted(() => ({
  EMBEDDING_CONFIG: { url: 'http://embed-test/v1', model: 'embed-model', key: 'k' },
  mockEmbeddingsCreate: vi.fn(),
  mockOpenAIConstructor: vi.fn()
}));

vi.mock('../../src/lib/config', () => makeConfigMock(EMBEDDING_CONFIG));

vi.mock('../../src/lib/logger', () => makeLoggerMock());

vi.mock('openai', () => makeOpenAIMock());

// Model resolution goes through the same createModelResolver as generative.ts, backed by fetch.
function makeModelsFetch(models: Array<{ id: string }>) {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ data: models }) });
}

// Base64-encodes a Float32Array the way a real embedding backend would; keeps every test call site
// from having to re-derive byteOffset/byteLength when slicing a typed array's buffer.
function toBase64Float32(values: number[]) {
  const floats = new Float32Array(values);
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength).toString('base64');
}

// Reads dimensions floats back out of the packed buffer starting at the given vector offset.
function readPackedFloats(vectors: Buffer, dimensions: number, vectorIndex = 0) {
  const floats = new Float32Array(vectors.buffer, vectors.byteOffset + vectorIndex * dimensions * 4, dimensions);
  return [...floats];
}

import { config } from '../../src/lib/config';
import { executeEmbedding, isEmbeddingEnabled } from '../../src/lib/embedding';

describe('isEmbeddingEnabled', () => {
  afterEach(() => {
    vi.mocked(config).embedding = EMBEDDING_CONFIG;
  });

  it('returns true when an embedding backend is configured', () => {
    expect(isEmbeddingEnabled()).toBe(true);
  });

  it('returns false when no embedding backend is configured', () => {
    vi.mocked(config).embedding = undefined;
    expect(isEmbeddingEnabled()).toBe(false);
  });
});

describe('executeEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(config).embedding = EMBEDDING_CONFIG;
    vi.stubGlobal('fetch', makeModelsFetch([{ id: 'embed-model' }]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests base64 encoding with the resolved model name', async () => {
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ index: 0, embedding: toBase64Float32([1, 2, 3]) }]
    });

    await executeEmbedding(['hello']);

    expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
      model: 'embed-model',
      input: ['hello'],
      encoding_format: 'base64'
    });
  });

  it('re-sorts response entries by index before packing, regardless of response order', async () => {
    // Upstream returns index 1 before index 0 — the real-world case this guards against.
    mockEmbeddingsCreate.mockResolvedValue({
      data: [
        { index: 1, embedding: toBase64Float32([2, 2, 2]) },
        { index: 0, embedding: toBase64Float32([1, 1, 1]) }
      ]
    });

    const result = await executeEmbedding(['a', 'b']);

    expect(result.dimensions).toBe(3);
    // First vector in the packed buffer must be the index-0 embedding, not the first response entry.
    expect(readPackedFloats(result.vectors, 3, 0)).toEqual([1, 1, 1]);
    expect(readPackedFloats(result.vectors, 3, 1)).toEqual([2, 2, 2]);
  });

  it('decodes a base64-encoded embedding into the packed buffer', async () => {
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ index: 0, embedding: toBase64Float32([0.5, -0.25, 2]) }]
    });

    const result = await executeEmbedding(['hello']);

    expect(result.dimensions).toBe(3);
    expect(readPackedFloats(result.vectors, 3)).toEqual([0.5, -0.25, 2]);
    expect(result.model).toBe('embed-model');
  });

  it('throws when the upstream returns no vectors', async () => {
    mockEmbeddingsCreate.mockResolvedValue({ data: [] });

    await expect(executeEmbedding(['hello'])).rejects.toThrow('Embedding endpoint returned no vectors');
  });

  it('throws when the upstream returns vectors of differing dimensions', async () => {
    mockEmbeddingsCreate.mockResolvedValue({
      data: [
        { index: 0, embedding: toBase64Float32([1, 2, 3]) },
        { index: 1, embedding: toBase64Float32([1, 2]) }
      ]
    });

    await expect(executeEmbedding(['a', 'b'])).rejects.toThrow(
      'Embedding endpoint returned vectors of differing dimensions'
    );
  });

  // The module-level `client` cache persists across tests importing the same module instance, so
  // this needs its own fresh module graph (vi.resetModules) rather than reusing the top-level import —
  // otherwise an earlier test in this file would already have constructed (and cached) the client.
  // mockOpenAIConstructor is a plain hoisted spy closed over by the 'openai' mock factory, so it
  // keeps recording constructor calls even across a resetModules-triggered re-evaluation of that factory.
  it('constructs the OpenAI client lazily, once, and reuses it across calls', async () => {
    vi.resetModules();
    const fresh = await import('../../src/lib/embedding');
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ index: 0, embedding: toBase64Float32([1]) }]
    });

    await fresh.executeEmbedding(['first']);
    await fresh.executeEmbedding(['second']);

    expect(mockOpenAIConstructor).toHaveBeenCalledTimes(1);
    expect(mockOpenAIConstructor).toHaveBeenCalledWith({
      baseURL: EMBEDDING_CONFIG.url,
      apiKey: EMBEDDING_CONFIG.key,
      timeout: 5000
    });
  });
});

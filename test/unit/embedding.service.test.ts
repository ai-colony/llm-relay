// One shared, mutable config object, for the same reason as in service.test.ts: the @lib barrel mock
// and the real jobs module must observe the same reference.
const { testConfig } = vi.hoisted(() => ({
  testConfig: {
    generative: { url: 'http://test/v1', model: '', key: 'k' },
    embedding: { url: 'http://test:8081/v1', model: '', key: 'k' },
    upstream: { timeout: 5000, maxRetryCount: 10, modelCacheTtlMs: 60_000 },
    worker: { concurrency: 4 },
    callback: { urlAllowlist: undefined, retryTtlHours: 24, hmacSecret: '' }
  } as {
    generative: { url: string; model: string; key: string };
    embedding: { url: string; model: string; key: string } | undefined;
    upstream: { timeout: number; maxRetryCount: number; modelCacheTtlMs: number };
    worker: { concurrency: number };
    callback: { urlAllowlist: RegExp | undefined; retryTtlHours: number; hmacSecret: string };
  }
}));

vi.mock('../../src/lib/config', () => ({ config: testConfig }));

vi.mock('../../src/lib/logger', async () => {
  const { makeLoggerMock } = await import('../helpers/mocks');
  return { logger: makeLoggerMock() };
});

vi.mock('@lib', async () => {
  const { makeLoggerMock } = await import('../helpers/mocks');
  const jobs = await vi.importActual<typeof JobsModule>('../../src/lib/jobs');
  const vectors = await vi.importActual<typeof VectorsModule>('../../src/lib/vectors');
  return {
    ...jobs,
    ...vectors,
    executeEmbedding: vi.fn(),
    incCounter: vi.fn(),
    observeHistogram: vi.fn(),
    recordUpstreamMetrics: vi.fn(),
    logger: makeLoggerMock(),
    config: testConfig
  };
});

vi.mock('../../src/embedding/repo', () => ({
  findQueuedEmbeddings: vi.fn(),
  updateEmbeddingsSetInProgress: vi.fn(),
  updateEmbeddingSetCompleted: vi.fn(),
  updateEmbeddingSetFailed: vi.fn(),
  findCallbackPendingEmbeddings: vi.fn(),
  updateEmbeddingSetCallbackCompleted: vi.fn()
}));

import { config, executeEmbedding, packVectors } from '@lib';

import {
  findCallbackPendingEmbeddings,
  findQueuedEmbeddings,
  updateEmbeddingSetCallbackCompleted,
  updateEmbeddingSetCompleted,
  updateEmbeddingSetFailed,
  updateEmbeddingsSetInProgress
} from '../../src/embedding/repo';
import { processCallbackPendingEmbeddings, processQueuedEmbeddings } from '../../src/embedding/service';
import type * as JobsModule from '../../src/lib/jobs';
import type * as VectorsModule from '../../src/lib/vectors';

// Mirrors the projection findQueuedEmbeddings actually selects.
const makeQueuedEmbedding = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  clientName: 'test-client',
  requestId: 'req-1',
  input: JSON.stringify(['hello']),
  retryCount: 0,
  ...overrides
});

// Mirrors the projection findCallbackPendingEmbeddings actually selects.
const makeCallbackEmbedding = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  clientName: 'test-client',
  requestId: 'req-1',
  callbackUrl: 'https://example.com/callback',
  encodingFormat: 'float' as const,
  model: 'embed-model',
  dimensions: 3,
  vectors: packVectors([[0.5, 0.25, -1]]),
  ...overrides
});

const successfulResult = { vectors: packVectors([[0.5, 0.25, -1]]), model: 'embed-model', dimensions: 3 };

const enableEmbedding = () => {
  vi.mocked(config).embedding = { url: 'http://test:8081/v1', model: '', key: 'k' };
};

describe('processQueuedEmbeddings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enableEmbedding();
    vi.mocked(config).worker = { concurrency: 4 };
  });

  it('does nothing when no embedding backend is configured', async () => {
    vi.mocked(config).embedding = undefined;
    await processQueuedEmbeddings();
    expect(findQueuedEmbeddings).not.toHaveBeenCalled();
  });

  it('does nothing when nothing is queued', async () => {
    vi.mocked(findQueuedEmbeddings).mockResolvedValue([]);
    await processQueuedEmbeddings();
    expect(updateEmbeddingsSetInProgress).not.toHaveBeenCalled();
  });

  it('stores the packed vectors, model and dimensions on success', async () => {
    vi.mocked(findQueuedEmbeddings).mockResolvedValue([makeQueuedEmbedding()]);
    vi.mocked(executeEmbedding).mockResolvedValue(successfulResult);

    await processQueuedEmbeddings();

    expect(updateEmbeddingsSetInProgress).toHaveBeenCalledWith([1]);
    expect(updateEmbeddingSetCompleted).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ model: 'embed-model', dimensions: 3, durationMs: expect.any(Number) })
    );
  });

  it('passes the stored JSON input through as a string array', async () => {
    vi.mocked(findQueuedEmbeddings).mockResolvedValue([makeQueuedEmbedding({ input: JSON.stringify(['one', 'two']) })]);
    vi.mocked(executeEmbedding).mockResolvedValue(successfulResult);

    await processQueuedEmbeddings();

    expect(executeEmbedding).toHaveBeenCalledWith(['one', 'two']);
  });

  it('runs the batch strictly one upstream call at a time', async () => {
    const batch = Array.from({ length: 4 }, (_, index) =>
      makeQueuedEmbedding({ id: index + 1, requestId: `req-${index + 1}` })
    );
    vi.mocked(findQueuedEmbeddings).mockResolvedValue(batch);

    let inFlight = 0;
    let maxInFlight = 0;
    vi.mocked(executeEmbedding).mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return successfulResult;
    });

    await processQueuedEmbeddings();

    // The embedding backend runs with --parallel 1; overlapping requests would only queue inside it.
    expect(maxInFlight).toBe(1);
    expect(updateEmbeddingSetCompleted).toHaveBeenCalledTimes(4);
  });

  it('claims up to WORKER_CONCURRENCY rows per tick', async () => {
    vi.mocked(config).worker = { concurrency: 3 };
    vi.mocked(findQueuedEmbeddings).mockResolvedValue([]);

    await processQueuedEmbeddings();

    expect(findQueuedEmbeddings).toHaveBeenCalledWith(3);
  });

  it('marks a transient failure as retryable with a backoff date', async () => {
    vi.mocked(findQueuedEmbeddings).mockResolvedValue([makeQueuedEmbedding({ retryCount: 0 })]);
    vi.mocked(executeEmbedding).mockRejectedValue(new Error('fetch failed'));

    await processQueuedEmbeddings();

    expect(updateEmbeddingSetFailed).toHaveBeenCalledWith(1, 'fetch failed', true, expect.any(Date));
  });

  it('moves to max_retries_exceeded once the retry cap is reached', async () => {
    vi.mocked(findQueuedEmbeddings).mockResolvedValue([makeQueuedEmbedding({ retryCount: 9 })]);
    vi.mocked(executeEmbedding).mockRejectedValue(new Error('econnreset'));

    await processQueuedEmbeddings();

    expect(updateEmbeddingSetFailed).toHaveBeenCalledWith(1, 'max_retries_exceeded', false, undefined);
  });

  it('fails an oversized input terminally on the first attempt, without retrying', async () => {
    // Verbatim from llama.cpp when an input exceeds --ctx-size. It will fail identically every time,
    // so burning ten retries would be pointless.
    const message = '400 request (9603 tokens) exceeds the available context size (8192 tokens)';
    vi.mocked(findQueuedEmbeddings).mockResolvedValue([makeQueuedEmbedding({ retryCount: 0 })]);
    vi.mocked(executeEmbedding).mockRejectedValue(new Error(message));

    await processQueuedEmbeddings();

    expect(updateEmbeddingSetFailed).toHaveBeenCalledWith(1, message, false, undefined);
  });

  it('fails the row rather than throwing when the stored input is not valid JSON', async () => {
    vi.mocked(findQueuedEmbeddings).mockResolvedValue([makeQueuedEmbedding({ input: 'not json' })]);

    await expect(processQueuedEmbeddings()).resolves.toBeUndefined();

    expect(updateEmbeddingSetFailed).toHaveBeenCalledWith(1, expect.any(String), false, undefined);
    expect(executeEmbedding).not.toHaveBeenCalled();
  });

  it('continues the batch after one row fails', async () => {
    vi.mocked(findQueuedEmbeddings).mockResolvedValue([
      makeQueuedEmbedding({ id: 1, requestId: 'req-1' }),
      makeQueuedEmbedding({ id: 2, requestId: 'req-2' })
    ]);
    vi.mocked(executeEmbedding)
      .mockRejectedValueOnce(new Error('model not found'))
      .mockResolvedValueOnce(successfulResult);

    await processQueuedEmbeddings();

    expect(updateEmbeddingSetFailed).toHaveBeenCalledTimes(1);
    expect(updateEmbeddingSetCompleted).toHaveBeenCalledTimes(1);
  });
});

describe('processCallbackPendingEmbeddings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    enableEmbedding();
    vi.mocked(config).callback = { urlAllowlist: undefined, retryTtlHours: 24, hmacSecret: '' };
  });

  it('does nothing when no embedding backend is configured', async () => {
    vi.mocked(config).embedding = undefined;
    await processCallbackPendingEmbeddings();
    expect(findCallbackPendingEmbeddings).not.toHaveBeenCalled();
  });

  it('does nothing when no callbacks are pending', async () => {
    vi.mocked(findCallbackPendingEmbeddings).mockResolvedValue([]);
    await processCallbackPendingEmbeddings();
    expect(updateEmbeddingSetCallbackCompleted).not.toHaveBeenCalled();
  });

  it('delivers the vectors as number arrays for the float format', async () => {
    vi.mocked(findCallbackPendingEmbeddings).mockResolvedValue([makeCallbackEmbedding()]);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    await processCallbackPendingEmbeddings();

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string) as {
      embedding: number[][];
      dimensions: number;
      model: string;
    };
    expect(body.embedding).toEqual([[0.5, 0.25, -1]]);
    expect(body.dimensions).toBe(3);
    expect(body.model).toBe('embed-model');
    expect(updateEmbeddingSetCallbackCompleted).toHaveBeenCalledWith(1);
  });

  it('delivers base64 strings when the job was queued with that format', async () => {
    vi.mocked(findCallbackPendingEmbeddings).mockResolvedValue([makeCallbackEmbedding({ encodingFormat: 'base64' })]);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    await processCallbackPendingEmbeddings();

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string) as { embedding: string[] };
    expect(body.embedding).toHaveLength(1);
    expect(typeof body.embedding[0]).toBe('string');
  });

  it('leaves the row pending when delivery fails', async () => {
    vi.mocked(findCallbackPendingEmbeddings).mockResolvedValue([makeCallbackEmbedding()]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await processCallbackPendingEmbeddings();

    expect(updateEmbeddingSetCallbackCompleted).not.toHaveBeenCalled();
  });

  it('sends an empty embedding list when the row somehow has no vectors', async () => {
    vi.mocked(findCallbackPendingEmbeddings).mockResolvedValue([
      makeCallbackEmbedding({ vectors: null, dimensions: null })
    ]);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    await processCallbackPendingEmbeddings();

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string) as { embedding: unknown[] };
    expect(body.embedding).toEqual([]);
  });

  it('skips rows with no callback URL', async () => {
    vi.mocked(findCallbackPendingEmbeddings).mockResolvedValue([makeCallbackEmbedding({ callbackUrl: null })]);
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    await processCallbackPendingEmbeddings();

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

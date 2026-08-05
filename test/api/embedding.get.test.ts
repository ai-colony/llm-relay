vi.mock('../../src/embedding/repo', () => ({
  findEmbeddingByKey: vi.fn()
}));

// The route pulls in ./schemas, which needs isCallbackUrlAllowed from the barrel; keeping the mock
// narrow avoids constructing a live upstream client at import time.
vi.mock('@lib', async () => ({
  ...(await import('../../src/lib/vectors')),
  isCallbackUrlAllowed: vi.fn().mockReturnValue(true)
}));

import { packVectors } from '@lib';

import { findEmbeddingByKey } from '../../src/embedding/repo';
import { get } from '../../src/hono/embedding/get';
import { readJson, withQuery } from '../helpers/mocks';

type EmbeddingRow = NonNullable<Awaited<ReturnType<typeof findEmbeddingByKey>>>;

const makeRow = (overrides: Partial<EmbeddingRow> = {}): EmbeddingRow => ({
  id: 1,
  clientName: 'my-client',
  requestId: 'req-1',
  callbackUrl: null,
  callbackCompleted: false,
  createdAt: new Date(),
  status: 'completed',
  statusError: null,
  completedAt: new Date(),
  input: JSON.stringify(['hello']),
  inputCount: 1,
  encodingFormat: 'float',
  priority: 0,
  retryCount: 0,
  nextRetryAt: null,
  model: 'embed-model',
  dimensions: 3,
  vectors: packVectors([[0.5, 0.25, -1]]),
  durationMs: 42,
  ...overrides
});

const request = (parameters: Record<string, string | undefined> = {}) =>
  get.request(withQuery({ clientName: 'my-client', requestId: 'req-1', ...parameters }));

describe('GET /embedding/get', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when the job does not exist', async () => {
    vi.mocked(findEmbeddingByKey).mockResolvedValue(undefined);

    const response = await request();
    expect(response.status).toBe(404);
    const body = await readJson(response);
    expect(body.success).toBe(false);
  });

  it('returns 400 when requestId is missing', async () => {
    const response = await get.request(withQuery({ clientName: 'my-client' }));
    expect(response.status).toBe(400);
  });

  it('returns the bare status for a queued job', async () => {
    vi.mocked(findEmbeddingByKey).mockResolvedValue(makeRow({ status: 'queued', vectors: null, dimensions: null }));

    const body = await readJson(await request());
    expect(body).toEqual({ status: 'queued' });
  });

  it('returns statusError for a failed job', async () => {
    vi.mocked(findEmbeddingByKey).mockResolvedValue(
      makeRow({ status: 'failed', statusError: 'max_retries_exceeded', vectors: null, dimensions: null })
    );

    const body = await readJson(await request());
    expect(body).toEqual({ status: 'failed', statusError: 'max_retries_exceeded' });
  });

  it('returns the vectors and timing for a completed job', async () => {
    vi.mocked(findEmbeddingByKey).mockResolvedValue(makeRow());

    const body = await readJson(await request());
    expect(body.status).toBe('completed');
    expect(body.model).toBe('embed-model');
    expect(body.dimensions).toBe(3);
    expect(body.durationMs).toBe(42);
    expect(body.encodingFormat).toBe('float');
    expect(body.embedding).toEqual([[0.5, 0.25, -1]]);
  });

  it('uses the stored encodingFormat when the query parameter is omitted', async () => {
    vi.mocked(findEmbeddingByKey).mockResolvedValue(makeRow({ encodingFormat: 'base64' }));

    const body = await readJson(await request());
    expect(body.encodingFormat).toBe('base64');
    expect(typeof body.embedding[0]).toBe('string');
  });

  it('re-encodes on the way out when the query parameter overrides the stored format', async () => {
    vi.mocked(findEmbeddingByKey).mockResolvedValue(makeRow({ encodingFormat: 'float' }));

    const body = await readJson(await request({ encodingFormat: 'base64' }));
    expect(body.encodingFormat).toBe('base64');
    expect(typeof body.embedding[0]).toBe('string');
  });

  it('returns 400 for an unknown encodingFormat', async () => {
    const response = await request({ encodingFormat: 'float64' });
    expect(response.status).toBe(400);
  });

  it('returns an empty embedding list when a completed row has no vectors', async () => {
    vi.mocked(findEmbeddingByKey).mockResolvedValue(makeRow({ vectors: null, dimensions: null }));

    const body = await readJson(await request());
    expect(body.embedding).toEqual([]);
  });
});

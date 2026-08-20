// Every /embedding route sits behind a guard that 503s when no embedding backend is configured.
// Exercised through the mounted sub-app, since that is where the middleware lives.
vi.mock('@lib', async () => {
  const vectors = await import('../../src/lib/vectors');
  const { makeLoggerMock } = await import('../helpers/mocks');
  return {
    ...vectors,
    config: { embedding: undefined },
    checkCallbackAvailability: vi.fn().mockResolvedValue(true),
    isCallbackUrlAllowed: vi.fn().mockReturnValue(true),
    executeEmbedding: vi.fn(),
    recordUpstreamMetrics: vi.fn(),
    logger: makeLoggerMock()
  };
});

// add.ts imports @db for isUniqueConstraintError; without this the real module opens a SQLite file.
vi.mock('@db', () => ({
  isUniqueConstraintError: vi.fn().mockReturnValue(false)
}));

vi.mock('../../src/embedding/repo', () => ({
  addEmbedding: vi.fn(),
  countQueuedEmbeddings: vi.fn().mockResolvedValue(0),
  findEmbeddingByKey: vi.fn(),
  findEmbeddingStatusByKey: vi.fn(),
  findEmbeddingsByClientName: vi.fn().mockResolvedValue([]),
  deleteEmbeddingByKey: vi.fn(),
  purgeCompletedEmbeddings: vi.fn().mockResolvedValue(0),
  CANCELLABLE_STATUSES: ['queued', 'failed', 'failed_retry'],
  OVERWRITABLE_STATUSES: ['queued', 'completed', 'failed', 'failed_retry']
}));

import { config } from '@lib';

import { addEmbedding, findEmbeddingByKey } from '../../src/embedding/repo';
import { embedding } from '../../src/hono/embedding';
import { readJson } from '../helpers/mocks';

const key = 'clientName=my-client&requestId=req-1';

const ROUTES: Array<[string, string, RequestInit]> = [
  ['POST', '/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
  ['POST', '/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
  ['GET', `/get?${key}`, {}],
  ['GET', '/list?clientName=my-client', {}],
  ['DELETE', `/cancel?${key}`, { method: 'DELETE' }],
  ['DELETE', '/purge', { method: 'DELETE' }]
];

describe('/embedding with no backend configured', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(config).embedding = undefined;
  });

  it.each(ROUTES)('%s %s returns 503', async (_method, path, init) => {
    const response = await embedding.request(path, init);
    expect(response.status).toBe(503);
    const body = await readJson(response);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Embedding backend is not configured');
  });

  it('rejects before touching the database, and before request validation', async () => {
    // The bodies above are deliberately invalid; a 503 rather than a 400 proves the guard runs first.
    await embedding.request('/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    await embedding.request(`/get?${key}`);

    expect(addEmbedding).not.toHaveBeenCalled();
    expect(findEmbeddingByKey).not.toHaveBeenCalled();
  });

  it('lets requests through once a backend is configured', async () => {
    vi.mocked(config).embedding = { url: 'http://localhost:8081/v1', model: '', key: 'none' };
    vi.mocked(findEmbeddingByKey).mockResolvedValue(undefined);

    const response = await embedding.request(`/get?${key}`);
    // 404 rather than 503: the guard is out of the way and the route itself answered.
    expect(response.status).toBe(404);
  });
});

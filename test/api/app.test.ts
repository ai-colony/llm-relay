// The first test to exercise the fully assembled app (src/hono/index.ts) rather than a single
// mounted route handler, so every module the app pulls in transitively has to be mocked up front —
// otherwise importing it for real would open a live SQLite file and read real env vars via config.ts.
import { makeLoggerMock, makeStatusCounts, readJson } from '../helpers/mocks';

vi.mock('@db', () => ({
  isUniqueConstraintError: vi.fn().mockReturnValue(false),
  checkDatabase: vi.fn().mockReturnValue({ ok: true })
}));

// src/hono/index.ts reads config.http.apiKey exactly once, at module-import time, to build the auth
// middleware (`const auth = createAuthMiddleware(config.http.apiKey)`) — mutating config.http.apiKey
// afterwards has no effect on already-mounted middleware, so the key has to be fixed here from the
// start rather than toggled per-test the way other config fields (e.g. embedding) are.
vi.mock('@lib', async () => {
  const vectors = await import('../../src/lib/vectors');
  return {
    ...vectors,
    config: { http: { apiKey: 'secret-key' }, embedding: undefined, worker: { concurrency: 4 } },
    logger: makeLoggerMock(),
    checkGenerative: vi.fn().mockResolvedValue({ ok: true }),
    checkEmbedding: vi.fn().mockResolvedValue({ ok: true }),
    getGenerativeModelInfo: vi.fn().mockResolvedValue({ model: 'test-model', contextSize: 32_768 }),
    getEmbeddingModelInfo: vi.fn().mockResolvedValue({ model: 'test-embed', contextSize: 8192 }),
    executeEmbedding: vi.fn(),
    streamChatCompletion: vi.fn(),
    recordUpstreamMetrics: vi.fn(),
    isCallbackUrlAllowed: vi.fn().mockReturnValue(true),
    checkCallbackAvailability: vi.fn().mockResolvedValue(true),
    incCounter: vi.fn(),
    observeHistogram: vi.fn(),
    setGauge: vi.fn(),
    renderMetrics: vi.fn().mockReturnValue('')
  };
});

vi.mock('../../src/prompt/repo', () => ({
  addPrompt: vi.fn(),
  countQueuedPrompts: vi.fn().mockResolvedValue(0),
  deletePromptByKey: vi.fn(),
  findPromptStatusByKey: vi.fn(),
  findPromptByClientNameAndRequestId: vi.fn(),
  findPromptsByClientName: vi.fn().mockResolvedValue([]),
  purgeCompletedPrompts: vi.fn().mockResolvedValue(0),
  getPromptStatusCounts: vi.fn().mockResolvedValue(makeStatusCounts()),
  CANCELLABLE_STATUSES: ['queued', 'failed', 'failed_retry'],
  OVERWRITABLE_STATUSES: ['queued', 'completed', 'failed', 'failed_retry']
}));

vi.mock('../../src/embedding/repo', () => ({
  addEmbedding: vi.fn(),
  countQueuedEmbeddings: vi.fn().mockResolvedValue(0),
  deleteEmbeddingByKey: vi.fn(),
  findEmbeddingStatusByKey: vi.fn(),
  findEmbeddingByKey: vi.fn(),
  findEmbeddingsByClientName: vi.fn().mockResolvedValue([]),
  purgeCompletedEmbeddings: vi.fn().mockResolvedValue(0),
  getEmbeddingStatusCounts: vi.fn().mockResolvedValue(makeStatusCounts()),
  CANCELLABLE_STATUSES: ['queued', 'failed', 'failed_retry'],
  OVERWRITABLE_STATUSES: ['queued', 'completed', 'failed', 'failed_retry']
}));

import { config } from '@lib';

import { app } from '../../src/hono';
import { getPromptStatusCounts } from '../../src/prompt/repo';

describe('app (src/hono/index.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(config).embedding = undefined;
    vi.mocked(getPromptStatusCounts).mockResolvedValue(makeStatusCounts());
  });

  describe('auth mounted on guarded prefixes', () => {
    it.each([
      ['GET', '/prompt/list?clientName=my-client'],
      ['POST', '/chat/completions'],
      ['GET', '/embedding/list?clientName=my-client']
    ])('%s %s without an Authorization header returns 401', async (method, path) => {
      const response = await app.request(path, { method });
      expect(response.status).toBe(401);
      const body = await readJson(response);
      expect(body.success).toBe(false);
    });

    it('lets a request with the correct bearer token through past auth', async () => {
      const response = await app.request('/prompt/list?clientName=my-client', {
        headers: { Authorization: 'Bearer secret-key' }
      });
      expect(response.status).not.toBe(401);
    });
  });

  describe('public routes bypass auth', () => {
    it.each([
      ['GET', '/health'],
      ['GET', '/metrics'],
      ['GET', '/status'],
      ['GET', '/openapi.json']
    ])('%s %s never returns 401, even without an Authorization header', async (method, path) => {
      const response = await app.request(path, { method });
      expect(response.status).not.toBe(401);
    });
  });

  it('routes an unhandled handler error through the global onError handler as a 500', async () => {
    vi.mocked(getPromptStatusCounts).mockRejectedValue(new Error('db exploded'));

    const response = await app.request('/status');

    expect(response.status).toBe(500);
    const body = await readJson(response);
    expect(body).toEqual(
      expect.objectContaining({ success: false, error: 'Internal server error', path: '/status', method: 'GET' })
    );
  });

  it('returns 404 for an unknown route', async () => {
    const response = await app.request('/this-route-does-not-exist');
    expect(response.status).toBe(404);
  });
});

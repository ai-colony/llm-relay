vi.mock('../../src/lib/config', () => ({
  config: {
    openai: { url: 'http://test-server/v1', model: '', key: 'test-key', timeout: 5000 },
    log: { level: 'silent' },
    http: { port: 3000 },
    database: { filename: ':memory:' }
  }
}));

vi.mock('../../src/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

import { checkOpenAI } from '../../src/lib/openAI';

describe('checkOpenAI', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok true when the models endpoint responds with 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const result = await checkOpenAI();
    expect(result).toEqual({ ok: true });
  });

  it('returns ok false with an HTTP error message when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const result = await checkOpenAI();
    expect(result).toEqual({ ok: false, error: 'HTTP 503' });
  });

  it('returns ok false with the error string when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    const result = await checkOpenAI();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('connection refused');
  });
});

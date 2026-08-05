const { testConfig } = vi.hoisted(() => ({
  testConfig: { callback: { urlAllowlist: undefined, retryTtlHours: 24, hmacSecret: '' } }
}));

vi.mock('../../src/lib/config', () => ({ config: testConfig }));

vi.mock('../../src/lib/logger', async () => {
  const { makeLoggerMock } = await import('../helpers/mocks');
  return { logger: makeLoggerMock() };
});

import { createHmac } from 'node:crypto';

import { buildCallbackHeaders, computeNextRetryAt, deliverJobCallback, isTransientError } from '../../src/lib/jobs';

describe('computeNextRetryAt', () => {
  it('backs off exponentially', () => {
    const now = Date.now();
    expect(computeNextRetryAt(1).getTime() - now).toBeGreaterThanOrEqual(1900);
    expect(computeNextRetryAt(3).getTime() - now).toBeGreaterThanOrEqual(7900);
  });

  it('caps the delay at 60 s', () => {
    const now = Date.now();
    const delay = computeNextRetryAt(30).getTime() - now;
    expect(delay).toBeGreaterThanOrEqual(59_900);
    expect(delay).toBeLessThanOrEqual(60_100);
  });
});

describe('isTransientError', () => {
  it.each([['econnreset'], ['etimedout'], ['econnrefused'], ['fetch failed'], ['network error'], ['socket hang up']])(
    'treats "%s" as transient',
    (message) => {
      expect(isTransientError(new Error(message))).toBe(true);
    }
  );

  it('treats AbortError as transient regardless of message', () => {
    expect(isTransientError(new DOMException('aborted', 'AbortError'))).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(isTransientError(new Error('ECONNRESET while reading'))).toBe(true);
  });

  it('follows the cause chain', () => {
    expect(isTransientError(new Error('wrapped', { cause: new Error('fetch failed') }))).toBe(true);
  });

  it('stops following the cause chain past a sane depth', () => {
    let error = new Error('fetch failed');
    for (let index = 0; index < 10; index++) error = new Error('wrapped', { cause: error });
    expect(isTransientError(error)).toBe(false);
  });

  it.each([
    // Verbatim upstream rejections seen from llama.cpp — deterministic, so retrying cannot help.
    ['400 request (9603 tokens) exceeds the available context size (8192 tokens)'],
    ['500 Compute error.']
  ])('treats "%s" as non-transient so it fails on the first attempt', (message) => {
    expect(isTransientError(new Error(message))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isTransientError('econnreset')).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
  });
});

describe('buildCallbackHeaders', () => {
  beforeEach(() => {
    testConfig.callback.hmacSecret = '';
  });

  it('omits the signature header when no secret is configured', () => {
    expect(buildCallbackHeaders('{}')).toEqual({ 'Content-Type': 'application/json' });
  });

  it('signs the exact body bytes when a secret is configured', () => {
    testConfig.callback.hmacSecret = 'mysecret';
    const body = JSON.stringify({ a: 1 });
    const expected = createHmac('sha256', 'mysecret').update(body).digest('hex');
    expect(buildCallbackHeaders(body)['X-LLM-Relay-Signature']).toBe(`hmac-sha256=${expected}`);
  });
});

describe('deliverJobCallback', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    testConfig.callback.hmacSecret = '';
  });

  it('returns true and POSTs the body on success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const delivered = await deliverJobCallback({ url: 'https://example.com/cb', body: '{"a":1}', logContext: {} });

    expect(delivered).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/cb',
      expect.objectContaining({ method: 'POST', body: '{"a":1}' })
    );
  });

  it('returns false when the receiver answers a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    expect(await deliverJobCallback({ url: 'https://example.com/cb', body: '{}', logContext: {} })).toBe(false);
  });

  it('returns false rather than throwing when the request fails outright', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    expect(await deliverJobCallback({ url: 'https://example.com/cb', body: '{}', logContext: {} })).toBe(false);
  });
});

vi.mock('../../src/lib/config', () => ({
  config: { callback: { urlAllowlist: undefined as RegExp | undefined } }
}));

import { checkCallbackAvailability, isCallbackUrlAllowed } from '../../src/lib/callbackUrl';
import { config } from '../../src/lib/config';

describe('isCallbackUrlAllowed', () => {
  afterEach(() => {
    config.callback.urlAllowlist = undefined;
  });

  it('allows any URL when allowlist is undefined', () => {
    config.callback.urlAllowlist = undefined;
    expect(isCallbackUrlAllowed('https://example.com/hook')).toBe(true);
    expect(isCallbackUrlAllowed('http://localhost/hook')).toBe(true);
    expect(isCallbackUrlAllowed('http://127.0.0.1/hook')).toBe(true);
  });

  it('allows matching URLs when allowlist is set', () => {
    config.callback.urlAllowlist = /^http:\/\/localhost/;
    expect(isCallbackUrlAllowed('http://localhost/hook')).toBe(true);
    expect(isCallbackUrlAllowed('http://localhost:3000/cb')).toBe(true);
  });

  it('rejects non-matching URLs when allowlist is set', () => {
    config.callback.urlAllowlist = /^http:\/\/localhost/;
    expect(isCallbackUrlAllowed('https://example.com/hook')).toBe(false);
    expect(isCallbackUrlAllowed('http://192.168.1.1/hook')).toBe(false);
  });

  it('rejects URLs that do not match the allowlist pattern', () => {
    config.callback.urlAllowlist = /^https:\/\/trusted\.example\.com/;
    expect(isCallbackUrlAllowed('https://trusted.example.com/hook')).toBe(true);
    expect(isCallbackUrlAllowed('https://untrusted.example.com/hook')).toBe(false);
  });
});

describe('checkCallbackAvailability', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when fetch resolves with any HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }));
    expect(await checkCallbackAvailability('https://example.com/hook')).toBe(true);
  });

  it('returns true when fetch resolves with a 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404 }));
    expect(await checkCallbackAvailability('https://example.com/hook')).toBe(true);
  });

  it('returns false when fetch throws a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await checkCallbackAvailability('https://unreachable.example.com/hook')).toBe(false);
  });

  it('returns false when fetch times out (AbortError)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError')));
    expect(await checkCallbackAvailability('https://slow.example.com/hook')).toBe(false);
  });
});

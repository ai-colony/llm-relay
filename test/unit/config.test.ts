// A real .env file in the working directory (e.g. a developer's local `.env` for running the
// server) must not leak into these tests: dotenv's `config()` populates any process.env key that
// isn't already set, which silently undoes `withEnvironment`'s deletions and makes assertions like
// "config.embedding is undefined when EMBEDDING_URL is unset" depend on the machine running them.
vi.mock('dotenv', () => ({ config: vi.fn() }));

import { withEnvironment } from '../helpers/environment';

describe('config', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports config with the expected structure', async () => {
    const { config } = await import('../../src/lib/config');
    expect(config).toMatchObject({
      log: { level: expect.any(String) },
      http: { port: expect.any(Number) },
      database: { filename: expect.any(String) },
      generative: {
        url: expect.any(String),
        model: expect.any(String),
        key: expect.any(String)
      },
      upstream: {
        timeout: expect.any(Number),
        maxRetryCount: expect.any(Number),
        modelCacheTtlMs: expect.any(Number)
      },
      worker: { concurrency: expect.any(Number) }
    });
  });

  it('reads PORT from the environment', async () => {
    await withEnvironment({ PORT: '9999' }, async () => {
      const { config } = await import('../../src/lib/config');
      expect(config.http.port).toBe(9999);
    });
  });

  it('rejects PORT=0', async () => {
    await withEnvironment({ PORT: '0' }, async () => {
      await expect(import('../../src/lib/config')).rejects.toThrow();
    });
  });

  it('rejects PORT=65536', async () => {
    await withEnvironment({ PORT: '65536' }, async () => {
      await expect(import('../../src/lib/config')).rejects.toThrow();
    });
  });

  it('reads UPSTREAM_TIMEOUT from the environment', async () => {
    await withEnvironment({ UPSTREAM_TIMEOUT: '30000' }, async () => {
      const { config } = await import('../../src/lib/config');
      expect(config.upstream.timeout).toBe(30_000);
    });
  });

  it('rejects UPSTREAM_TIMEOUT below 100', async () => {
    await withEnvironment({ UPSTREAM_TIMEOUT: '99' }, async () => {
      await expect(import('../../src/lib/config')).rejects.toThrow('UPSTREAM_TIMEOUT must be at least 100');
    });
  });

  it('rejects UPSTREAM_TIMEOUT=0', async () => {
    await withEnvironment({ UPSTREAM_TIMEOUT: '0' }, async () => {
      await expect(import('../../src/lib/config')).rejects.toThrow('UPSTREAM_TIMEOUT must be at least 100');
    });
  });

  it('reads UPSTREAM_MAX_RETRY_COUNT from the environment', async () => {
    await withEnvironment({ UPSTREAM_MAX_RETRY_COUNT: '5' }, async () => {
      const { config } = await import('../../src/lib/config');
      expect(config.upstream.maxRetryCount).toBe(5);
    });
  });

  it('accepts UPSTREAM_MAX_RETRY_COUNT=0', async () => {
    await withEnvironment({ UPSTREAM_MAX_RETRY_COUNT: '0' }, async () => {
      const { config } = await import('../../src/lib/config');
      expect(config.upstream.maxRetryCount).toBe(0);
    });
  });

  it('rejects negative UPSTREAM_MAX_RETRY_COUNT', async () => {
    await withEnvironment({ UPSTREAM_MAX_RETRY_COUNT: '-1' }, async () => {
      await expect(import('../../src/lib/config')).rejects.toThrow('UPSTREAM_MAX_RETRY_COUNT must be at least 0');
    });
  });

  // The rename to GENERATIVE_*/UPSTREAM_* is deliberately hard: an old OPENAI_* value must not be
  // read, and the failure is silent (the default wins), so it is pinned by a test.
  it('ignores the pre-2.0 OPENAI_URL and falls back to the GENERATIVE_URL default', async () => {
    await withEnvironment({ OPENAI_URL: 'http://stale-host:9999/v1', GENERATIVE_URL: undefined }, async () => {
      const { config } = await import('../../src/lib/config');
      expect(config.generative.url).toBe('http://localhost:8080/v1');
    });
  });

  it('reads WORKER_CONCURRENCY from the environment', async () => {
    await withEnvironment({ WORKER_CONCURRENCY: '4' }, async () => {
      const { config } = await import('../../src/lib/config');
      expect(config.worker.concurrency).toBe(4);
    });
  });

  it('clamps WORKER_CONCURRENCY to 16', async () => {
    await withEnvironment({ WORKER_CONCURRENCY: '100' }, async () => {
      const { config } = await import('../../src/lib/config');
      expect(config.worker.concurrency).toBe(16);
    });
  });

  it('rejects invalid GENERATIVE_URL', async () => {
    await withEnvironment({ GENERATIVE_URL: 'not-a-url' }, async () => {
      await expect(import('../../src/lib/config')).rejects.toThrow();
    });
  });

  it('accepts a valid GENERATIVE_URL', async () => {
    await withEnvironment({ GENERATIVE_URL: 'http://my-llm-server:8080/v1' }, async () => {
      const { config } = await import('../../src/lib/config');
      expect(config.generative.url).toBe('http://my-llm-server:8080/v1');
    });
  });

  describe('embedding', () => {
    it('leaves config.embedding undefined when EMBEDDING_URL is unset', async () => {
      await withEnvironment({ EMBEDDING_URL: undefined }, async () => {
        const { config } = await import('../../src/lib/config');
        expect(config.embedding).toBeUndefined();
      });
    });

    it('leaves config.embedding undefined when EMBEDDING_URL is empty', async () => {
      await withEnvironment({ EMBEDDING_URL: '' }, async () => {
        const { config } = await import('../../src/lib/config');
        expect(config.embedding).toBeUndefined();
      });
    });

    it('populates config.embedding when EMBEDDING_URL is set', async () => {
      await withEnvironment(
        { EMBEDDING_URL: 'http://localhost:8081/v1', EMBEDDING_MODEL: 'embed-model', EMBEDDING_KEY: 'secret' },
        async () => {
          const { config } = await import('../../src/lib/config');
          expect(config.embedding).toEqual({
            url: 'http://localhost:8081/v1',
            model: 'embed-model',
            key: 'secret'
          });
        }
      );
    });

    it('defaults model to empty and key to none', async () => {
      await withEnvironment(
        { EMBEDDING_URL: 'http://localhost:8081/v1', EMBEDDING_MODEL: undefined, EMBEDDING_KEY: undefined },
        async () => {
          const { config } = await import('../../src/lib/config');
          expect(config.embedding?.model).toBe('');
          expect(config.embedding?.key).toBe('none');
        }
      );
    });

    it('rejects an invalid EMBEDDING_URL', async () => {
      await withEnvironment({ EMBEDDING_URL: 'not-a-url' }, async () => {
        await expect(import('../../src/lib/config')).rejects.toThrow();
      });
    });
  });

  it('rejects invalid LOG_LEVEL', async () => {
    await withEnvironment({ LOG_LEVEL: 'verbose' }, async () => {
      await expect(import('../../src/lib/config')).rejects.toThrow();
    });
  });

  it('accepts all valid LOG_LEVEL values', async () => {
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      vi.resetModules();
      await withEnvironment({ LOG_LEVEL: level }, async () => {
        const { config } = await import('../../src/lib/config');
        expect(config.log.level).toBe(level);
      });
    }
  });

  it('rejects CALLBACK_RETRY_TTL_HOURS=0', async () => {
    await withEnvironment({ CALLBACK_RETRY_TTL_HOURS: '0' }, async () => {
      await expect(import('../../src/lib/config')).rejects.toThrow('CALLBACK_RETRY_TTL_HOURS must be at least 1');
    });
  });

  it('rejects negative CALLBACK_RETRY_TTL_HOURS', async () => {
    await withEnvironment({ CALLBACK_RETRY_TTL_HOURS: '-5' }, async () => {
      await expect(import('../../src/lib/config')).rejects.toThrow();
    });
  });

  it('reads CALLBACK_HMAC_SECRET from the environment', async () => {
    await withEnvironment({ CALLBACK_HMAC_SECRET: 'supersecret' }, async () => {
      const { config } = await import('../../src/lib/config');
      expect(config.callback.hmacSecret).toBe('supersecret');
    });
  });

  it('leaves callback.hmacSecret as empty string when CALLBACK_HMAC_SECRET is not set', async () => {
    await withEnvironment({ CALLBACK_HMAC_SECRET: undefined }, async () => {
      const { config } = await import('../../src/lib/config');
      expect(config.callback.hmacSecret).toBe('');
    });
  });

  it('compiles a valid CALLBACK_URL_ALLOWLIST into a RegExp', async () => {
    await withEnvironment({ CALLBACK_URL_ALLOWLIST: String.raw`^https://.*\.example\.com$` }, async () => {
      const { config } = await import('../../src/lib/config');
      expect(config.callback.urlAllowlist).toBeInstanceOf(RegExp);
      expect(config.callback.urlAllowlist?.test('https://api.example.com')).toBe(true);
    });
  });

  it('rejects an invalid CALLBACK_URL_ALLOWLIST regex', async () => {
    await withEnvironment({ CALLBACK_URL_ALLOWLIST: '[' }, async () => {
      await expect(import('../../src/lib/config')).rejects.toThrow('is not a valid regex');
    });
  });

  it('leaves callback.urlAllowlist undefined when CALLBACK_URL_ALLOWLIST is not set', async () => {
    await withEnvironment({ CALLBACK_URL_ALLOWLIST: undefined }, async () => {
      const { config } = await import('../../src/lib/config');
      expect(config.callback.urlAllowlist).toBeUndefined();
    });
  });
});

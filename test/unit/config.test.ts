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
      openai: {
        url: expect.any(String),
        model: expect.any(String),
        key: expect.any(String),
        timeout: expect.any(Number),
        maxRetryCount: expect.any(Number)
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

  it('reads OPENAI_TIMEOUT from the environment', async () => {
    await withEnvironment({ OPENAI_TIMEOUT: '30000' }, async () => {
      const { config } = await import('../../src/lib/config');
      expect(config.openai.timeout).toBe(30_000);
    });
  });

  it('rejects OPENAI_TIMEOUT below 100', async () => {
    await withEnvironment({ OPENAI_TIMEOUT: '99' }, async () => {
      await expect(import('../../src/lib/config')).rejects.toThrow('OPENAI_TIMEOUT must be at least 100');
    });
  });

  it('rejects OPENAI_TIMEOUT=0', async () => {
    await withEnvironment({ OPENAI_TIMEOUT: '0' }, async () => {
      await expect(import('../../src/lib/config')).rejects.toThrow('OPENAI_TIMEOUT must be at least 100');
    });
  });

  it('reads OPENAI_MAX_RETRY_COUNT from the environment', async () => {
    await withEnvironment({ OPENAI_MAX_RETRY_COUNT: '5' }, async () => {
      const { config } = await import('../../src/lib/config');
      expect(config.openai.maxRetryCount).toBe(5);
    });
  });

  it('accepts OPENAI_MAX_RETRY_COUNT=0', async () => {
    await withEnvironment({ OPENAI_MAX_RETRY_COUNT: '0' }, async () => {
      const { config } = await import('../../src/lib/config');
      expect(config.openai.maxRetryCount).toBe(0);
    });
  });

  it('rejects negative OPENAI_MAX_RETRY_COUNT', async () => {
    await withEnvironment({ OPENAI_MAX_RETRY_COUNT: '-1' }, async () => {
      await expect(import('../../src/lib/config')).rejects.toThrow('OPENAI_MAX_RETRY_COUNT must be at least 0');
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

  it('rejects invalid OPENAI_URL', async () => {
    await withEnvironment({ OPENAI_URL: 'not-a-url' }, async () => {
      await expect(import('../../src/lib/config')).rejects.toThrow();
    });
  });

  it('accepts a valid OPENAI_URL', async () => {
    await withEnvironment({ OPENAI_URL: 'http://my-llm-server:8080/v1' }, async () => {
      const { config } = await import('../../src/lib/config');
      expect(config.openai.url).toBe('http://my-llm-server:8080/v1');
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

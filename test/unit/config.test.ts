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
    const saved = process.env.PORT;
    process.env.PORT = '9999';
    const { config } = await import('../../src/lib/config');
    expect(config.http.port).toBe(9999);
    if (saved === undefined) delete process.env.PORT;
    else process.env.PORT = saved;
  });

  it('rejects PORT=0', async () => {
    const saved = process.env.PORT;
    process.env.PORT = '0';
    await expect(import('../../src/lib/config')).rejects.toThrow();
    if (saved === undefined) delete process.env.PORT;
    else process.env.PORT = saved;
  });

  it('rejects PORT=65536', async () => {
    const saved = process.env.PORT;
    process.env.PORT = '65536';
    await expect(import('../../src/lib/config')).rejects.toThrow();
    if (saved === undefined) delete process.env.PORT;
    else process.env.PORT = saved;
  });

  it('reads OPENAI_TIMEOUT from the environment', async () => {
    const saved = process.env.OPENAI_TIMEOUT;
    process.env.OPENAI_TIMEOUT = '30000';
    const { config } = await import('../../src/lib/config');
    expect(config.openai.timeout).toBe(30_000);
    if (saved === undefined) delete process.env.OPENAI_TIMEOUT;
    else process.env.OPENAI_TIMEOUT = saved;
  });

  it('rejects OPENAI_TIMEOUT below 100', async () => {
    const saved = process.env.OPENAI_TIMEOUT;
    process.env.OPENAI_TIMEOUT = '99';
    await expect(import('../../src/lib/config')).rejects.toThrow('OPENAI_TIMEOUT must be at least 100');
    if (saved === undefined) delete process.env.OPENAI_TIMEOUT;
    else process.env.OPENAI_TIMEOUT = saved;
  });

  it('rejects OPENAI_TIMEOUT=0', async () => {
    const saved = process.env.OPENAI_TIMEOUT;
    process.env.OPENAI_TIMEOUT = '0';
    await expect(import('../../src/lib/config')).rejects.toThrow('OPENAI_TIMEOUT must be at least 100');
    if (saved === undefined) delete process.env.OPENAI_TIMEOUT;
    else process.env.OPENAI_TIMEOUT = saved;
  });

  it('reads OPENAI_MAX_RETRY_COUNT from the environment', async () => {
    const saved = process.env.OPENAI_MAX_RETRY_COUNT;
    process.env.OPENAI_MAX_RETRY_COUNT = '5';
    const { config } = await import('../../src/lib/config');
    expect(config.openai.maxRetryCount).toBe(5);
    if (saved === undefined) delete process.env.OPENAI_MAX_RETRY_COUNT;
    else process.env.OPENAI_MAX_RETRY_COUNT = saved;
  });

  it('accepts OPENAI_MAX_RETRY_COUNT=0', async () => {
    const saved = process.env.OPENAI_MAX_RETRY_COUNT;
    process.env.OPENAI_MAX_RETRY_COUNT = '0';
    const { config } = await import('../../src/lib/config');
    expect(config.openai.maxRetryCount).toBe(0);
    if (saved === undefined) delete process.env.OPENAI_MAX_RETRY_COUNT;
    else process.env.OPENAI_MAX_RETRY_COUNT = saved;
  });

  it('rejects negative OPENAI_MAX_RETRY_COUNT', async () => {
    const saved = process.env.OPENAI_MAX_RETRY_COUNT;
    process.env.OPENAI_MAX_RETRY_COUNT = '-1';
    await expect(import('../../src/lib/config')).rejects.toThrow('OPENAI_MAX_RETRY_COUNT must be at least 0');
    if (saved === undefined) delete process.env.OPENAI_MAX_RETRY_COUNT;
    else process.env.OPENAI_MAX_RETRY_COUNT = saved;
  });

  it('reads WORKER_CONCURRENCY from the environment', async () => {
    const saved = process.env.WORKER_CONCURRENCY;
    process.env.WORKER_CONCURRENCY = '4';
    const { config } = await import('../../src/lib/config');
    expect(config.worker.concurrency).toBe(4);
    if (saved === undefined) delete process.env.WORKER_CONCURRENCY;
    else process.env.WORKER_CONCURRENCY = saved;
  });

  it('clamps WORKER_CONCURRENCY to 16', async () => {
    const saved = process.env.WORKER_CONCURRENCY;
    process.env.WORKER_CONCURRENCY = '100';
    const { config } = await import('../../src/lib/config');
    expect(config.worker.concurrency).toBe(16);
    if (saved === undefined) delete process.env.WORKER_CONCURRENCY;
    else process.env.WORKER_CONCURRENCY = saved;
  });

  it('rejects invalid OPENAI_URL', async () => {
    const saved = process.env.OPENAI_URL;
    process.env.OPENAI_URL = 'not-a-url';
    await expect(import('../../src/lib/config')).rejects.toThrow();
    if (saved === undefined) delete process.env.OPENAI_URL;
    else process.env.OPENAI_URL = saved;
  });

  it('accepts a valid OPENAI_URL', async () => {
    const saved = process.env.OPENAI_URL;
    process.env.OPENAI_URL = 'http://my-llm-server:8080/v1';
    const { config } = await import('../../src/lib/config');
    expect(config.openai.url).toBe('http://my-llm-server:8080/v1');
    if (saved === undefined) delete process.env.OPENAI_URL;
    else process.env.OPENAI_URL = saved;
  });

  it('rejects invalid LOG_LEVEL', async () => {
    const saved = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'verbose';
    await expect(import('../../src/lib/config')).rejects.toThrow();
    if (saved === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = saved;
  });

  it('accepts all valid LOG_LEVEL values', async () => {
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      vi.resetModules();
      const saved = process.env.LOG_LEVEL;
      process.env.LOG_LEVEL = level;
      const { config } = await import('../../src/lib/config');
      expect(config.log.level).toBe(level);
      if (saved === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = saved;
    }
  });

  it('rejects CALLBACK_RETRY_TTL_HOURS=0', async () => {
    const saved = process.env.CALLBACK_RETRY_TTL_HOURS;
    process.env.CALLBACK_RETRY_TTL_HOURS = '0';
    await expect(import('../../src/lib/config')).rejects.toThrow('CALLBACK_RETRY_TTL_HOURS must be at least 1');
    if (saved === undefined) delete process.env.CALLBACK_RETRY_TTL_HOURS;
    else process.env.CALLBACK_RETRY_TTL_HOURS = saved;
  });

  it('rejects negative CALLBACK_RETRY_TTL_HOURS', async () => {
    const saved = process.env.CALLBACK_RETRY_TTL_HOURS;
    process.env.CALLBACK_RETRY_TTL_HOURS = '-5';
    await expect(import('../../src/lib/config')).rejects.toThrow();
    if (saved === undefined) delete process.env.CALLBACK_RETRY_TTL_HOURS;
    else process.env.CALLBACK_RETRY_TTL_HOURS = saved;
  });

  it('reads CALLBACK_HMAC_SECRET from the environment', async () => {
    const saved = process.env.CALLBACK_HMAC_SECRET;
    process.env.CALLBACK_HMAC_SECRET = 'supersecret';
    const { config } = await import('../../src/lib/config');
    expect(config.callback.hmacSecret).toBe('supersecret');
    if (saved === undefined) delete process.env.CALLBACK_HMAC_SECRET;
    else process.env.CALLBACK_HMAC_SECRET = saved;
  });

  it('leaves callback.hmacSecret as empty string when CALLBACK_HMAC_SECRET is not set', async () => {
    const saved = process.env.CALLBACK_HMAC_SECRET;
    delete process.env.CALLBACK_HMAC_SECRET;
    const { config } = await import('../../src/lib/config');
    expect(config.callback.hmacSecret).toBe('');
    if (saved !== undefined) process.env.CALLBACK_HMAC_SECRET = saved;
  });

  it('compiles a valid CALLBACK_URL_ALLOWLIST into a RegExp', async () => {
    const saved = process.env.CALLBACK_URL_ALLOWLIST;
    process.env.CALLBACK_URL_ALLOWLIST = String.raw`^https://.*\.example\.com$`;
    const { config } = await import('../../src/lib/config');
    expect(config.callback.urlAllowlist).toBeInstanceOf(RegExp);
    expect(config.callback.urlAllowlist?.test('https://api.example.com')).toBe(true);
    if (saved === undefined) delete process.env.CALLBACK_URL_ALLOWLIST;
    else process.env.CALLBACK_URL_ALLOWLIST = saved;
  });

  it('rejects an invalid CALLBACK_URL_ALLOWLIST regex', async () => {
    const saved = process.env.CALLBACK_URL_ALLOWLIST;
    process.env.CALLBACK_URL_ALLOWLIST = '[';
    await expect(import('../../src/lib/config')).rejects.toThrow('is not a valid regex');
    if (saved === undefined) delete process.env.CALLBACK_URL_ALLOWLIST;
    else process.env.CALLBACK_URL_ALLOWLIST = saved;
  });

  it('leaves callback.urlAllowlist undefined when CALLBACK_URL_ALLOWLIST is not set', async () => {
    const saved = process.env.CALLBACK_URL_ALLOWLIST;
    delete process.env.CALLBACK_URL_ALLOWLIST;
    const { config } = await import('../../src/lib/config');
    expect(config.callback.urlAllowlist).toBeUndefined();
    if (saved !== undefined) process.env.CALLBACK_URL_ALLOWLIST = saved;
  });
});

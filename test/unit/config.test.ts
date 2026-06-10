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
      }
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

  it('reads OPENAI_TIMEOUT from the environment', async () => {
    const saved = process.env.OPENAI_TIMEOUT;
    process.env.OPENAI_TIMEOUT = '30000';
    const { config } = await import('../../src/lib/config');
    expect(config.openai.timeout).toBe(30_000);
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
});

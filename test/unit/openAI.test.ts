vi.mock('../../src/lib/config', () => ({
  config: {
    openai: { url: 'http://test-server/v1', model: 'test-model', key: 'test-key', timeout: 5000 },
    log: { level: 'silent' },
    http: { port: 3000 },
    database: { filename: ':memory:' }
  }
}));

vi.mock('../../src/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

const { mockModelsList, mockCompletionsCreate } = vi.hoisted(() => ({
  mockModelsList: vi.fn(),
  mockCompletionsCreate: vi.fn()
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    models = { list: mockModelsList };
    chat = { completions: { create: mockCompletionsCreate } };
  }
}));

import { checkOpenAI, executeOpenAIPrompt, streamChatCompletion } from '../../src/lib/openAI';

function makeStream(chunks: Array<{ reasoning_content?: string; content?: string }>) {
  return (async function* () {
    for (const chunk of chunks) yield { choices: [{ delta: chunk }] };
  })();
}

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

describe('executeOpenAIPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', makeModelsFetch([{ id: 'test-model', meta: { n_ctx: 32_768 } }]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns reasoning and response from a mixed stream', async () => {
    mockCompletionsCreate.mockResolvedValue(
      makeStream([{ reasoning_content: 'think ' }, { reasoning_content: 'harder' }, { content: 'answer' }])
    );

    const result = await executeOpenAIPrompt({ system: 'be helpful', user: 'hello' }, 0.7);

    expect(result.reasoning).toBe('think harder');
    expect(result.response).toBe('answer');
    expect(result.timing.reasoningTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.timing.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('returns zero reasoning timings when only response content is present', async () => {
    mockCompletionsCreate.mockResolvedValue(makeStream([{ content: 'only' }, { content: ' response' }]));

    const result = await executeOpenAIPrompt({ system: undefined, user: 'hi' }, 0);

    expect(result.reasoning).toBe('');
    expect(result.response).toBe('only response');
    expect(result.timing.reasoningTimeMs).toBe(0);
    expect(result.timing.reasoningTokenPerSecond).toBe(0);
  });

  it('returns empty strings and zero timings for an empty stream', async () => {
    mockCompletionsCreate.mockResolvedValue(makeStream([]));

    const result = await executeOpenAIPrompt({ system: undefined, user: 'hi' }, 0);

    expect(result.reasoning).toBe('');
    expect(result.response).toBe('');
    expect(result.timing.reasoningTimeMs).toBe(0);
    expect(result.timing.responseTimeMs).toBe(0);
    expect(result.timing.reasoningTokenPerSecond).toBe(0);
    expect(result.timing.responseTokenPerSecond).toBe(0);
  });

  it('approximates token counts using chars/4', async () => {
    mockCompletionsCreate.mockResolvedValue(
      makeStream([{ reasoning_content: 'a'.repeat(400) }, { content: 'b'.repeat(200) }])
    );

    const result = await executeOpenAIPrompt({ system: undefined, user: 'test' }, 0);

    // 400 chars → 100 reasoning tokens; 200 chars → 50 response tokens
    expect(result.timing.reasoningTokenPerSecond).toBeGreaterThanOrEqual(0);
    expect(result.timing.responseTokenPerSecond).toBeGreaterThanOrEqual(0);
  });

  it('builds messages without a system prompt when system is undefined', async () => {
    mockCompletionsCreate.mockResolvedValue(makeStream([{ content: 'ok' }]));

    await executeOpenAIPrompt({ system: undefined, user: 'test' }, 0.5);

    const callArguments = mockCompletionsCreate.mock.calls[0]?.[0] as { messages: unknown[] };
    expect(callArguments.messages).toHaveLength(1);
    expect(callArguments.messages[0]).toMatchObject({ role: 'user', content: 'test' });
  });

  it('includes a system message when system is provided', async () => {
    mockCompletionsCreate.mockResolvedValue(makeStream([{ content: 'ok' }]));

    await executeOpenAIPrompt({ system: 'sys prompt', user: 'test' }, 0.5);

    const callArguments = mockCompletionsCreate.mock.calls[0]?.[0] as { messages: unknown[] };
    expect(callArguments.messages).toHaveLength(2);
    expect(callArguments.messages[0]).toMatchObject({ role: 'system', content: 'sys prompt' });
  });
});

describe('streamChatCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', makeModelsFetch([{ id: 'test-model', meta: { n_ctx: 32_768 } }]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('yields all chunks from the upstream completion', async () => {
    const chunks = [{ choices: [{ delta: { content: 'a' } }] }, { choices: [{ delta: { content: 'b' } }] }];
    mockCompletionsCreate.mockResolvedValue(
      (async function* () {
        for (const c of chunks) yield c;
      })()
    );

    const result: unknown[] = await Array.fromAsync(streamChatCompletion([{ role: 'user', content: 'hi' }]));

    expect(result).toEqual(chunks);
  });

  it('forwards the AbortSignal to the OpenAI SDK', async () => {
    mockCompletionsCreate.mockResolvedValue((async function* () {})());
    const controller = new AbortController();

    await Array.fromAsync(
      streamChatCompletion([{ role: 'user', content: 'hi' }], undefined, undefined, controller.signal)
    );

    expect(mockCompletionsCreate).toHaveBeenCalledWith(expect.objectContaining({ stream: true }), {
      signal: controller.signal
    });
  });

  it('passes undefined signal when none is provided', async () => {
    mockCompletionsCreate.mockResolvedValue((async function* () {})());

    await Array.fromAsync(streamChatCompletion([{ role: 'user', content: 'hi' }]));

    expect(mockCompletionsCreate).toHaveBeenCalledWith(expect.objectContaining({ stream: true }), {
      signal: undefined
    });
  });
});

const makeOpenAIMock = () => ({
  default: class MockOpenAI {
    models = { list: mockModelsList };
    chat = { completions: { create: mockCompletionsCreate } };
  }
});

const makeConfigMock = (model: string, modelCacheTtlMs = 60_000) => ({
  config: {
    openai: { url: 'http://test/v1', model, key: 'k', timeout: 5000, modelCacheTtlMs },
    log: {},
    http: {},
    database: {}
  }
});

const makeLoggerMock = () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } });

function makeModelsFetch(
  data: Array<{ id: string; meta?: { n_ctx?: number } }>,
  isOk = true
): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: isOk,
    status: isOk ? 200 : 503,
    json: () => Promise.resolve({ data })
  });
}

describe('resolveModel / resolveModelInfo', () => {
  beforeEach(() => {
    vi.resetModules();
    mockModelsList.mockReset();
    mockCompletionsCreate.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves the model only once across multiple executeOpenAIPrompt calls', async () => {
    vi.doMock('openai', makeOpenAIMock);
    vi.doMock('../../src/lib/config', () => makeConfigMock('test-model'));
    vi.doMock('../../src/lib/logger', makeLoggerMock);

    const mockFetch = makeModelsFetch([{ id: 'test-model', meta: { n_ctx: 32_768 } }]);
    vi.stubGlobal('fetch', mockFetch);
    mockCompletionsCreate.mockResolvedValue(makeStream([{ content: 'ok' }]));

    const { executeOpenAIPrompt: exec } = await import('../../src/lib/openAI');
    await exec({ system: undefined, user: 'first' }, 0);
    await exec({ system: undefined, user: 'second' }, 0);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the first available model when config.openai.model is empty', async () => {
    vi.doMock('openai', makeOpenAIMock);
    vi.doMock('../../src/lib/config', () => makeConfigMock(''));
    vi.doMock('../../src/lib/logger', makeLoggerMock);

    vi.stubGlobal('fetch', makeModelsFetch([{ id: 'first-model' }, { id: 'second-model' }]));
    mockCompletionsCreate.mockResolvedValue(makeStream([{ content: 'ok' }]));

    const { executeOpenAIPrompt: exec } = await import('../../src/lib/openAI');
    await exec({ system: undefined, user: 'hi' }, 0);

    const callArguments = mockCompletionsCreate.mock.calls[0]?.[0] as { model: string };
    expect(callArguments.model).toBe('first-model');
  });

  it('throws when the configured model is not in the available list', async () => {
    vi.doMock('openai', makeOpenAIMock);
    vi.doMock('../../src/lib/config', () => makeConfigMock('missing-model'));
    vi.doMock('../../src/lib/logger', makeLoggerMock);

    vi.stubGlobal('fetch', makeModelsFetch([{ id: 'other-model' }]));

    const { executeOpenAIPrompt: exec } = await import('../../src/lib/openAI');
    await expect(exec({ system: undefined, user: 'hi' }, 0)).rejects.toThrow('No models found');
  });

  it('resets the cached promise on error so the next call retries model resolution', async () => {
    vi.doMock('openai', makeOpenAIMock);
    vi.doMock('../../src/lib/config', () => makeConfigMock('test-model'));
    vi.doMock('../../src/lib/logger', makeLoggerMock);

    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary API failure'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [{ id: 'test-model', meta: { n_ctx: 32_768 } }] })
      });
    vi.stubGlobal('fetch', mockFetch);
    mockCompletionsCreate.mockResolvedValue(makeStream([{ content: 'ok' }]));

    const { executeOpenAIPrompt: exec } = await import('../../src/lib/openAI');
    await expect(exec({ system: undefined, user: 'first' }, 0)).rejects.toThrow('temporary API failure');
    await exec({ system: undefined, user: 'second' }, 0);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('includes contextSize from meta.n_ctx in getModelInfo result', async () => {
    vi.doMock('openai', makeOpenAIMock);
    vi.doMock('../../src/lib/config', () => makeConfigMock('test-model'));
    vi.doMock('../../src/lib/logger', makeLoggerMock);

    vi.stubGlobal('fetch', makeModelsFetch([{ id: 'test-model', meta: { n_ctx: 32_768 } }]));

    const { getModelInfo } = await import('../../src/lib/openAI');
    const info = await getModelInfo();

    expect(info.model).toBe('test-model');
    expect(info.contextSize).toBe(32_768);
  });

  it('strips directory path from model id, returning only the filename', async () => {
    vi.doMock('openai', makeOpenAIMock);
    vi.doMock('../../src/lib/config', () => makeConfigMock(''));
    vi.doMock('../../src/lib/logger', makeLoggerMock);

    vi.stubGlobal('fetch', makeModelsFetch([{ id: '/Users/user/models/Qwen3.5-9B.gguf', meta: { n_ctx: 32_768 } }]));

    const { getModelInfo } = await import('../../src/lib/openAI');
    const info = await getModelInfo();

    expect(info.model).toBe('Qwen3.5-9B.gguf');
  });

  it('returns contextSize as undefined when meta is absent', async () => {
    vi.doMock('openai', makeOpenAIMock);
    vi.doMock('../../src/lib/config', () => makeConfigMock('test-model'));
    vi.doMock('../../src/lib/logger', makeLoggerMock);

    vi.stubGlobal('fetch', makeModelsFetch([{ id: 'test-model' }]));

    const { getModelInfo } = await import('../../src/lib/openAI');
    const info = await getModelInfo();

    expect(info.contextSize).toBeUndefined();
  });

  it('re-resolves the model once the cache TTL has elapsed', async () => {
    vi.doMock('openai', makeOpenAIMock);
    vi.doMock('../../src/lib/config', () => makeConfigMock('', 1));
    vi.doMock('../../src/lib/logger', makeLoggerMock);

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ data: [{ id: 'old-model' }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ data: [{ id: 'new-model' }] }) });
    vi.stubGlobal('fetch', mockFetch);

    const { getModelInfo } = await import('../../src/lib/openAI');
    const first = await getModelInfo();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await getModelInfo();

    expect(first.model).toBe('old-model');
    expect(second.model).toBe('new-model');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

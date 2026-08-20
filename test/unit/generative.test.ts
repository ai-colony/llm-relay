function makeOpenAIMock() {
  return {
    default: class MockOpenAI {
      chat = { completions: { create: mockCompletionsCreate } };
    }
  };
}

function makeConfigMock(model: string, modelCacheTtlMs = 60_000, contextSize?: number, reasoningEffort = 'none') {
  return {
    config: {
      generative: { url: 'http://test/v1', model, key: 'k', contextSize },
      embedding: undefined,
      reasoning: { effort: reasoningEffort },
      upstream: { timeout: 5000, maxRetryCount: 10, modelCacheTtlMs },
      log: { level: 'silent' },
      http: { port: 3000 },
      database: { filename: ':memory:' }
    }
  };
}

function makeLoggerMock() {
  return { logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } };
}

// One config factory for the whole file, so upstream.modelCacheTtlMs — which the model resolver
// reads when deciding whether the cached model is stale — can never be missing from one mock and
// present in another.
vi.mock('../../src/lib/config', () => makeConfigMock('test-model'));

vi.mock('../../src/lib/logger', () => makeLoggerMock());

const { mockCompletionsCreate } = vi.hoisted(() => ({ mockCompletionsCreate: vi.fn() }));

vi.mock('openai', () => makeOpenAIMock());

import { checkGenerative, executeGenerativePrompt, streamChatCompletion } from '../../src/lib/generative';

function makeStream(chunks: Array<{ reasoning_content?: string; content?: string }>) {
  return (async function* () {
    for (const chunk of chunks) yield { choices: [{ delta: chunk }] };
  })();
}

describe('checkGenerative', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok true when the models endpoint responds with 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const result = await checkGenerative();
    expect(result).toEqual({ ok: true });
  });

  it('returns ok false with an HTTP error message when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const result = await checkGenerative();
    expect(result).toEqual({ ok: false, error: 'HTTP 503' });
  });

  it('returns ok false with the error string when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    const result = await checkGenerative();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('connection refused');
  });
});

describe('executeGenerativePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', makeModelsFetch([{ id: 'test-model', meta: { n_ctx: 32_768 } }]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The worker path burns thinking tokens on every queued document, so it must carry the same
  // setting as the streaming one — they share reasoningParameters() precisely so they cannot drift.
  it('asks the backend not to reason by default', async () => {
    mockCompletionsCreate.mockResolvedValue(makeStream([{ content: 'answer' }]));

    await executeGenerativePrompt({ system: undefined, user: 'hello' }, 0.7);

    expect(mockCompletionsCreate.mock.calls[0]?.[0]).toMatchObject({ reasoning_effort: 'none' });
  });

  it('returns reasoning and response from a mixed stream', async () => {
    mockCompletionsCreate.mockResolvedValue(
      makeStream([{ reasoning_content: 'think ' }, { reasoning_content: 'harder' }, { content: 'answer' }])
    );

    const result = await executeGenerativePrompt({ system: 'be helpful', user: 'hello' }, 0.7);

    expect(result.reasoning).toBe('think harder');
    expect(result.response).toBe('answer');
    expect(result.timing.reasoningTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.timing.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('returns zero reasoning timings when only response content is present', async () => {
    mockCompletionsCreate.mockResolvedValue(makeStream([{ content: 'only' }, { content: ' response' }]));

    const result = await executeGenerativePrompt({ system: undefined, user: 'hi' }, 0);

    expect(result.reasoning).toBe('');
    expect(result.response).toBe('only response');
    expect(result.timing.reasoningTimeMs).toBe(0);
    expect(result.timing.reasoningTokenPerSecond).toBe(0);
  });

  it('returns empty strings and zero timings for an empty stream', async () => {
    mockCompletionsCreate.mockResolvedValue(makeStream([]));

    const result = await executeGenerativePrompt({ system: undefined, user: 'hi' }, 0);

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

    const result = await executeGenerativePrompt({ system: undefined, user: 'test' }, 0);

    // 400 chars → 100 reasoning tokens; 200 chars → 50 response tokens
    expect(result.timing.reasoningTokenPerSecond).toBeGreaterThanOrEqual(0);
    expect(result.timing.responseTokenPerSecond).toBeGreaterThanOrEqual(0);
  });

  it('builds messages without a system prompt when system is undefined', async () => {
    mockCompletionsCreate.mockResolvedValue(makeStream([{ content: 'ok' }]));

    await executeGenerativePrompt({ system: undefined, user: 'test' }, 0.5);

    const callArguments = mockCompletionsCreate.mock.calls[0]?.[0] as { messages: unknown[] };
    expect(callArguments.messages).toHaveLength(1);
    expect(callArguments.messages[0]).toMatchObject({ role: 'user', content: 'test' });
  });

  it('includes a system message when system is provided', async () => {
    mockCompletionsCreate.mockResolvedValue(makeStream([{ content: 'ok' }]));

    await executeGenerativePrompt({ system: 'sys prompt', user: 'test' }, 0.5);

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

  // Thinking off is the default because a reasoning model can loop on one passage until its output
  // budget is gone, returning finish_reason "length" with no content. A llama.cpp backend closes
  // that off with server flags; a hosted one has no flags, so the request is the only place to.
  it('asks the backend not to reason by default', async () => {
    mockCompletionsCreate.mockResolvedValue((async function* () {})());

    await Array.fromAsync(streamChatCompletion([{ role: 'user', content: 'hi' }]));

    expect(mockCompletionsCreate.mock.calls[0]?.[0]).toMatchObject({ reasoning_effort: 'none' });
  });

  it('passes an explicitly configured effort level through', async () => {
    vi.resetModules();
    vi.doMock('../../src/lib/config', () => makeConfigMock('test-model', 60_000, undefined, 'high'));
    const { streamChatCompletion: streamWithHigh } = await import('../../src/lib/generative');
    mockCompletionsCreate.mockResolvedValue((async function* () {})());

    await Array.fromAsync(streamWithHigh([{ role: 'user', content: 'hi' }]));

    expect(mockCompletionsCreate.mock.calls[0]?.[0]).toMatchObject({ reasoning_effort: 'high' });
  });

  // The escape hatch for a backend that decides for itself — a llama.cpp server already configured
  // with --reasoning, or one that rejects the field outright.
  it('omits the parameter entirely when the effort is "default"', async () => {
    vi.resetModules();
    vi.doMock('../../src/lib/config', () => makeConfigMock('test-model', 60_000, undefined, 'default'));
    const { streamChatCompletion: streamWithDefault } = await import('../../src/lib/generative');
    mockCompletionsCreate.mockResolvedValue((async function* () {})());

    await Array.fromAsync(streamWithDefault([{ role: 'user', content: 'hi' }]));

    expect(mockCompletionsCreate.mock.calls[0]?.[0]).not.toHaveProperty('reasoning_effort');
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

describe('resolveModel / getGenerativeModelInfo', () => {
  beforeEach(() => {
    vi.resetModules();
    mockCompletionsCreate.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves the model only once across multiple executeGenerativePrompt calls', async () => {
    vi.doMock('openai', makeOpenAIMock);
    vi.doMock('../../src/lib/config', () => makeConfigMock('test-model'));
    vi.doMock('../../src/lib/logger', makeLoggerMock);

    const mockFetch = makeModelsFetch([{ id: 'test-model', meta: { n_ctx: 32_768 } }]);
    vi.stubGlobal('fetch', mockFetch);
    mockCompletionsCreate.mockResolvedValue(makeStream([{ content: 'ok' }]));

    const { executeGenerativePrompt: exec } = await import('../../src/lib/generative');
    await exec({ system: undefined, user: 'first' }, 0);
    await exec({ system: undefined, user: 'second' }, 0);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('issues a single /models request when concurrent callers race the first resolution', async () => {
    vi.doMock('openai', makeOpenAIMock);
    vi.doMock('../../src/lib/config', () => makeConfigMock('test-model'));
    vi.doMock('../../src/lib/logger', makeLoggerMock);

    // Resolves on a later tick, so all four callers observe the request still in flight.
    const mockFetch = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: [{ id: 'test-model' }] }) }),
              10
            )
          )
      );
    vi.stubGlobal('fetch', mockFetch);

    const { getGenerativeModelInfo: get } = await import('../../src/lib/generative');
    await Promise.all([get(), get(), get(), get()]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('re-queries once the cache TTL has elapsed', async () => {
    vi.doMock('openai', makeOpenAIMock);
    vi.doMock('../../src/lib/config', () => makeConfigMock('test-model', 0.001));
    vi.doMock('../../src/lib/logger', makeLoggerMock);

    const mockFetch = makeModelsFetch([{ id: 'test-model' }]);
    vi.stubGlobal('fetch', mockFetch);

    const { getGenerativeModelInfo: get } = await import('../../src/lib/generative');
    await get();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await get();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to the first available model when config.generative.model is empty', async () => {
    vi.doMock('openai', makeOpenAIMock);
    vi.doMock('../../src/lib/config', () => makeConfigMock(''));
    vi.doMock('../../src/lib/logger', makeLoggerMock);

    vi.stubGlobal('fetch', makeModelsFetch([{ id: 'first-model' }, { id: 'second-model' }]));
    mockCompletionsCreate.mockResolvedValue(makeStream([{ content: 'ok' }]));

    const { executeGenerativePrompt: exec } = await import('../../src/lib/generative');
    await exec({ system: undefined, user: 'hi' }, 0);

    const callArguments = mockCompletionsCreate.mock.calls[0]?.[0] as { model: string };
    expect(callArguments.model).toBe('first-model');
  });

  it('throws when the configured model is not in the available list', async () => {
    vi.doMock('openai', makeOpenAIMock);
    vi.doMock('../../src/lib/config', () => makeConfigMock('missing-model'));
    vi.doMock('../../src/lib/logger', makeLoggerMock);

    vi.stubGlobal('fetch', makeModelsFetch([{ id: 'other-model' }]));

    const { executeGenerativePrompt: exec } = await import('../../src/lib/generative');
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

    const { executeGenerativePrompt: exec } = await import('../../src/lib/generative');
    await expect(exec({ system: undefined, user: 'first' }, 0)).rejects.toThrow('temporary API failure');
    await exec({ system: undefined, user: 'second' }, 0);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('includes contextSize from meta.n_ctx in getGenerativeModelInfo result', async () => {
    vi.doMock('openai', makeOpenAIMock);
    vi.doMock('../../src/lib/config', () => makeConfigMock('test-model'));
    vi.doMock('../../src/lib/logger', makeLoggerMock);

    vi.stubGlobal('fetch', makeModelsFetch([{ id: 'test-model', meta: { n_ctx: 32_768 } }]));

    const { getGenerativeModelInfo } = await import('../../src/lib/generative');
    const info = await getGenerativeModelInfo();

    expect(info.model).toBe('test-model');
    expect(info.contextSize).toBe(32_768);
  });

  it('strips directory path from model id, returning only the filename', async () => {
    vi.doMock('openai', makeOpenAIMock);
    vi.doMock('../../src/lib/config', () => makeConfigMock(''));
    vi.doMock('../../src/lib/logger', makeLoggerMock);

    vi.stubGlobal('fetch', makeModelsFetch([{ id: '/Users/user/models/Qwen3.5-9B.gguf', meta: { n_ctx: 32_768 } }]));

    const { getGenerativeModelInfo } = await import('../../src/lib/generative');
    const info = await getGenerativeModelInfo();

    expect(info.model).toBe('Qwen3.5-9B.gguf');
  });

  it('returns contextSize as undefined when meta is absent', async () => {
    vi.doMock('openai', makeOpenAIMock);
    vi.doMock('../../src/lib/config', () => makeConfigMock('test-model'));
    vi.doMock('../../src/lib/logger', makeLoggerMock);

    vi.stubGlobal('fetch', makeModelsFetch([{ id: 'test-model' }]));

    const { getGenerativeModelInfo } = await import('../../src/lib/generative');
    const info = await getGenerativeModelInfo();

    expect(info.contextSize).toBeUndefined();
  });

  it('falls back to config.generative.contextSize when meta.n_ctx is absent', async () => {
    vi.doMock('openai', makeOpenAIMock);
    vi.doMock('../../src/lib/config', () => makeConfigMock('test-model', 60_000, 4096));
    vi.doMock('../../src/lib/logger', makeLoggerMock);

    vi.stubGlobal('fetch', makeModelsFetch([{ id: 'test-model' }]));

    const { getGenerativeModelInfo } = await import('../../src/lib/generative');
    const info = await getGenerativeModelInfo();

    expect(info.contextSize).toBe(4096);
  });

  it('prefers the live meta.n_ctx over a configured contextSize when both are present', async () => {
    vi.doMock('openai', makeOpenAIMock);
    vi.doMock('../../src/lib/config', () => makeConfigMock('test-model', 60_000, 4096));
    vi.doMock('../../src/lib/logger', makeLoggerMock);

    vi.stubGlobal('fetch', makeModelsFetch([{ id: 'test-model', meta: { n_ctx: 32_768 } }]));

    const { getGenerativeModelInfo } = await import('../../src/lib/generative');
    const info = await getGenerativeModelInfo();

    expect(info.contextSize).toBe(32_768);
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

    const { getGenerativeModelInfo } = await import('../../src/lib/generative');
    const first = await getGenerativeModelInfo();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await getGenerativeModelInfo();

    expect(first.model).toBe('old-model');
    expect(second.model).toBe('new-model');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

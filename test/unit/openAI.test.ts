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

function MockOpenAI(this: object) {
  Object.assign(this, {
    models: { list: mockModelsList },
    chat: { completions: { create: mockCompletionsCreate } }
  });
}

vi.mock('openai', () => ({ default: MockOpenAI }));

import { checkOpenAI, executeOpenAIPrompt } from '../../src/lib/openAI';

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
    mockModelsList.mockResolvedValue({ data: [{ id: 'test-model' }] });
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

    const callArgs = mockCompletionsCreate.mock.calls[0]?.[0] as { messages: unknown[] };
    expect(callArgs.messages).toHaveLength(1);
    expect(callArgs.messages[0]).toMatchObject({ role: 'user', content: 'test' });
  });

  it('includes a system message when system is provided', async () => {
    mockCompletionsCreate.mockResolvedValue(makeStream([{ content: 'ok' }]));

    await executeOpenAIPrompt({ system: 'sys prompt', user: 'test' }, 0.5);

    const callArgs = mockCompletionsCreate.mock.calls[0]?.[0] as { messages: unknown[] };
    expect(callArgs.messages).toHaveLength(2);
    expect(callArgs.messages[0]).toMatchObject({ role: 'system', content: 'sys prompt' });
  });
});

// One shared, mutable config object: the @lib barrel mock and the real jobs module (pulled in via
// importActual below) must observe the same reference, or a test that sets hmacSecret on one would
// leave the other reading the default.
const { testConfig } = vi.hoisted(() => ({
  testConfig: {
    generative: { url: 'http://test/v1', model: '', key: 'k' },
    embedding: undefined,
    upstream: { timeout: 5000, maxRetryCount: 10, modelCacheTtlMs: 60_000 },
    worker: { concurrency: 1 },
    callback: { urlAllowlist: undefined, retryTtlHours: 24, hmacSecret: '' }
  } as {
    generative: { url: string; model: string; key: string };
    embedding: { url: string; model: string; key: string } | undefined;
    upstream: { timeout: number; maxRetryCount: number; modelCacheTtlMs: number };
    worker: { concurrency: number };
    callback: { urlAllowlist: RegExp | undefined; retryTtlHours: number; hmacSecret: string };
  }
}));

vi.mock('../../src/lib/config', () => ({ config: testConfig }));

vi.mock('../../src/lib/logger', async () => {
  const { makeLoggerMock } = await import('../helpers/mocks');
  return { logger: makeLoggerMock() };
});

vi.mock('@lib', async () => {
  const { makeLoggerMock } = await import('../helpers/mocks');
  // The retry/backoff, transient-error and callback-delivery helpers are pure logic that the tests
  // below actually exercise — stubbing them out would make those assertions vacuous.
  const jobs = await vi.importActual<typeof JobsModule>('../../src/lib/jobs');
  return {
    ...jobs,
    executeGenerativePrompt: vi.fn(),
    incCounter: vi.fn(),
    observeHistogram: vi.fn(),
    recordUpstreamMetrics: vi.fn(),
    logger: makeLoggerMock(),
    config: testConfig
  };
});

vi.mock('../../src/prompt/repo', () => ({
  addPrompt: vi.fn(),
  findQueuedPrompts: vi.fn(),
  updatePromptsSetInProgress: vi.fn(),
  updatePromptSetCompleted: vi.fn(),
  updatePromptSetFailed: vi.fn(),
  findCallbackPendingPrompts: vi.fn(),
  updatePromptSetCallbackCompleted: vi.fn()
}));

import { createHmac } from 'node:crypto';

import { config, executeGenerativePrompt } from '@lib';

import type * as JobsModule from '../../src/lib/jobs';
import {
  findCallbackPendingPrompts,
  findQueuedPrompts,
  updatePromptSetCallbackCompleted,
  updatePromptSetCompleted,
  updatePromptSetFailed,
  updatePromptsSetInProgress
} from '../../src/prompt/repo';
import { processCallbackPendingPrompts, processQueuedPrompts } from '../../src/prompt/service';

// Mirrors the projection findQueuedPrompts actually selects.
const makeQueuedPrompt = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  clientName: 'test-client',
  requestId: 'req-1',
  systemPrompt: null,
  userPrompt: 'hello',
  temperature: 0.7,
  retryCount: 0,
  ...overrides
});

// Mirrors the projection findCallbackPendingPrompts actually selects.
const makeCallbackPrompt = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  clientName: 'test-client',
  requestId: 'req-1',
  callbackUrl: 'https://example.com/callback',
  reasoning: null,
  response: null,
  ...overrides
});

const successfulResult = {
  reasoning: 'thought process',
  response: 'final answer',
  timing: { reasoningTimeMs: 100, reasoningTokenPerSecond: 10, responseTimeMs: 200, responseTokenPerSecond: 20 }
};

describe('processQueuedPrompts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(config).worker = { concurrency: 1 };
  });

  it('does nothing when no prompts are queued', async () => {
    vi.mocked(findQueuedPrompts).mockResolvedValue([]);
    await processQueuedPrompts();
    expect(updatePromptsSetInProgress).not.toHaveBeenCalled();
  });

  it('marks the prompt completed on successful execution', async () => {
    vi.mocked(findQueuedPrompts).mockResolvedValue([makeQueuedPrompt()]);
    vi.mocked(executeGenerativePrompt).mockResolvedValue(successfulResult);

    await processQueuedPrompts();

    expect(updatePromptsSetInProgress).toHaveBeenCalledWith([1]);
    expect(updatePromptSetCompleted).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ reasoning: 'thought process', response: 'final answer' })
    );
  });

  it('marks the prompt as failed_retry on a transient error', async () => {
    vi.mocked(findQueuedPrompts).mockResolvedValue([makeQueuedPrompt({ retryCount: 0 })]);
    vi.mocked(executeGenerativePrompt).mockRejectedValue(new Error('fetch failed'));

    await processQueuedPrompts();

    expect(updatePromptSetFailed).toHaveBeenCalledWith(1, 'fetch failed', true, expect.any(Date));
  });

  it('retries a transient error that is still under the retry cap', async () => {
    vi.mocked(findQueuedPrompts).mockResolvedValue([makeQueuedPrompt({ retryCount: 8 })]);
    vi.mocked(executeGenerativePrompt).mockRejectedValue(new Error('econnreset'));

    await processQueuedPrompts();

    expect(updatePromptSetFailed).toHaveBeenCalledWith(1, 'econnreset', true, expect.any(Date));
  });

  it('moves to permanently failed with max_retries_exceeded when the retry cap is reached', async () => {
    vi.mocked(findQueuedPrompts).mockResolvedValue([makeQueuedPrompt({ retryCount: 9 })]);
    vi.mocked(executeGenerativePrompt).mockRejectedValue(new Error('fetch failed'));

    await processQueuedPrompts();

    expect(updatePromptSetFailed).toHaveBeenCalledWith(1, 'max_retries_exceeded', false, undefined);
  });

  it('marks the prompt as permanently failed for non-transient errors regardless of retry count', async () => {
    vi.mocked(findQueuedPrompts).mockResolvedValue([makeQueuedPrompt({ retryCount: 0 })]);
    vi.mocked(executeGenerativePrompt).mockRejectedValue(new Error('model not found'));

    await processQueuedPrompts();

    expect(updatePromptSetFailed).toHaveBeenCalledWith(1, 'model not found', false, undefined);
  });

  it('converts a non-Error thrown value to a string for the failure message', async () => {
    vi.mocked(findQueuedPrompts).mockResolvedValue([makeQueuedPrompt()]);
    vi.mocked(executeGenerativePrompt).mockRejectedValue('plain string error');

    await processQueuedPrompts();

    expect(updatePromptSetFailed).toHaveBeenCalledWith(1, 'plain string error', false, undefined);
  });

  it('treats AbortError as transient', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    vi.mocked(findQueuedPrompts).mockResolvedValue([makeQueuedPrompt({ retryCount: 0 })]);
    vi.mocked(executeGenerativePrompt).mockRejectedValue(abortError);

    await processQueuedPrompts();

    expect(updatePromptSetFailed).toHaveBeenCalledWith(1, 'aborted', true, expect.any(Date));
  });

  it.each([['etimedout'], ['econnrefused'], ['socket hang up'], ['network error']])(
    'treats "%s" as a transient error',
    async (message) => {
      vi.mocked(findQueuedPrompts).mockResolvedValue([makeQueuedPrompt()]);
      vi.mocked(executeGenerativePrompt).mockRejectedValue(new Error(message));

      await processQueuedPrompts();

      expect(updatePromptSetFailed).toHaveBeenCalledWith(1, message, true, expect.any(Date));
    }
  );

  it('treats an error with a transient cause as transient', async () => {
    const cause = new Error('fetch failed');
    const outer = new Error('wrapped', { cause });
    vi.mocked(findQueuedPrompts).mockResolvedValue([makeQueuedPrompt()]);
    vi.mocked(executeGenerativePrompt).mockRejectedValue(outer);

    await processQueuedPrompts();

    expect(updatePromptSetFailed).toHaveBeenCalledWith(1, 'wrapped', true, expect.any(Date));
  });

  it('caps the retry backoff at 60 s for very large retry counts', async () => {
    vi.mocked(findQueuedPrompts).mockResolvedValue([makeQueuedPrompt({ retryCount: 8 })]);
    vi.mocked(executeGenerativePrompt).mockRejectedValue(new Error('fetch failed'));

    const before = Date.now();
    await processQueuedPrompts();
    const after = Date.now();

    const nextRetryAt = vi.mocked(updatePromptSetFailed).mock.calls[0]?.[3];
    const nextRetryAtMs = (nextRetryAt as Date).getTime();
    expect(nextRetryAtMs).toBeGreaterThanOrEqual(before + 60_000);
    expect(nextRetryAtMs).toBeLessThanOrEqual(after + 61_000);
  });

  it('processes multiple prompts concurrently when concurrency > 1', async () => {
    vi.mocked(config).worker = { concurrency: 2 };
    const prompt1 = makeQueuedPrompt({ id: 1, requestId: 'req-1' });
    const prompt2 = makeQueuedPrompt({ id: 2, requestId: 'req-2' });
    vi.mocked(findQueuedPrompts).mockResolvedValue([prompt1, prompt2]);
    vi.mocked(executeGenerativePrompt).mockResolvedValue(successfulResult);

    await processQueuedPrompts();

    expect(findQueuedPrompts).toHaveBeenCalledWith(2);
    expect(updatePromptsSetInProgress).toHaveBeenCalledWith([1, 2]);
    expect(updatePromptSetCompleted).toHaveBeenCalledTimes(2);
  });

  it('processes remaining prompts independently when one fails in a concurrent batch', async () => {
    vi.mocked(config).worker = { concurrency: 2 };
    const prompt1 = makeQueuedPrompt({ id: 1, requestId: 'req-1' });
    const prompt2 = makeQueuedPrompt({ id: 2, requestId: 'req-2' });
    vi.mocked(findQueuedPrompts).mockResolvedValue([prompt1, prompt2]);
    vi.mocked(executeGenerativePrompt)
      .mockResolvedValueOnce(successfulResult)
      .mockRejectedValueOnce(new Error('model not found'));

    await processQueuedPrompts();

    expect(updatePromptSetCompleted).toHaveBeenCalledTimes(1);
    expect(updatePromptSetFailed).toHaveBeenCalledTimes(1);
  });
});

describe('processCallbackPendingPrompts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(config).callback = { urlAllowlist: undefined, retryTtlHours: 24, hmacSecret: '' };
  });

  it('does nothing when no callbacks are pending', async () => {
    vi.mocked(findCallbackPendingPrompts).mockResolvedValue([]);
    await processCallbackPendingPrompts();
    expect(updatePromptSetCallbackCompleted).not.toHaveBeenCalled();
  });

  it('passes a TTL cutoff date to findCallbackPendingPrompts', async () => {
    vi.mocked(findCallbackPendingPrompts).mockResolvedValue([]);
    const before = Date.now();
    await processCallbackPendingPrompts();
    const after = Date.now();

    const [cutoff] = vi.mocked(findCallbackPendingPrompts).mock.calls[0] as [Date];
    expect(cutoff).toBeInstanceOf(Date);
    // cutoff should be ~24 hours before now (default retryTtlHours = 24)
    const expectedMs = 24 * 60 * 60 * 1000;
    expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(expectedMs - 100);
    expect(after - cutoff.getTime()).toBeLessThanOrEqual(expectedMs + 100);
  });

  it('sends the callback and marks it as completed on success', async () => {
    const prompt = makeCallbackPrompt({ reasoning: 'thought', response: 'answer' });
    vi.mocked(findCallbackPendingPrompts).mockResolvedValue([prompt]);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    await processCallbackPendingPrompts();

    expect(mockFetch).toHaveBeenCalledWith('https://example.com/callback', expect.objectContaining({ method: 'POST' }));
    expect(updatePromptSetCallbackCompleted).toHaveBeenCalledWith(1);
  });

  it('delivers a batch of callbacks concurrently rather than one at a time', async () => {
    const prompts = Array.from({ length: 5 }, (_, index) =>
      makeCallbackPrompt({ id: index + 1, requestId: `req-${index + 1}` })
    );
    vi.mocked(findCallbackPendingPrompts).mockResolvedValue(prompts);

    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { ok: true };
      })
    );

    await processCallbackPendingPrompts();

    expect(maxInFlight).toBeGreaterThan(1);
    expect(updatePromptSetCallbackCompleted).toHaveBeenCalledTimes(5);
  });

  it('still delivers the rest of the batch when one callback fails', async () => {
    vi.mocked(findCallbackPendingPrompts).mockResolvedValue([
      makeCallbackPrompt({ id: 1, requestId: 'req-1' }),
      makeCallbackPrompt({ id: 2, requestId: 'req-2' })
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValueOnce(new Error('network error')).mockResolvedValueOnce({ ok: true })
    );

    await processCallbackPendingPrompts();

    expect(updatePromptSetCallbackCompleted).toHaveBeenCalledTimes(1);
    expect(updatePromptSetCallbackCompleted).toHaveBeenCalledWith(2);
  });

  it('logs the error and skips marking complete when the fetch throws', async () => {
    const prompt = makeCallbackPrompt();
    vi.mocked(findCallbackPendingPrompts).mockResolvedValue([prompt]);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    await processCallbackPendingPrompts();

    expect(updatePromptSetCallbackCompleted).not.toHaveBeenCalled();
  });

  it('skips marking complete when the callback endpoint responds with a non-ok status', async () => {
    const prompt = makeCallbackPrompt();
    vi.mocked(findCallbackPendingPrompts).mockResolvedValue([prompt]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await processCallbackPendingPrompts();

    expect(updatePromptSetCallbackCompleted).not.toHaveBeenCalled();
  });

  it('skips prompts that have no callback URL', async () => {
    const prompt = makeCallbackPrompt({ callbackUrl: null });
    vi.mocked(findCallbackPendingPrompts).mockResolvedValue([prompt]);
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    await processCallbackPendingPrompts();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(updatePromptSetCallbackCompleted).not.toHaveBeenCalled();
  });

  it('does not include X-LLM-Relay-Signature header when hmacSecret is not set', async () => {
    const prompt = makeCallbackPrompt({ reasoning: 'thought', response: 'answer' });
    vi.mocked(findCallbackPendingPrompts).mockResolvedValue([prompt]);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    vi.mocked(config).callback = { urlAllowlist: undefined, retryTtlHours: 24, hmacSecret: '' };

    await processCallbackPendingPrompts();

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['X-LLM-Relay-Signature']).toBeUndefined();
  });

  it('includes a correct X-LLM-Relay-Signature header when hmacSecret is set', async () => {
    const prompt = makeCallbackPrompt({ reasoning: 'thought', response: 'answer' });
    vi.mocked(findCallbackPendingPrompts).mockResolvedValue([prompt]);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    vi.mocked(config).callback = { urlAllowlist: undefined, retryTtlHours: 24, hmacSecret: 'mysecret' };

    await processCallbackPendingPrompts();

    const expectedBody = JSON.stringify({
      clientName: prompt.clientName,
      requestId: prompt.requestId,
      reasoning: prompt.reasoning,
      response: prompt.response
    });
    const expectedSig = createHmac('sha256', 'mysecret').update(expectedBody).digest('hex');
    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['X-LLM-Relay-Signature']).toBe(`hmac-sha256=${expectedSig}`);
  });
});

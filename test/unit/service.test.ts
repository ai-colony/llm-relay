vi.mock('@lib', () => ({
  executeOpenAIPrompt: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  config: { openai: { maxRetryCount: 10 }, worker: { concurrency: 1 }, callback: { retryTtlHours: 24 } }
}));

vi.mock('../../src/prompt/repository', () => ({
  addPrompt: vi.fn(),
  findQueuedPrompts: vi.fn(),
  updatePromptsSetInProgress: vi.fn(),
  updatePromptSetCompleted: vi.fn(),
  updatePromptSetFailed: vi.fn(),
  findCallbackPendingPrompts: vi.fn(),
  updatePromptSetCallbackCompleted: vi.fn()
}));

import { config, executeOpenAIPrompt } from '@lib';

import {
  findCallbackPendingPrompts,
  findQueuedPrompts,
  updatePromptSetCallbackCompleted,
  updatePromptSetCompleted,
  updatePromptSetFailed,
  updatePromptsSetInProgress
} from '../../src/prompt/repository';
import { processCallbackPendingPrompts, processQueuedPrompts } from '../../src/prompt/service';

const makeQueuedPrompt = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  clientName: 'test-client',
  requestId: 1,
  callbackUrl: null,
  callbackCompleted: false,
  createdAt: new Date(),
  status: 'queued',
  statusError: null,
  completedAt: null,
  systemPrompt: null,
  userPrompt: 'hello',
  temperature: 0.7,
  retryCount: 0,
  reasoning: null,
  response: null,
  reasoningTimeMs: null,
  reasoningTokenPerSecond: null,
  responseTimeMs: null,
  responseTokenPerSecond: null,
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
    vi.mocked(executeOpenAIPrompt).mockResolvedValue(successfulResult);

    await processQueuedPrompts();

    expect(updatePromptsSetInProgress).toHaveBeenCalledWith([1]);
    expect(updatePromptSetCompleted).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ reasoning: 'thought process', response: 'final answer' })
    );
  });

  it('marks the prompt as failed_retry on a transient error', async () => {
    vi.mocked(findQueuedPrompts).mockResolvedValue([makeQueuedPrompt({ retryCount: 0 })]);
    vi.mocked(executeOpenAIPrompt).mockRejectedValue(new Error('fetch failed'));

    await processQueuedPrompts();

    expect(updatePromptSetFailed).toHaveBeenCalledWith(1, 'fetch failed', true, expect.any(Date));
  });

  it('retries a transient error that is still under the retry cap', async () => {
    vi.mocked(findQueuedPrompts).mockResolvedValue([makeQueuedPrompt({ retryCount: 8 })]);
    vi.mocked(executeOpenAIPrompt).mockRejectedValue(new Error('econnreset'));

    await processQueuedPrompts();

    expect(updatePromptSetFailed).toHaveBeenCalledWith(1, 'econnreset', true, expect.any(Date));
  });

  it('moves to permanently failed with max_retries_exceeded when the retry cap is reached', async () => {
    vi.mocked(findQueuedPrompts).mockResolvedValue([makeQueuedPrompt({ retryCount: 9 })]);
    vi.mocked(executeOpenAIPrompt).mockRejectedValue(new Error('fetch failed'));

    await processQueuedPrompts();

    expect(updatePromptSetFailed).toHaveBeenCalledWith(1, 'max_retries_exceeded', false, undefined);
  });

  it('marks the prompt as permanently failed for non-transient errors regardless of retry count', async () => {
    vi.mocked(findQueuedPrompts).mockResolvedValue([makeQueuedPrompt({ retryCount: 0 })]);
    vi.mocked(executeOpenAIPrompt).mockRejectedValue(new Error('model not found'));

    await processQueuedPrompts();

    expect(updatePromptSetFailed).toHaveBeenCalledWith(1, 'model not found', false, undefined);
  });

  it('converts a non-Error thrown value to a string for the failure message', async () => {
    vi.mocked(findQueuedPrompts).mockResolvedValue([makeQueuedPrompt()]);
    vi.mocked(executeOpenAIPrompt).mockRejectedValue('plain string error');

    await processQueuedPrompts();

    expect(updatePromptSetFailed).toHaveBeenCalledWith(1, 'plain string error', false, undefined);
  });

  it('treats AbortError as transient', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    vi.mocked(findQueuedPrompts).mockResolvedValue([makeQueuedPrompt({ retryCount: 0 })]);
    vi.mocked(executeOpenAIPrompt).mockRejectedValue(abortError);

    await processQueuedPrompts();

    expect(updatePromptSetFailed).toHaveBeenCalledWith(1, 'aborted', true, expect.any(Date));
  });

  it.each([['etimedout'], ['econnrefused'], ['socket hang up'], ['network error']])(
    'treats "%s" as a transient error',
    async (message) => {
      vi.mocked(findQueuedPrompts).mockResolvedValue([makeQueuedPrompt()]);
      vi.mocked(executeOpenAIPrompt).mockRejectedValue(new Error(message));

      await processQueuedPrompts();

      expect(updatePromptSetFailed).toHaveBeenCalledWith(1, message, true, expect.any(Date));
    }
  );

  it('treats an error with a transient cause as transient', async () => {
    const cause = new Error('fetch failed');
    const outer = new Error('wrapped');
    (outer as Error & { cause: unknown }).cause = cause;
    vi.mocked(findQueuedPrompts).mockResolvedValue([makeQueuedPrompt()]);
    vi.mocked(executeOpenAIPrompt).mockRejectedValue(outer);

    await processQueuedPrompts();

    expect(updatePromptSetFailed).toHaveBeenCalledWith(1, 'wrapped', true, expect.any(Date));
  });

  it('caps the retry backoff at 60 s for very large retry counts', async () => {
    vi.mocked(findQueuedPrompts).mockResolvedValue([makeQueuedPrompt({ retryCount: 8 })]);
    vi.mocked(executeOpenAIPrompt).mockRejectedValue(new Error('fetch failed'));

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
    vi.mocked(executeOpenAIPrompt).mockResolvedValue(successfulResult);

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
    vi.mocked(executeOpenAIPrompt)
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
    const prompt = makeQueuedPrompt({
      status: 'completed',
      callbackUrl: 'https://example.com/callback',
      reasoning: 'thought',
      response: 'answer'
    });
    vi.mocked(findCallbackPendingPrompts).mockResolvedValue([prompt]);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    await processCallbackPendingPrompts();

    expect(mockFetch).toHaveBeenCalledWith('https://example.com/callback', expect.objectContaining({ method: 'POST' }));
    expect(updatePromptSetCallbackCompleted).toHaveBeenCalledWith(1);
  });

  it('logs the error and skips marking complete when the fetch throws', async () => {
    const prompt = makeQueuedPrompt({ status: 'completed', callbackUrl: 'https://example.com/callback' });
    vi.mocked(findCallbackPendingPrompts).mockResolvedValue([prompt]);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    await processCallbackPendingPrompts();

    expect(updatePromptSetCallbackCompleted).not.toHaveBeenCalled();
  });

  it('skips prompts that have no callback URL', async () => {
    const prompt = makeQueuedPrompt({ status: 'completed', callbackUrl: null });
    vi.mocked(findCallbackPendingPrompts).mockResolvedValue([prompt]);
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    await processCallbackPendingPrompts();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(updatePromptSetCallbackCompleted).not.toHaveBeenCalled();
  });
});

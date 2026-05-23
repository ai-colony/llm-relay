vi.mock('@lib', () => ({
  executeOpenAIPrompt: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

vi.mock('../../src/prompt/repository', () => ({
  addPrompt: vi.fn(),
  findFirstQueuedPrompt: vi.fn(),
  updatePromptSetInProgress: vi.fn(),
  updatePromptSetCompleted: vi.fn(),
  updatePromptSetFailed: vi.fn(),
  findCallbackPendingPrompts: vi.fn(),
  updatePromptSetCallbackCompleted: vi.fn()
}));

import { executeOpenAIPrompt } from '@lib';

import {
  findCallbackPendingPrompts,
  findFirstQueuedPrompt,
  updatePromptSetCallbackCompleted,
  updatePromptSetCompleted,
  updatePromptSetFailed,
  updatePromptSetInProgress
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
  });

  it('does nothing when no prompts are queued', async () => {
    vi.mocked(findFirstQueuedPrompt).mockResolvedValue([]);
    await processQueuedPrompts();
    expect(updatePromptSetInProgress).not.toHaveBeenCalled();
  });

  it('marks the prompt completed on successful execution', async () => {
    vi.mocked(findFirstQueuedPrompt).mockResolvedValue([makeQueuedPrompt()]);
    vi.mocked(executeOpenAIPrompt).mockResolvedValue(successfulResult);

    await processQueuedPrompts();

    expect(updatePromptSetInProgress).toHaveBeenCalledWith(1);
    expect(updatePromptSetCompleted).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ reasoning: 'thought process', response: 'final answer' })
    );
  });

  it('marks the prompt as failed_retry on a transient error', async () => {
    vi.mocked(findFirstQueuedPrompt).mockResolvedValue([makeQueuedPrompt({ retryCount: 0 })]);
    vi.mocked(executeOpenAIPrompt).mockRejectedValue(new Error('fetch failed'));

    await processQueuedPrompts();

    expect(updatePromptSetFailed).toHaveBeenCalledWith(1, 'fetch failed', true, expect.any(Date));
  });

  it('keeps retrying transient errors indefinitely (no retry limit)', async () => {
    vi.mocked(findFirstQueuedPrompt).mockResolvedValue([makeQueuedPrompt({ retryCount: 10 })]);
    vi.mocked(executeOpenAIPrompt).mockRejectedValue(new Error('econnreset'));

    await processQueuedPrompts();

    expect(updatePromptSetFailed).toHaveBeenCalledWith(1, 'econnreset', true, expect.any(Date));
  });

  it('marks the prompt as permanently failed for non-transient errors regardless of retry count', async () => {
    vi.mocked(findFirstQueuedPrompt).mockResolvedValue([makeQueuedPrompt({ retryCount: 0 })]);
    vi.mocked(executeOpenAIPrompt).mockRejectedValue(new Error('model not found'));

    await processQueuedPrompts();

    expect(updatePromptSetFailed).toHaveBeenCalledWith(1, 'model not found', false, undefined);
  });

  it('converts a non-Error thrown value to a string for the failure message', async () => {
    vi.mocked(findFirstQueuedPrompt).mockResolvedValue([makeQueuedPrompt()]);
    vi.mocked(executeOpenAIPrompt).mockRejectedValue('plain string error');

    await processQueuedPrompts();

    expect(updatePromptSetFailed).toHaveBeenCalledWith(1, 'plain string error', false, undefined);
  });

  it('treats AbortError as transient', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    vi.mocked(findFirstQueuedPrompt).mockResolvedValue([makeQueuedPrompt({ retryCount: 0 })]);
    vi.mocked(executeOpenAIPrompt).mockRejectedValue(abortError);

    await processQueuedPrompts();

    expect(updatePromptSetFailed).toHaveBeenCalledWith(1, 'aborted', true, expect.any(Date));
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

  it('sends the callback and marks it as completed on success', async () => {
    const prompt = makeQueuedPrompt({
      status: 'completed',
      callbackUrl: 'http://example.com/callback',
      reasoning: 'thought',
      response: 'answer'
    });
    vi.mocked(findCallbackPendingPrompts).mockResolvedValue([prompt]);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    await processCallbackPendingPrompts();

    expect(mockFetch).toHaveBeenCalledWith('http://example.com/callback', expect.objectContaining({ method: 'POST' }));
    expect(updatePromptSetCallbackCompleted).toHaveBeenCalledWith(1);
  });

  it('logs the error and skips marking complete when the fetch throws', async () => {
    const prompt = makeQueuedPrompt({ status: 'completed', callbackUrl: 'http://example.com/callback' });
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

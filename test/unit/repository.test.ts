vi.mock('@db', async () => {
  const { testDbClient, testDbSchema } = await import('../helpers/testDb');
  return {
    database: { dbClient: testDbClient, dbSchema: testDbSchema },
    checkDatabase: () => ({ ok: true })
  };
});

import {
  addPrompt,
  countQueuedPrompts,
  deletePromptByClientNameAndRequestId,
  deletePromptForOverwrite,
  findCallbackPendingPrompts,
  findPromptByClientNameAndRequestId,
  findPromptsByClientName,
  findQueuedPrompts,
  getPromptStatusCounts,
  resetInProgressPrompts,
  updatePromptSetCallbackCompleted,
  updatePromptSetCompleted,
  updatePromptSetFailed,
  updatePromptsSetInProgress
} from '../../src/prompt/repository';
import { clearDatabase } from '../helpers/testDb';

const basePrompt = { clientName: 'test-client', requestId: 'req-1', userPrompt: 'hello', temperature: 0.7 };

const completionData = {
  reasoning: 'thought',
  response: 'answer',
  reasoningTimeMs: 100,
  reasoningTokenPerSecond: 10,
  responseTimeMs: 200,
  responseTokenPerSecond: 20
};

beforeEach(() => {
  clearDatabase();
});

describe('addPrompt', () => {
  it('inserts a prompt and returns a positive rowid', async () => {
    const id = await addPrompt(basePrompt);
    expect(Number(id)).toBeGreaterThan(0);
  });

  it('throws a unique constraint error on duplicate clientName + requestId', async () => {
    await addPrompt(basePrompt);
    await expect(addPrompt(basePrompt)).rejects.toThrow();
  });

  it('stores optional fields when provided', async () => {
    const id = await addPrompt({
      ...basePrompt,
      systemPrompt: 'be helpful',
      callbackUrl: 'https://example.com/cb'
    });
    const [prompt] = await findPromptByClientNameAndRequestId('test-client', 'req-1');
    expect(prompt?.systemPrompt).toBe('be helpful');
    expect(prompt?.callbackUrl).toBe('https://example.com/cb');
    expect(Number(id)).toBeGreaterThan(0);
  });

  it('accepts a UUID-style string requestId', async () => {
    const id = await addPrompt({ ...basePrompt, requestId: '550e8400-e29b-41d4-a716-446655440000' });
    expect(Number(id)).toBeGreaterThan(0);
    const [prompt] = await findPromptByClientNameAndRequestId('test-client', '550e8400-e29b-41d4-a716-446655440000');
    expect(prompt?.requestId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });
});

describe('findQueuedPrompts', () => {
  it('returns an empty array when no prompts are queued', async () => {
    const result = await findQueuedPrompts(1);
    expect(result).toHaveLength(0);
  });

  it('returns the oldest queued prompt first (FIFO order)', async () => {
    await addPrompt({ ...basePrompt, requestId: 'req-1' });
    await addPrompt({ ...basePrompt, requestId: 'req-2' });
    const result = await findQueuedPrompts(1);
    expect(result[0]?.requestId).toBe('req-1');
  });

  it('returns the lower-priority-number prompt first regardless of insertion order', async () => {
    await addPrompt({ ...basePrompt, requestId: 'req-1', priority: 5 });
    await addPrompt({ ...basePrompt, requestId: 'req-2', priority: 1 });
    const result = await findQueuedPrompts(1);
    expect(result[0]?.requestId).toBe('req-2');
  });

  it('returns up to limit prompts', async () => {
    await addPrompt({ ...basePrompt, requestId: 'req-1' });
    await addPrompt({ ...basePrompt, requestId: 'req-2' });
    await addPrompt({ ...basePrompt, requestId: 'req-3' });
    const result = await findQueuedPrompts(2);
    expect(result).toHaveLength(2);
  });

  it('returns failed_retry prompts as eligible for processing', async () => {
    const id = await addPrompt(basePrompt);
    await updatePromptSetFailed(Number(id), 'timeout', true);
    const result = await findQueuedPrompts(1);
    expect(result[0]?.status).toBe('failed_retry');
  });

  it('does not return a failed_retry prompt whose nextRetryAt is in the future', async () => {
    const id = await addPrompt(basePrompt);
    const futureDate = new Date(Date.now() + 60_000);
    await updatePromptSetFailed(Number(id), 'timeout', true, futureDate);
    const result = await findQueuedPrompts(1);
    expect(result).toHaveLength(0);
  });
});

describe('prompt lifecycle transitions', () => {
  it('transitions a prompt from queued → in_progress → completed', async () => {
    const id = await addPrompt(basePrompt);

    await updatePromptsSetInProgress([Number(id)]);
    let [prompt] = await findPromptByClientNameAndRequestId('test-client', 'req-1');
    expect(prompt?.status).toBe('in_progress');

    await updatePromptSetCompleted(Number(id), completionData);
    [prompt] = await findPromptByClientNameAndRequestId('test-client', 'req-1');
    expect(prompt?.status).toBe('completed');
    expect(prompt?.response).toBe('answer');
    expect(prompt?.completedAt).not.toBeNull();
  });

  it('marks a prompt as failed_retry and increments the retry count', async () => {
    const id = await addPrompt(basePrompt);
    await updatePromptSetFailed(Number(id), 'network timeout', true);
    const [prompt] = await findPromptByClientNameAndRequestId('test-client', 'req-1');
    expect(prompt?.status).toBe('failed_retry');
    expect(prompt?.retryCount).toBe(1);
    expect(prompt?.statusError).toBe('network timeout');
  });

  it('marks a prompt as permanently failed without incrementing the retry count', async () => {
    const id = await addPrompt(basePrompt);
    await updatePromptSetFailed(Number(id), 'bad request', false);
    const [prompt] = await findPromptByClientNameAndRequestId('test-client', 'req-1');
    expect(prompt?.status).toBe('failed');
    expect(prompt?.retryCount).toBe(0);
    expect(prompt?.statusError).toBe('bad request');
  });
});

describe('getPromptStatusCounts', () => {
  it('returns all zeros when no prompts exist', async () => {
    const counts = await getPromptStatusCounts();
    expect(counts).toEqual({ queued: 0, pending: 0, completed: 0, failed: 0, callbackPending: 0 });
  });

  it('counts prompts correctly across statuses', async () => {
    const id1 = await addPrompt({ ...basePrompt, requestId: 'req-1' });
    const id2 = await addPrompt({ ...basePrompt, requestId: 'req-2' });
    const id3 = await addPrompt({ ...basePrompt, requestId: 'req-3' });

    await updatePromptsSetInProgress([Number(id2)]);
    await updatePromptsSetInProgress([Number(id3)]);
    await updatePromptSetCompleted(Number(id3), completionData);

    const counts = await getPromptStatusCounts();
    expect(counts.queued).toBe(1);
    expect(counts.pending).toBe(1);
    expect(counts.completed).toBe(1);
    expect(Number(id1)).toBeGreaterThan(0);
  });

  it('counts callback pending prompts (completed + callbackUrl + not delivered)', async () => {
    const id = await addPrompt({ ...basePrompt, callbackUrl: 'https://example.com/cb' });
    await updatePromptsSetInProgress([Number(id)]);
    await updatePromptSetCompleted(Number(id), completionData);

    const counts = await getPromptStatusCounts();
    expect(counts.callbackPending).toBe(1);

    await updatePromptSetCallbackCompleted(Number(id));
    const countsAfter = await getPromptStatusCounts();
    expect(countsAfter.callbackPending).toBe(0);
  });
});

describe('resetInProgressPrompts', () => {
  it('resets in_progress prompts back to queued', async () => {
    const id = await addPrompt(basePrompt);
    await updatePromptsSetInProgress([Number(id)]);
    await resetInProgressPrompts();
    const [prompt] = await findPromptByClientNameAndRequestId('test-client', 'req-1');
    expect(prompt?.status).toBe('queued');
  });
});

describe('findPromptsByClientName', () => {
  it('returns all prompts for a client ordered by creation time', async () => {
    await addPrompt({ ...basePrompt, requestId: 'req-1' });
    await addPrompt({ ...basePrompt, requestId: 'req-2' });
    const results = await findPromptsByClientName('test-client');
    expect(results).toHaveLength(2);
  });

  it('filters by status when provided', async () => {
    const id2 = await addPrompt({ ...basePrompt, requestId: 'req-1' });
    await addPrompt({ ...basePrompt, requestId: 'req-2' });
    await updatePromptsSetInProgress([Number(id2)]);
    const results = await findPromptsByClientName('test-client', 'in_progress');
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('in_progress');
  });

  it('returns an empty array for an unknown client', async () => {
    await addPrompt(basePrompt);
    const results = await findPromptsByClientName('unknown-client');
    expect(results).toHaveLength(0);
  });
});

describe('findCallbackPendingPrompts', () => {
  it('returns only completed prompts with a callbackUrl that have not been delivered', async () => {
    const idWithCallback = await addPrompt({
      ...basePrompt,
      requestId: 'req-1',
      callbackUrl: 'https://cb.example.com'
    });
    const idWithoutCallback = await addPrompt({ ...basePrompt, requestId: 'req-2' });

    await updatePromptsSetInProgress([Number(idWithCallback)]);
    await updatePromptSetCompleted(Number(idWithCallback), completionData);
    await updatePromptsSetInProgress([Number(idWithoutCallback)]);
    await updatePromptSetCompleted(Number(idWithoutCallback), completionData);

    const pending = await findCallbackPendingPrompts(new Date(0));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.callbackUrl).toBe('https://cb.example.com');
  });

  it('does not return a prompt whose callback has already been delivered', async () => {
    const id = await addPrompt({ ...basePrompt, callbackUrl: 'https://cb.example.com' });
    await updatePromptsSetInProgress([Number(id)]);
    await updatePromptSetCompleted(Number(id), completionData);
    await updatePromptSetCallbackCompleted(Number(id));
    const pending = await findCallbackPendingPrompts(new Date(0));
    expect(pending).toHaveLength(0);
  });
});

describe('deletePromptByClientNameAndRequestId', () => {
  it('deletes a queued prompt', async () => {
    await addPrompt(basePrompt);
    await deletePromptByClientNameAndRequestId('test-client', 'req-1');
    const [prompt] = await findPromptByClientNameAndRequestId('test-client', 'req-1');
    expect(prompt).toBeUndefined();
  });

  it('does not delete an in_progress or completed prompt', async () => {
    const id = await addPrompt(basePrompt);
    await updatePromptsSetInProgress([Number(id)]);
    await deletePromptByClientNameAndRequestId('test-client', 'req-1');
    const [prompt] = await findPromptByClientNameAndRequestId('test-client', 'req-1');
    expect(prompt?.status).toBe('in_progress');
  });
});

describe('countQueuedPrompts', () => {
  it('returns 0 when no prompts exist', async () => {
    const count = await countQueuedPrompts();
    expect(count).toBe(0);
  });

  it('counts queued prompts', async () => {
    await addPrompt({ ...basePrompt, requestId: 'req-1' });
    await addPrompt({ ...basePrompt, requestId: 'req-2' });
    const count = await countQueuedPrompts();
    expect(count).toBe(2);
  });

  it('also counts failed_retry prompts since the worker processes them too', async () => {
    const id1 = await addPrompt({ ...basePrompt, requestId: 'req-1' });
    const id2 = await addPrompt({ ...basePrompt, requestId: 'req-2' });
    await updatePromptSetFailed(Number(id2), 'timeout', true);
    const count = await countQueuedPrompts();
    expect(count).toBe(2);
    expect(Number(id1)).toBeGreaterThan(0);
  });
});

describe('deletePromptForOverwrite', () => {
  it('deletes a queued prompt', async () => {
    await addPrompt(basePrompt);
    await deletePromptForOverwrite('test-client', 'req-1');
    const [prompt] = await findPromptByClientNameAndRequestId('test-client', 'req-1');
    expect(prompt).toBeUndefined();
  });

  it('deletes a completed prompt (unlike deletePromptByClientNameAndRequestId)', async () => {
    const id = await addPrompt(basePrompt);
    await updatePromptsSetInProgress([Number(id)]);
    await updatePromptSetCompleted(Number(id), completionData);
    await deletePromptForOverwrite('test-client', 'req-1');
    const [prompt] = await findPromptByClientNameAndRequestId('test-client', 'req-1');
    expect(prompt).toBeUndefined();
  });

  it('does not delete an in_progress prompt', async () => {
    const id = await addPrompt(basePrompt);
    await updatePromptsSetInProgress([Number(id)]);
    await deletePromptForOverwrite('test-client', 'req-1');
    const [prompt] = await findPromptByClientNameAndRequestId('test-client', 'req-1');
    expect(prompt?.status).toBe('in_progress');
  });
});

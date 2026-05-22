vi.mock('@db', async () => {
  const { testDbClient, testDbSchema } = await import('../helpers/testDb');
  return {
    database: { dbClient: testDbClient, dbSchema: testDbSchema },
    checkDatabase: () => ({ ok: true })
  };
});

import {
  addPrompt,
  deletePromptByClientNameAndRequestId,
  findCallbackPendingPrompts,
  findFirstQueuedPrompt,
  findPromptByClientNameAndRequestId,
  findPromptsByClientName,
  getPromptStatusCounts,
  resetInProgressPrompts,
  updatePromptSetCallbackCompleted,
  updatePromptSetCompleted,
  updatePromptSetFailed,
  updatePromptSetInProgress
} from '../../src/prompt/repository';
import { clearDatabase } from '../helpers/testDb';

const basePrompt = { clientName: 'test-client', requestId: 1, userPrompt: 'hello', temperature: 0.7 };

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
      callbackUrl: 'http://example.com/cb'
    });
    const [prompt] = await findPromptByClientNameAndRequestId('test-client', 1);
    expect(prompt?.systemPrompt).toBe('be helpful');
    expect(prompt?.callbackUrl).toBe('http://example.com/cb');
    expect(Number(id)).toBeGreaterThan(0);
  });
});

describe('findFirstQueuedPrompt', () => {
  it('returns an empty array when no prompts are queued', async () => {
    const result = await findFirstQueuedPrompt();
    expect(result).toHaveLength(0);
  });

  it('returns the oldest queued prompt (FIFO order)', async () => {
    await addPrompt({ ...basePrompt, requestId: 1 });
    await addPrompt({ ...basePrompt, requestId: 2 });
    const result = await findFirstQueuedPrompt();
    expect(result).toHaveLength(1);
    expect(result[0]?.requestId).toBe(1);
  });

  it('returns failed_retry prompts as eligible for processing', async () => {
    const id = await addPrompt(basePrompt);
    await updatePromptSetFailed(Number(id), 'timeout', true);
    const result = await findFirstQueuedPrompt();
    expect(result[0]?.status).toBe('failed_retry');
  });
});

describe('prompt lifecycle transitions', () => {
  it('transitions a prompt from queued → in_progress → completed', async () => {
    const id = await addPrompt(basePrompt);

    await updatePromptSetInProgress(Number(id));
    let [prompt] = await findPromptByClientNameAndRequestId('test-client', 1);
    expect(prompt?.status).toBe('in_progress');

    await updatePromptSetCompleted(Number(id), completionData);
    [prompt] = await findPromptByClientNameAndRequestId('test-client', 1);
    expect(prompt?.status).toBe('completed');
    expect(prompt?.response).toBe('answer');
    expect(prompt?.completedAt).not.toBeNull();
  });

  it('marks a prompt as failed_retry and increments the retry count', async () => {
    const id = await addPrompt(basePrompt);
    await updatePromptSetFailed(Number(id), 'network timeout', true);
    const [prompt] = await findPromptByClientNameAndRequestId('test-client', 1);
    expect(prompt?.status).toBe('failed_retry');
    expect(prompt?.retryCount).toBe(1);
    expect(prompt?.statusError).toBe('network timeout');
  });

  it('marks a prompt as permanently failed without incrementing the retry count', async () => {
    const id = await addPrompt(basePrompt);
    await updatePromptSetFailed(Number(id), 'bad request', false);
    const [prompt] = await findPromptByClientNameAndRequestId('test-client', 1);
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
    const id1 = await addPrompt({ ...basePrompt, requestId: 1 });
    const id2 = await addPrompt({ ...basePrompt, requestId: 2 });
    const id3 = await addPrompt({ ...basePrompt, requestId: 3 });

    await updatePromptSetInProgress(Number(id2));
    await updatePromptSetInProgress(Number(id3));
    await updatePromptSetCompleted(Number(id3), completionData);

    const counts = await getPromptStatusCounts();
    expect(counts.queued).toBe(1);
    expect(counts.pending).toBe(1);
    expect(counts.completed).toBe(1);
    expect(Number(id1)).toBeGreaterThan(0);
  });

  it('counts callback pending prompts (completed + callbackUrl + not delivered)', async () => {
    const id = await addPrompt({ ...basePrompt, callbackUrl: 'http://example.com/cb' });
    await updatePromptSetInProgress(Number(id));
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
    await updatePromptSetInProgress(Number(id));
    await resetInProgressPrompts();
    const [prompt] = await findPromptByClientNameAndRequestId('test-client', 1);
    expect(prompt?.status).toBe('queued');
  });
});

describe('findPromptsByClientName', () => {
  it('returns all prompts for a client ordered by creation time', async () => {
    await addPrompt({ ...basePrompt, requestId: 1 });
    await addPrompt({ ...basePrompt, requestId: 2 });
    const results = await findPromptsByClientName('test-client');
    expect(results).toHaveLength(2);
  });

  it('filters by status when provided', async () => {
    const id2 = await addPrompt({ ...basePrompt, requestId: 1 });
    await addPrompt({ ...basePrompt, requestId: 2 });
    await updatePromptSetInProgress(Number(id2));
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
    const idWithCallback = await addPrompt({ ...basePrompt, requestId: 1, callbackUrl: 'http://cb.example.com' });
    const idWithoutCallback = await addPrompt({ ...basePrompt, requestId: 2 });

    await updatePromptSetInProgress(Number(idWithCallback));
    await updatePromptSetCompleted(Number(idWithCallback), completionData);
    await updatePromptSetInProgress(Number(idWithoutCallback));
    await updatePromptSetCompleted(Number(idWithoutCallback), completionData);

    const pending = await findCallbackPendingPrompts();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.callbackUrl).toBe('http://cb.example.com');
  });
});

describe('deletePromptByClientNameAndRequestId', () => {
  it('deletes a queued prompt', async () => {
    await addPrompt(basePrompt);
    await deletePromptByClientNameAndRequestId('test-client', 1);
    const [prompt] = await findPromptByClientNameAndRequestId('test-client', 1);
    expect(prompt).toBeUndefined();
  });

  it('does not delete an in_progress or completed prompt', async () => {
    const id = await addPrompt(basePrompt);
    await updatePromptSetInProgress(Number(id));
    await deletePromptByClientNameAndRequestId('test-client', 1);
    const [prompt] = await findPromptByClientNameAndRequestId('test-client', 1);
    expect(prompt?.status).toBe('in_progress');
  });
});

vi.mock('@db', async () => {
  const { testDatabaseClient, testDbSchema } = await import('../helpers/testDatabase');
  return {
    database: { client: testDatabaseClient, schema: testDbSchema },
    checkDatabase: () => ({ ok: true })
  };
});

import { packVectors } from '@lib/vectors';

import {
  addEmbedding,
  CANCELLABLE_STATUSES,
  countQueuedEmbeddings,
  deleteEmbeddingByKey,
  findCallbackPendingEmbeddings,
  findEmbeddingByKey,
  findEmbeddingsByClientName,
  findEmbeddingStatusByKey,
  findQueuedEmbeddings,
  getEmbeddingStatusCounts,
  purgeCompletedEmbeddings,
  resetInProgressEmbeddings,
  updateEmbeddingSetCallbackCompleted,
  updateEmbeddingSetCompleted,
  updateEmbeddingSetFailed,
  updateEmbeddingsSetInProgress
} from '../../src/embedding/repo';
import { clearDatabase } from '../helpers/testDatabase';

const insert = (overrides: Partial<Parameters<typeof addEmbedding>[0]> = {}) =>
  addEmbedding({
    clientName: 'client-a',
    requestId: 'req-1',
    input: ['hello'],
    encodingFormat: 'float',
    ...overrides
  });

// Insert a row and drive it all the way to completed, returning its id.
const insertCompleted = async (requestId: string, extra: { callbackUrl?: string; clientName?: string } = {}) => {
  await insert({ requestId, ...extra });
  const rows = await findQueuedEmbeddings(10);
  const row = rows.find((entry) => entry.requestId === requestId);
  await updateEmbeddingSetCompleted(row?.id as number, {
    model: 'm',
    dimensions: 3,
    vectors: packVectors([[1, 2, 3]]),
    durationMs: 1
  });
  return row?.id as number;
};

describe('embedding repo', () => {
  beforeEach(() => {
    clearDatabase();
  });

  it('stores the input as JSON alongside its length', async () => {
    await insert({ input: ['one', 'two', 'three'] });

    const row = await findEmbeddingByKey('client-a', 'req-1');
    expect(row?.input).toBe(JSON.stringify(['one', 'two', 'three']));
    expect(row?.inputCount).toBe(3);
    expect(row?.status).toBe('queued');
    expect(row?.retryCount).toBe(0);
    expect(row?.callbackCompleted).toBe(false);
  });

  it('rejects a duplicate (clientName, requestId) pair', async () => {
    await insert();
    await expect(insert()).rejects.toThrow();
  });

  it('allows the same requestId under a different clientName', async () => {
    await insert();
    await expect(insert({ clientName: 'client-b' })).resolves.toBeDefined();
  });

  it('keeps its unique index independent of the prompts table', async () => {
    // The two queues have separate namespaces; an embedding must not collide with a prompt key.
    await insert({ clientName: 'shared', requestId: 'same-id' });
    const row = await findEmbeddingByKey('shared', 'same-id');
    expect(row).toBeDefined();
  });

  describe('findQueuedEmbeddings', () => {
    it('returns queued rows ordered by priority then creation time', async () => {
      await insert({ requestId: 'low', priority: 5 });
      await insert({ requestId: 'high', priority: 0 });

      const rows = await findQueuedEmbeddings(10);
      expect(rows.map((row) => row.requestId)).toEqual(['high', 'low']);
    });

    it('respects the limit', async () => {
      await insert({ requestId: 'a' });
      await insert({ requestId: 'b' });
      expect(await findQueuedEmbeddings(1)).toHaveLength(1);
    });

    it('never projects the vectors blob', async () => {
      await insert();
      const [row] = await findQueuedEmbeddings(1);
      expect(row).not.toHaveProperty('vectors');
    });

    it('excludes in_progress rows', async () => {
      await insert();
      const [row] = await findQueuedEmbeddings(1);
      await updateEmbeddingsSetInProgress([row?.id as number]);
      expect(await findQueuedEmbeddings(10)).toHaveLength(0);
    });

    it('holds back a failed_retry row until its nextRetryAt has passed', async () => {
      await insert();
      const [row] = await findQueuedEmbeddings(1);
      await updateEmbeddingSetFailed(row?.id as number, 'fetch failed', true, new Date(Date.now() + 60_000));
      expect(await findQueuedEmbeddings(10)).toHaveLength(0);

      await updateEmbeddingSetFailed(row?.id as number, 'fetch failed', true, new Date(Date.now() - 1000));
      expect(await findQueuedEmbeddings(10)).toHaveLength(1);
    });

    it('increments retryCount only on a retryable failure', async () => {
      await insert();
      const [row] = await findQueuedEmbeddings(1);
      await updateEmbeddingSetFailed(row?.id as number, 'fetch failed', true, new Date(Date.now() - 1000));
      const retried = await findEmbeddingByKey('client-a', 'req-1');
      expect(retried?.retryCount).toBe(1);

      await updateEmbeddingSetFailed(row?.id as number, 'model not found', false);
      const failed = await findEmbeddingByKey('client-a', 'req-1');
      expect(failed?.status).toBe('failed');
      expect(failed?.retryCount).toBe(1);
    });
  });

  it('round-trips the vectors blob through updateEmbeddingSetCompleted', async () => {
    await insert();
    const [row] = await findQueuedEmbeddings(1);
    const vectors = packVectors([[0.5, 0.25, -1]]);

    await updateEmbeddingSetCompleted(row?.id as number, {
      model: 'embed-model',
      dimensions: 3,
      vectors,
      durationMs: 42
    });

    const stored = await findEmbeddingByKey('client-a', 'req-1');
    expect(stored?.status).toBe('completed');
    expect(stored?.dimensions).toBe(3);
    expect(stored?.durationMs).toBe(42);
    expect(Buffer.from(stored?.vectors as Buffer).equals(vectors)).toBe(true);
  });

  describe('findCallbackPendingEmbeddings', () => {
    it('returns completed rows that still have an undelivered callback', async () => {
      await insertCompleted('with-cb', { callbackUrl: 'https://example.com/cb' });
      const pending = await findCallbackPendingEmbeddings(new Date(Date.now() - 60_000));
      expect(pending).toHaveLength(1);
      expect(pending[0]?.vectors).toBeInstanceOf(Buffer);
    });

    it('ignores rows without a callback URL', async () => {
      await insertCompleted('no-cb');
      expect(await findCallbackPendingEmbeddings(new Date(Date.now() - 60_000))).toHaveLength(0);
    });

    it('ignores rows already delivered', async () => {
      const id = await insertCompleted('with-cb', { callbackUrl: 'https://example.com/cb' });
      await updateEmbeddingSetCallbackCompleted(id);
      expect(await findCallbackPendingEmbeddings(new Date(Date.now() - 60_000))).toHaveLength(0);
    });

    it('ignores rows completed before the TTL cutoff', async () => {
      await insertCompleted('with-cb', { callbackUrl: 'https://example.com/cb' });
      expect(await findCallbackPendingEmbeddings(new Date(Date.now() + 60_000))).toHaveLength(0);
    });
  });

  it('resets in_progress rows back to queued', async () => {
    await insert();
    const [row] = await findQueuedEmbeddings(1);
    await updateEmbeddingsSetInProgress([row?.id as number]);

    await resetInProgressEmbeddings();

    const reset = await findEmbeddingByKey('client-a', 'req-1');
    expect(reset?.status).toBe('queued');
  });

  it('deletes only from the statuses it is given', async () => {
    await insert();
    const [row] = await findQueuedEmbeddings(1);
    await updateEmbeddingsSetInProgress([row?.id as number]);

    await deleteEmbeddingByKey('client-a', 'req-1', CANCELLABLE_STATUSES);
    expect(await findEmbeddingStatusByKey('client-a', 'req-1')).toBeDefined();

    await resetInProgressEmbeddings();
    await deleteEmbeddingByKey('client-a', 'req-1', CANCELLABLE_STATUSES);
    expect(await findEmbeddingStatusByKey('client-a', 'req-1')).toBeUndefined();
  });

  it('lists a client’s jobs without their vectors', async () => {
    await insert({ requestId: 'a' });
    await insert({ requestId: 'b' });
    await insert({ clientName: 'other', requestId: 'c' });

    const rows = await findEmbeddingsByClientName('client-a');
    expect(rows.map((row) => row.requestId).toSorted((a, b) => a.localeCompare(b))).toEqual(['a', 'b']);
    expect(rows[0]).not.toHaveProperty('vectors');
    expect(rows[0]?.inputCount).toBe(1);
  });

  it('filters the list by status', async () => {
    await insert({ requestId: 'a' });
    await insert({ requestId: 'b' });
    const [row] = await findQueuedEmbeddings(1);
    await updateEmbeddingsSetInProgress([row?.id as number]);

    expect(await findEmbeddingsByClientName('client-a', 'in_progress')).toHaveLength(1);
    expect(await findEmbeddingsByClientName('client-a', 'queued')).toHaveLength(1);
  });

  it('counts queued and failed_retry rows together', async () => {
    await insert({ requestId: 'a' });
    await insert({ requestId: 'b' });
    const rows = await findQueuedEmbeddings(10);
    await updateEmbeddingSetFailed(rows[0]?.id as number, 'fetch failed', true, new Date(Date.now() + 60_000));

    expect(await countQueuedEmbeddings()).toBe(2);
  });

  it('aggregates every status in one query', async () => {
    await insert({ requestId: 'a', callbackUrl: 'https://example.com/cb' });
    await insert({ requestId: 'b' });
    const rows = await findQueuedEmbeddings(10);
    const withCallback = rows.find((row) => row.requestId === 'a');
    await updateEmbeddingSetCompleted(withCallback?.id as number, {
      model: 'm',
      dimensions: 3,
      vectors: packVectors([[1, 2, 3]]),
      durationMs: 1
    });

    const counts = await getEmbeddingStatusCounts();
    expect(counts.completed).toBe(1);
    expect(counts.queued).toBe(1);
    expect(counts.callbackPending).toBe(1);
  });

  it('returns zeroes from getEmbeddingStatusCounts on an empty table', async () => {
    expect(await getEmbeddingStatusCounts()).toEqual({
      queued: 0,
      inProgress: 0,
      completed: 0,
      failed: 0,
      callbackPending: 0
    });
  });

  describe('purgeCompletedEmbeddings', () => {
    it('leaves rows newer than the cutoff alone', async () => {
      await insertCompleted('a');
      expect(await purgeCompletedEmbeddings({ olderThanDays: 7 })).toBe(0);
    });

    // completedAt is stored at whole-second precision, so a sub-second window would race the clock:
    // when `now` lands just after a second boundary the cutoff floors to the previous second and the
    // row survives. A negative window puts the cutoff a day ahead instead, which is unambiguous —
    // matching how purgeCompletedPrompts is tested in repo.test.ts.
    it('deletes completed rows past the cutoff', async () => {
      await insertCompleted('a');
      expect(await purgeCompletedEmbeddings({ olderThanDays: -1 })).toBe(1);
    });

    it('scopes the purge to one client when asked', async () => {
      await insertCompleted('a', { clientName: 'client-a' });
      await insertCompleted('b', { clientName: 'client-b' });

      expect(await purgeCompletedEmbeddings({ clientName: 'client-a', olderThanDays: -1 })).toBe(1);
      expect(await findEmbeddingStatusByKey('client-b', 'b')).toBeDefined();
    });

    it('never deletes a queued row', async () => {
      await insert({ requestId: 'queued-one' });
      expect(await purgeCompletedEmbeddings({ olderThanDays: -1 })).toBe(0);
    });
  });
});

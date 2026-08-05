import { database } from '@db';
import { type EmbeddingStatus, type EncodingFormat } from '@db/schema';
import { and, count, eq, gt, inArray, isNull, lte, not, or, sql } from 'drizzle-orm';

const {
  client: databaseClient,
  schema: { embeddings }
} = database;

// Callbacks delivered per worker tick, FIFO.
const CALLBACK_BATCH_SIZE = 50;

export const addEmbedding = async (embedding: {
  clientName: string;
  requestId: string;
  callbackUrl?: string;
  input: string[];
  encodingFormat: EncodingFormat;
  priority?: number;
}) => {
  const { clientName, requestId, callbackUrl, input, encodingFormat, priority = 0 } = embedding;
  const result = await databaseClient.insert(embeddings).values({
    clientName,
    requestId,
    createdAt: new Date(),

    callbackUrl,
    callbackCompleted: false,

    status: 'queued',
    retryCount: 0,

    input: JSON.stringify(input),
    inputCount: input.length,
    encodingFormat,
    priority
  });
  return result.lastInsertRowid;
};

// Projected to exactly what the worker needs — the vectors blob is always empty at this point, and
// at 2560 dimensions it is the largest column in the table.
export const findQueuedEmbeddings = (limit: number) =>
  databaseClient
    .select({
      id: embeddings.id,
      clientName: embeddings.clientName,
      requestId: embeddings.requestId,
      input: embeddings.input,
      retryCount: embeddings.retryCount
    })
    .from(embeddings)
    .where(
      and(
        inArray(embeddings.status, ['queued', 'failed_retry']),
        or(isNull(embeddings.nextRetryAt), lte(embeddings.nextRetryAt, new Date()))
      )
    )
    .orderBy(embeddings.priority, embeddings.createdAt)
    .limit(limit);

export const updateEmbeddingsSetInProgress = (ids: number[]) =>
  databaseClient.update(embeddings).set({ status: 'in_progress' }).where(inArray(embeddings.id, ids));

export const updateEmbeddingSetCompleted = (
  id: number,
  data: { model: string; dimensions: number; vectors: Buffer; durationMs: number }
) =>
  databaseClient
    .update(embeddings)
    .set({
      status: 'completed',
      completedAt: new Date(),
      ...data
    })
    .where(eq(embeddings.id, id));

export const updateEmbeddingSetFailed = (id: number, error: string, isRetryable: boolean, nextRetryAt?: Date) =>
  databaseClient
    .update(embeddings)
    .set({
      status: isRetryable ? 'failed_retry' : 'failed',
      statusError: error,
      completedAt: new Date(),
      ...(isRetryable && { retryCount: sql`${embeddings.retryCount} + 1`, nextRetryAt })
    })
    .where(eq(embeddings.id, id));

export const findCallbackPendingEmbeddings = (cutoff: Date) =>
  databaseClient
    .select({
      id: embeddings.id,
      clientName: embeddings.clientName,
      requestId: embeddings.requestId,
      callbackUrl: embeddings.callbackUrl,
      encodingFormat: embeddings.encodingFormat,
      model: embeddings.model,
      dimensions: embeddings.dimensions,
      vectors: embeddings.vectors
    })
    .from(embeddings)
    .where(
      and(
        eq(embeddings.status, 'completed'),
        not(isNull(embeddings.callbackUrl)),
        eq(embeddings.callbackCompleted, false),
        gt(embeddings.completedAt, cutoff)
      )
    )
    .limit(CALLBACK_BATCH_SIZE);

export const updateEmbeddingSetCallbackCompleted = (id: number) =>
  databaseClient.update(embeddings).set({ callbackCompleted: true }).where(eq(embeddings.id, id));

const byKey = (clientName: string, requestId: string) =>
  and(eq(embeddings.clientName, clientName), eq(embeddings.requestId, requestId));

// Full row — only GET /embedding/get needs the vectors blob.
export const findEmbeddingByKey = async (clientName: string, requestId: string) => {
  const [row] = await databaseClient.select().from(embeddings).where(byKey(clientName, requestId)).limit(1);
  return row;
};

// Projection for callers that only branch on the status (POST /embedding/add, DELETE /embedding/cancel).
export const findEmbeddingStatusByKey = async (clientName: string, requestId: string) => {
  const [row] = await databaseClient
    .select({ status: embeddings.status })
    .from(embeddings)
    .where(byKey(clientName, requestId))
    .limit(1);
  return row;
};

export const findEmbeddingsByClientName = (clientName: string, status?: EmbeddingStatus, limit = 500) =>
  databaseClient
    .select({
      priority: embeddings.priority,
      requestId: embeddings.requestId,
      status: embeddings.status,
      inputCount: embeddings.inputCount,
      dimensions: embeddings.dimensions,
      createdAt: embeddings.createdAt,
      completedAt: embeddings.completedAt
    })
    .from(embeddings)
    .where(and(eq(embeddings.clientName, clientName), status ? eq(embeddings.status, status) : undefined))
    .orderBy(embeddings.createdAt)
    .limit(limit);

// Statuses an embedding may be deleted from. Cancelling refuses to touch a completed job; overwriting
// replaces it. Neither may delete one that is currently in_progress.
export const CANCELLABLE_STATUSES: EmbeddingStatus[] = ['queued', 'failed', 'failed_retry'];
export const OVERWRITABLE_STATUSES: EmbeddingStatus[] = ['queued', 'completed', 'failed', 'failed_retry'];

export const deleteEmbeddingByKey = (clientName: string, requestId: string, statuses: EmbeddingStatus[]) =>
  databaseClient.delete(embeddings).where(and(byKey(clientName, requestId), inArray(embeddings.status, statuses)));

export const resetInProgressEmbeddings = () =>
  databaseClient.update(embeddings).set({ status: 'queued' }).where(eq(embeddings.status, 'in_progress'));

export const purgeCompletedEmbeddings = async ({
  clientName,
  olderThanDays
}: {
  clientName?: string;
  olderThanDays: number;
}): Promise<number> => {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result = await databaseClient
    .delete(embeddings)
    .where(
      and(
        inArray(embeddings.status, ['completed', 'failed']),
        lte(embeddings.completedAt, cutoff),
        clientName ? eq(embeddings.clientName, clientName) : undefined
      )
    );
  return Number(result.changes);
};

export const countQueuedEmbeddings = async () => {
  const [row] = await databaseClient
    .select({ count: count() })
    .from(embeddings)
    .where(inArray(embeddings.status, ['queued', 'failed_retry']));
  return row?.count ?? 0;
};

export const getEmbeddingStatusCounts = async () => {
  const [row] = await databaseClient
    .select({
      queued: sql<number>`sum(case when ${embeddings.status} in ('queued','failed_retry') then 1 else 0 end)`,
      inProgress: sql<number>`sum(case when ${embeddings.status} = 'in_progress' then 1 else 0 end)`,
      completed: sql<number>`sum(case when ${embeddings.status} = 'completed' then 1 else 0 end)`,
      failed: sql<number>`sum(case when ${embeddings.status} = 'failed' then 1 else 0 end)`,
      callbackPending: sql<number>`sum(case when ${embeddings.status} = 'completed' and ${embeddings.callbackUrl} is not null and ${embeddings.callbackCompleted} = 0 then 1 else 0 end)`
    })
    .from(embeddings);

  return {
    queued: row?.queued ?? 0,
    inProgress: row?.inProgress ?? 0,
    completed: row?.completed ?? 0,
    failed: row?.failed ?? 0,
    callbackPending: row?.callbackPending ?? 0
  };
};

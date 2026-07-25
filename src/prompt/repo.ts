import { database } from '@db';
import { type PromptStatus } from '@db/schema';
import { and, count, eq, gt, inArray, isNull, lte, not, or, sql } from 'drizzle-orm';

const {
  client: databaseClient,
  schema: { prompts }
} = database;

// Callbacks delivered per worker tick, FIFO.
const CALLBACK_BATCH_SIZE = 50;

// Add new prompt to the database
export const addPrompt = async (prompt: {
  clientName: string;
  requestId: string;
  callbackUrl?: string;
  systemPrompt?: string;
  userPrompt: string;
  temperature: number;
  priority?: number;
}) => {
  const { clientName, requestId, callbackUrl, systemPrompt, userPrompt, temperature, priority = 0 } = prompt;
  const result = await databaseClient.insert(prompts).values({
    clientName,
    requestId,
    createdAt: new Date(),

    callbackUrl,
    callbackCompleted: false,

    status: 'queued',
    retryCount: 0,

    systemPrompt,
    userPrompt,
    temperature,
    priority
  });
  return result.lastInsertRowid;
};

// Find prompts that are queued or failed but retryable, ordered by priority then creation time.
// Projected to exactly what the worker needs — the response/reasoning blobs are always empty here.
export const findQueuedPrompts = (limit: number) =>
  databaseClient
    .select({
      id: prompts.id,
      clientName: prompts.clientName,
      requestId: prompts.requestId,
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      temperature: prompts.temperature,
      retryCount: prompts.retryCount
    })
    .from(prompts)
    .where(
      and(
        inArray(prompts.status, ['queued', 'failed_retry']),
        or(isNull(prompts.nextRetryAt), lte(prompts.nextRetryAt, new Date()))
      )
    )
    .orderBy(prompts.priority, prompts.createdAt)
    .limit(limit);

// Update prompts
export const updatePromptsSetInProgress = (ids: number[]) =>
  databaseClient.update(prompts).set({ status: 'in_progress' }).where(inArray(prompts.id, ids));

export const updatePromptSetCompleted = (
  id: number,
  data: {
    reasoning: string;
    response: string;
    reasoningTimeMs: number;
    reasoningTokenPerSecond: number;
    responseTimeMs: number;
    responseTokenPerSecond: number;
  }
) =>
  databaseClient
    .update(prompts)
    .set({
      status: 'completed',
      completedAt: new Date(),
      ...data
    })
    .where(eq(prompts.id, id));

export const updatePromptSetFailed = (id: number, error: string, isRetryable: boolean, nextRetryAt?: Date) =>
  databaseClient
    .update(prompts)
    .set({
      status: isRetryable ? 'failed_retry' : 'failed',
      statusError: error,
      completedAt: new Date(),
      ...(isRetryable && { retryCount: sql`${prompts.retryCount} + 1`, nextRetryAt })
    })
    .where(eq(prompts.id, id));

// Handle callback prompts
export const findCallbackPendingPrompts = (cutoff: Date) =>
  databaseClient
    .select({
      id: prompts.id,
      clientName: prompts.clientName,
      requestId: prompts.requestId,
      callbackUrl: prompts.callbackUrl,
      reasoning: prompts.reasoning,
      response: prompts.response
    })
    .from(prompts)
    .where(
      and(
        eq(prompts.status, 'completed'),
        not(isNull(prompts.callbackUrl)),
        eq(prompts.callbackCompleted, false),
        gt(prompts.completedAt, cutoff)
      )
    )
    .limit(CALLBACK_BATCH_SIZE);

export const updatePromptSetCallbackCompleted = (id: number) =>
  databaseClient.update(prompts).set({ callbackCompleted: true }).where(eq(prompts.id, id));

const byKey = (clientName: string, requestId: string) =>
  and(eq(prompts.clientName, clientName), eq(prompts.requestId, requestId));

// Full row — only GET /prompt/get needs every column.
export const findPromptByClientNameAndRequestId = async (clientName: string, requestId: string) => {
  const [row] = await databaseClient.select().from(prompts).where(byKey(clientName, requestId)).limit(1);
  return row;
};

// Projection for callers that only branch on the status (POST /prompt/add, DELETE /prompt/cancel).
export const findPromptStatusByKey = async (clientName: string, requestId: string) => {
  const [row] = await databaseClient
    .select({ status: prompts.status })
    .from(prompts)
    .where(byKey(clientName, requestId))
    .limit(1);
  return row;
};

export const findPromptsByClientName = (clientName: string, status?: PromptStatus, limit = 500) =>
  databaseClient
    .select({
      priority: prompts.priority,
      requestId: prompts.requestId,
      status: prompts.status,
      createdAt: prompts.createdAt,
      completedAt: prompts.completedAt
    })
    .from(prompts)
    .where(and(eq(prompts.clientName, clientName), status ? eq(prompts.status, status) : undefined))
    .orderBy(prompts.createdAt)
    .limit(limit);

// Statuses a prompt may be deleted from. Cancelling refuses to touch a completed prompt; overwriting
// replaces it. Neither may delete one that is currently in_progress.
export const CANCELLABLE_STATUSES: PromptStatus[] = ['queued', 'failed', 'failed_retry'];
export const OVERWRITABLE_STATUSES: PromptStatus[] = ['queued', 'completed', 'failed', 'failed_retry'];

export const deletePromptByKey = (clientName: string, requestId: string, statuses: PromptStatus[]) =>
  databaseClient.delete(prompts).where(and(byKey(clientName, requestId), inArray(prompts.status, statuses)));

export const resetInProgressPrompts = () =>
  databaseClient.update(prompts).set({ status: 'queued' }).where(eq(prompts.status, 'in_progress'));

export const purgeCompletedPrompts = async ({
  clientName,
  olderThanDays
}: {
  clientName?: string;
  olderThanDays: number;
}): Promise<number> => {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result = await databaseClient
    .delete(prompts)
    .where(
      and(
        inArray(prompts.status, ['completed', 'failed']),
        lte(prompts.completedAt, cutoff),
        clientName ? eq(prompts.clientName, clientName) : undefined
      )
    );
  return Number(result.changes);
};

export const countQueuedPrompts = async () => {
  const [row] = await databaseClient
    .select({ count: count() })
    .from(prompts)
    .where(inArray(prompts.status, ['queued', 'failed_retry']));
  return row?.count ?? 0;
};

export const getPromptStatusCounts = async () => {
  const [row] = await databaseClient
    .select({
      queued: sql<number>`sum(case when ${prompts.status} in ('queued','failed_retry') then 1 else 0 end)`,
      inProgress: sql<number>`sum(case when ${prompts.status} = 'in_progress' then 1 else 0 end)`,
      completed: sql<number>`sum(case when ${prompts.status} = 'completed' then 1 else 0 end)`,
      failed: sql<number>`sum(case when ${prompts.status} = 'failed' then 1 else 0 end)`,
      callbackPending: sql<number>`sum(case when ${prompts.status} = 'completed' and ${prompts.callbackUrl} is not null and ${prompts.callbackCompleted} = 0 then 1 else 0 end)`
    })
    .from(prompts);

  return {
    queued: row?.queued ?? 0,
    inProgress: row?.inProgress ?? 0,
    completed: row?.completed ?? 0,
    failed: row?.failed ?? 0,
    callbackPending: row?.callbackPending ?? 0
  };
};

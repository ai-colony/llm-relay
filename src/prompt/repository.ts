import { database } from '@db';
import { type PromptStatus } from '@db/schema';
import { and, count, eq, inArray, isNull, lte, not, or, sql } from 'drizzle-orm';

const {
  dbClient,
  dbSchema: { prompts }
} = database;

// Add new prompt to the database
export const addPrompt = async (prompt: {
  clientName: string;
  requestId: number;
  callbackUrl?: string;
  systemPrompt?: string;
  userPrompt: string;
  temperature: number;
}) => {
  const { clientName, requestId, callbackUrl, systemPrompt, userPrompt, temperature } = prompt;
  const result = await dbClient.insert(prompts).values({
    clientName,
    requestId,
    createdAt: new Date(),

    callbackUrl,
    callbackCompleted: false,

    status: 'queued',
    retryCount: 0,

    systemPrompt,
    userPrompt,
    temperature
  });
  return result.lastInsertRowid;
};

// Find the first prompt that is queued or failed but retryable, ordered by creation time
export const findFirstQueuedPrompt = () =>
  dbClient
    .select()
    .from(prompts)
    .where(
      and(
        inArray(prompts.status, ['queued', 'failed_retry']),
        or(isNull(prompts.nextRetryAt), lte(prompts.nextRetryAt, new Date()))
      )
    )
    .orderBy(prompts.createdAt)
    .limit(1);

// Update prompts
export const updatePromptSetInProgress = (id: number) =>
  dbClient.update(prompts).set({ status: 'in_progress' }).where(eq(prompts.id, id));

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
  dbClient
    .update(prompts)
    .set({
      status: 'completed',
      completedAt: new Date(),
      ...data
    })
    .where(eq(prompts.id, id));

export const updatePromptSetFailed = (id: number, error: string, retryable: boolean, nextRetryAt?: Date) =>
  dbClient
    .update(prompts)
    .set({
      status: retryable ? 'failed_retry' : 'failed',
      statusError: error,
      completedAt: new Date(),
      ...(retryable ? { retryCount: sql`${prompts.retryCount} + 1`, nextRetryAt } : {})
    })
    .where(eq(prompts.id, id));

// Handle callback prompts
export const findCallbackPendingPrompts = () =>
  dbClient
    .select()
    .from(prompts)
    .where(and(eq(prompts.status, 'completed'), not(isNull(prompts.callbackUrl)), eq(prompts.callbackCompleted, false)))
    .limit(50);

export const updatePromptSetCallbackCompleted = (id: number) =>
  dbClient.update(prompts).set({ callbackCompleted: true }).where(eq(prompts.id, id));

export const findPromptByClientNameAndRequestId = (clientName: string, requestId: number) =>
  dbClient
    .select()
    .from(prompts)
    .where(and(eq(prompts.clientName, clientName), eq(prompts.requestId, requestId)))
    .limit(1);

export const findPromptsByClientName = (clientName: string, status?: PromptStatus, limit = 500) =>
  dbClient
    .select({
      requestId: prompts.requestId,
      status: prompts.status,
      createdAt: prompts.createdAt,
      completedAt: prompts.completedAt
    })
    .from(prompts)
    .where(
      status ? and(eq(prompts.clientName, clientName), eq(prompts.status, status)) : eq(prompts.clientName, clientName)
    )
    .orderBy(prompts.createdAt)
    .limit(limit);

export const deletePromptByClientNameAndRequestId = (clientName: string, requestId: number) =>
  dbClient
    .delete(prompts)
    .where(
      and(
        eq(prompts.clientName, clientName),
        eq(prompts.requestId, requestId),
        inArray(prompts.status, ['queued', 'failed', 'failed_retry'])
      )
    );

export const resetInProgressPrompts = () =>
  dbClient.update(prompts).set({ status: 'queued' }).where(eq(prompts.status, 'in_progress'));

export const getPromptStatusCounts = async () => {
  const statusRows = await dbClient
    .select({ status: prompts.status, count: count() })
    .from(prompts)
    .groupBy(prompts.status);

  const [callbackPendingRow] = await dbClient
    .select({ count: count() })
    .from(prompts)
    .where(
      and(eq(prompts.status, 'completed'), not(isNull(prompts.callbackUrl)), eq(prompts.callbackCompleted, false))
    );

  const statusMap = Object.fromEntries(statusRows.map((r) => [r.status, r.count]));

  return {
    queued: (statusMap['queued'] ?? 0) + (statusMap['failed_retry'] ?? 0),
    pending: statusMap['in_progress'] ?? 0,
    completed: statusMap['completed'] ?? 0,
    failed: statusMap['failed'] ?? 0,
    callbackPending: callbackPendingRow?.count ?? 0
  };
};

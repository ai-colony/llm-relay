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
  requestId: string;
  callbackUrl?: string;
  systemPrompt?: string;
  userPrompt: string;
  temperature: number;
  priority?: number;
}) => {
  const { clientName, requestId, callbackUrl, systemPrompt, userPrompt, temperature, priority = 0 } = prompt;
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
    temperature,
    priority
  });
  return result.lastInsertRowid;
};

// Find prompts that are queued or failed but retryable, ordered by priority then creation time
export const findQueuedPrompts = (limit: number) =>
  dbClient
    .select()
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
  dbClient.update(prompts).set({ status: 'in_progress' }).where(inArray(prompts.id, ids));

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

export const findPromptByClientNameAndRequestId = (clientName: string, requestId: string) =>
  dbClient
    .select()
    .from(prompts)
    .where(and(eq(prompts.clientName, clientName), eq(prompts.requestId, requestId)))
    .limit(1);

export const findPromptsByClientName = (clientName: string, status?: PromptStatus, limit = 500) =>
  dbClient
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

export const deletePromptByClientNameAndRequestId = (clientName: string, requestId: string) =>
  dbClient
    .delete(prompts)
    .where(
      and(
        eq(prompts.clientName, clientName),
        eq(prompts.requestId, requestId),
        inArray(prompts.status, ['queued', 'failed', 'failed_retry'])
      )
    );

export const deletePromptForOverwrite = (clientName: string, requestId: string) =>
  dbClient
    .delete(prompts)
    .where(
      and(
        eq(prompts.clientName, clientName),
        eq(prompts.requestId, requestId),
        inArray(prompts.status, ['queued', 'completed', 'failed', 'failed_retry'])
      )
    );

export const resetInProgressPrompts = () =>
  dbClient.update(prompts).set({ status: 'queued' }).where(eq(prompts.status, 'in_progress'));

export const purgeCompletedPrompts = async (olderThanDays: number, clientName?: string): Promise<number> => {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result = await dbClient
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
  const [row] = await dbClient
    .select({ count: count() })
    .from(prompts)
    .where(inArray(prompts.status, ['queued', 'failed_retry']));
  return row?.count ?? 0;
};

export const getPromptStatusCounts = async () => {
  const [row] = await dbClient
    .select({
      queued: sql<number>`sum(case when ${prompts.status} in ('queued','failed_retry') then 1 else 0 end)`,
      pending: sql<number>`sum(case when ${prompts.status} = 'in_progress' then 1 else 0 end)`,
      completed: sql<number>`sum(case when ${prompts.status} = 'completed' then 1 else 0 end)`,
      failed: sql<number>`sum(case when ${prompts.status} = 'failed' then 1 else 0 end)`,
      callbackPending: sql<number>`sum(case when ${prompts.status} = 'completed' and ${prompts.callbackUrl} is not null and ${prompts.callbackCompleted} = 0 then 1 else 0 end)`
    })
    .from(prompts);

  return {
    queued: row?.queued ?? 0,
    pending: row?.pending ?? 0,
    completed: row?.completed ?? 0,
    failed: row?.failed ?? 0,
    callbackPending: row?.callbackPending ?? 0
  };
};

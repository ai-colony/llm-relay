import { database } from '@db';
import { type PromptStatus } from '@db/schema';
import { and, count, eq, inArray, isNull, not } from 'drizzle-orm';

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
}) => {
  const { clientName, requestId, callbackUrl, systemPrompt, userPrompt } = prompt;
  const result = await dbClient.insert(prompts).values({
    clientName,
    requestId,
    createdAt: new Date(),

    callbackUrl,
    callbackCompleted: false,

    status: 'queued',

    systemPrompt,
    userPrompt
  });
  return result.lastInsertRowid;
};

// Find the first prompt that is queued or failed but retryable, ordered by creation time
export const findFirstQueuedPrompt = () =>
  dbClient
    .select()
    .from(prompts)
    .where(inArray(prompts.status, ['queued', 'failed_retry']))
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

export const updatePromptSetFailed = (id: number, error: string, retryable: boolean) =>
  dbClient
    .update(prompts)
    .set({
      status: retryable ? 'failed_retry' : 'failed',
      statusError: error,
      completedAt: new Date()
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

export const findPromptsByClientName = (clientName: string, status?: PromptStatus) =>
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
    .orderBy(prompts.createdAt);

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

export const getPromptStatusCounts = async () => {
  const [queuedRow] = await dbClient
    .select({ count: count() })
    .from(prompts)
    .where(inArray(prompts.status, ['queued', 'failed_retry']));

  const [pendingRow] = await dbClient.select({ count: count() }).from(prompts).where(eq(prompts.status, 'in_progress'));

  const [completedRow] = await dbClient.select({ count: count() }).from(prompts).where(eq(prompts.status, 'completed'));

  const [failedRow] = await dbClient.select({ count: count() }).from(prompts).where(eq(prompts.status, 'failed'));

  const [callbackPendingRow] = await dbClient
    .select({ count: count() })
    .from(prompts)
    .where(
      and(eq(prompts.status, 'completed'), not(isNull(prompts.callbackUrl)), eq(prompts.callbackCompleted, false))
    );

  return {
    queued: queuedRow?.count ?? 0,
    pending: pendingRow?.count ?? 0,
    completed: completedRow?.count ?? 0,
    failed: failedRow?.count ?? 0,
    callbackPending: callbackPendingRow?.count ?? 0
  };
};

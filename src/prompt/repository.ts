import { database } from '@db';
import { and, eq, inArray, isNull, not } from 'drizzle-orm';

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
    reasoningTime: number;
    reasoningTokenPerSecond: number;
    responseTime: number;
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
      status: retryable ? 'failed' : 'failed_retry',
      statusError: error,
      completedAt: new Date()
    })
    .where(eq(prompts.id, id));

// Handle callback prompts
export const findCallbackPendingPrompts = () =>
  dbClient
    .select()
    .from(prompts)
    .where(
      and(eq(prompts.status, 'completed'), not(isNull(prompts.callbackUrl)), eq(prompts.callbackCompleted, false))
    );

export const updatePromptSetCallbackCompleted = (id: number) =>
  dbClient.update(prompts).set({ callbackCompleted: true }).where(eq(prompts.id, id));

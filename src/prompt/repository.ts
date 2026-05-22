import { type MatchAnyKeywords } from '@andrewitsover/midnight';
import { database } from '@db';

// Add new prompt to the database
export const addPrompt = (prompt: {
  clientName: string;
  requestId: number;
  callbackUrl?: string;
  systemPrompt?: string;
  userPrompt: string;
}) => {
  const { clientName, requestId, callbackUrl, systemPrompt, userPrompt } = prompt;
  return database.prompt.insert({
    clientName,
    requestId,
    callbackUrl,
    callbackCompleted: false,

    status: 'queued',

    systemPrompt,
    userPrompt
  });
};

// Find the first prompt that is queued or failed but retryable, ordered by creation time
export const findFirstQueuedPrompt = () =>
  database.prompt.first({
    where: { status: ['queued', 'failed_retry'] },
    orderBy: 'createdAt'
  });

// Update prompts
export const updatePromptSetInProgress = (id: number) =>
  database.prompt.update({
    set: { status: 'in_progress' },
    where: { id }
  });

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
  database.prompt.update({
    set: {
      status: 'completed',
      completedAt: new Date(),
      ...data
    },
    where: { id }
  });

export const updatePromptSetFailed = (id: number, error: string, retryable: boolean) =>
  database.prompt.update({
    set: {
      status: retryable ? 'failed' : 'failed_retry',
      statusError: error,
      completedAt: new Date()
    },
    where: { id }
  });

// Handle callback prompts
export const findCallbackPendingPrompts = () =>
  database.prompt.many({
    status: 'completed',
    callbackUrl: (c: MatchAnyKeywords) => c.not(undefined),
    callbackCompleted: false
  });

export const updatePromptSetCallbackCompleted = (id: number) =>
  database.prompt.update({
    set: { callbackCompleted: true },
    where: { id }
  });

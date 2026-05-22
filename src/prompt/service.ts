import { executeOpenAIPrompt, logger } from '@lib';

import {
  findCallbackPendingPrompts,
  findFirstQueuedPrompt,
  updatePromptSetCallbackCompleted,
  updatePromptSetCompleted,
  updatePromptSetFailed,
  updatePromptSetInProgress
} from './repository';

const computeNextRetryAt = (recentRetryCount: number): Date => {
  const delayMs = Math.min(2 ** recentRetryCount * 1000, 60_000);
  return new Date(Date.now() + delayMs);
};

const isTransientError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    error.name === 'AbortError' ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('econnrefused') ||
    message.includes('fetch failed') ||
    message.includes('network error') ||
    message.includes('socket hang up') ||
    isTransientError(error.cause)
  );
};

export { addPrompt as createPrompt } from './repository';

export const processCallbackPendingPrompts = async () => {
  const pendingPrompts = await findCallbackPendingPrompts();
  if (pendingPrompts.length === 0) return;

  for (const prompt of pendingPrompts)
    if (prompt.callbackUrl)
      try {
        await fetch(prompt.callbackUrl, {
          signal: AbortSignal.timeout(10_000),
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientName: prompt.clientName,
            requestId: prompt.requestId,
            reasoning: prompt.reasoning,
            response: prompt.response
          })
        });
        await updatePromptSetCallbackCompleted(prompt.id);
        logger.info(
          `Successfully sent callback for prompt ${prompt.clientName}-${prompt.requestId} to ${prompt.callbackUrl}`
        );
      } catch (error) {
        logger.error({ error }, `Failed to send callback for prompt ${prompt.id}`);
      }
};

export const processQueuedPrompts = async () => {
  const queuedPrompt = await findFirstQueuedPrompt();
  if (queuedPrompt.length === 0) return;

  const firstQueuedPrompt = queuedPrompt[0]!;
  try {
    await updatePromptSetInProgress(firstQueuedPrompt.id);

    const {
      reasoning,
      response,
      timing: { reasoningTimeMs, reasoningTokenPerSecond, responseTimeMs, responseTokenPerSecond }
    } = await executeOpenAIPrompt(
      { system: firstQueuedPrompt.systemPrompt ?? undefined, user: firstQueuedPrompt.userPrompt },
      firstQueuedPrompt.temperature
    );
    await updatePromptSetCompleted(firstQueuedPrompt.id, {
      reasoning,
      response,
      reasoningTimeMs,
      reasoningTokenPerSecond,
      responseTimeMs,
      responseTokenPerSecond
    });
    logger.info(`Successfully processed prompt ${firstQueuedPrompt.clientName}-${firstQueuedPrompt.requestId}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const retryable = isTransientError(error);
    const nextRetryAt = retryable ? computeNextRetryAt(firstQueuedPrompt.retryCount + 1) : undefined;
    await updatePromptSetFailed(firstQueuedPrompt.id, errorMessage, retryable, nextRetryAt);
    logger.error(
      { error, retryable, retryCount: firstQueuedPrompt.retryCount },
      `Failed to process prompt ${firstQueuedPrompt.clientName}-${firstQueuedPrompt.requestId}`
    );
  }
};

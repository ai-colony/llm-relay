import { config, executeOpenAIPrompt, logger } from '@lib';

import {
  findCallbackPendingPrompts,
  findQueuedPrompts,
  updatePromptSetCallbackCompleted,
  updatePromptSetCompleted,
  updatePromptSetFailed,
  updatePromptsSetInProgress
} from './repository';

const computeNextRetryAt = (recentRetryCount: number): Date => {
  const delayMs = Math.min(2 ** recentRetryCount * 1000, 60_000);
  return new Date(Date.now() + delayMs);
};

const isTransientError = (error: unknown, depth = 0): boolean => {
  if (!(error instanceof Error) || depth > 5) return false;
  const message = error.message.toLowerCase();
  return (
    error.name === 'AbortError' ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('econnrefused') ||
    message.includes('fetch failed') ||
    message.includes('network error') ||
    message.includes('socket hang up') ||
    isTransientError(error.cause, depth + 1)
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
          {
            component: 'callback',
            clientName: prompt.clientName,
            requestId: prompt.requestId,
            callbackUrl: prompt.callbackUrl
          },
          'Callback sent'
        );
      } catch (error) {
        logger.error(
          {
            component: 'callback',
            error,
            clientName: prompt.clientName,
            requestId: prompt.requestId,
            callbackUrl: prompt.callbackUrl
          },
          'Callback failed'
        );
      }
};

const executePrompt = async (prompt: Awaited<ReturnType<typeof findQueuedPrompts>>[number]) => {
  try {
    const {
      reasoning,
      response,
      timing: { reasoningTimeMs, reasoningTokenPerSecond, responseTimeMs, responseTokenPerSecond }
    } = await executeOpenAIPrompt({ system: prompt.systemPrompt, user: prompt.userPrompt }, prompt.temperature);
    await updatePromptSetCompleted(prompt.id, {
      reasoning,
      response,
      reasoningTimeMs,
      reasoningTokenPerSecond,
      responseTimeMs,
      responseTokenPerSecond
    });
    logger.info(
      { component: 'worker', clientName: prompt.clientName, requestId: prompt.requestId },
      'Prompt completed'
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const transient = isTransientError(error);
    const retryable = transient && prompt.retryCount + 1 < config.openai.maxRetryCount;
    const nextRetryAt = retryable ? computeNextRetryAt(prompt.retryCount + 1) : undefined;
    await updatePromptSetFailed(
      prompt.id,
      transient && !retryable ? 'max_retries_exceeded' : errorMessage,
      retryable,
      nextRetryAt
    );
    logger.error(
      {
        component: 'worker',
        error,
        clientName: prompt.clientName,
        requestId: prompt.requestId,
        retryable,
        retryCount: prompt.retryCount
      },
      'Prompt failed'
    );
  }
};

export const processQueuedPrompts = async () => {
  const batch = await findQueuedPrompts(config.worker.concurrency);
  if (batch.length === 0) return;

  await updatePromptsSetInProgress(batch.map((p) => p.id));
  for (const prompt of batch)
    logger.debug(
      { component: 'worker', clientName: prompt.clientName, requestId: prompt.requestId },
      'Prompt picked up'
    );

  await Promise.all(batch.map((prompt) => executePrompt(prompt)));
};

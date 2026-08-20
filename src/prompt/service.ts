import {
  computeNextRetryAt,
  config,
  deliverJobCallback,
  executeGenerativePrompt,
  isTransientError,
  logger,
  recordUpstreamMetrics,
  type UpstreamMetricsSpec
} from '@lib';

import {
  findCallbackPendingPrompts,
  findQueuedPrompts,
  updatePromptSetCallbackCompleted,
  updatePromptSetCompleted,
  updatePromptSetFailed,
  updatePromptsSetInProgress
} from './repo';

// Callbacks are delivered concurrently, but capped so one slow host cannot saturate the tick.
const CALLBACK_CONCURRENCY = 10;

const WORKER_METRICS: UpstreamMetricsSpec = {
  counter: { name: 'generative_requests_total', help: 'Total generative completion requests from the prompt worker' },
  histogram: {
    name: 'generative_request_duration_seconds',
    help: 'Generative completion request duration in seconds (prompt worker)'
  }
};

const deliverCallback = async (prompt: Awaited<ReturnType<typeof findCallbackPendingPrompts>>[number]) => {
  // findCallbackPendingPrompts already filters out null callbackUrl; the guard is only here because
  // Drizzle cannot express that narrowing in the row type.
  if (!prompt.callbackUrl) return;

  const isDelivered = await deliverJobCallback({
    url: prompt.callbackUrl,
    body: JSON.stringify({
      clientName: prompt.clientName,
      requestId: prompt.requestId,
      reasoning: prompt.reasoning,
      response: prompt.response
    }),
    logContext: {
      component: 'callback',
      clientName: prompt.clientName,
      requestId: prompt.requestId,
      callbackUrl: prompt.callbackUrl
    }
  });
  if (isDelivered) await updatePromptSetCallbackCompleted(prompt.id);
};

export const processCallbackPendingPrompts = async () => {
  const cutoff = new Date(Date.now() - config.callback.retryTtlHours * 60 * 60 * 1000);
  const pendingPrompts = await findCallbackPendingPrompts(cutoff);
  if (pendingPrompts.length === 0) return;

  for (let index = 0; index < pendingPrompts.length; index += CALLBACK_CONCURRENCY)
    await Promise.all(
      pendingPrompts.slice(index, index + CALLBACK_CONCURRENCY).map((prompt) => deliverCallback(prompt))
    );
};

const executePrompt = async (prompt: Awaited<ReturnType<typeof findQueuedPrompts>>[number]) => {
  const startedAt = performance.now();
  try {
    const {
      reasoning,
      response,
      timing: { reasoningTimeMs, reasoningTokenPerSecond, responseTimeMs, responseTokenPerSecond }
    } = await executeGenerativePrompt({ system: prompt.systemPrompt, user: prompt.userPrompt }, prompt.temperature);
    recordUpstreamMetrics(WORKER_METRICS, 'success', startedAt);
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
    recordUpstreamMetrics(WORKER_METRICS, 'failure', startedAt);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isTransient = isTransientError(error);
    const isRetryable = isTransient && prompt.retryCount + 1 < config.upstream.maxRetryCount;
    const nextRetryAt = isRetryable ? computeNextRetryAt(prompt.retryCount + 1) : undefined;
    await updatePromptSetFailed(
      prompt.id,
      isTransient && !isRetryable ? 'max_retries_exceeded' : errorMessage,
      isRetryable,
      nextRetryAt
    );
    logger.error(
      {
        component: 'worker',
        error,
        clientName: prompt.clientName,
        requestId: prompt.requestId,
        retryable: isRetryable,
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

export { addPrompt as createPrompt } from './repository';
import { executeOpenAIPrompt, logger } from '@lib';

import {
  findCallbackPendingPrompts,
  findFirstQueuedPrompt,
  updatePromptSetCallbackCompleted,
  updatePromptSetCompleted,
  updatePromptSetFailed,
  updatePromptSetInProgress
} from './repository';

export const processCallbackPendingPrompts = async () => {
  const pendingPrompts = findCallbackPendingPrompts();
  if (pendingPrompts.length === 0) {
    logger.debug('No pending prompts with callbacks to process');
    return;
  }
  for (const prompt of pendingPrompts)
    try {
      await fetch(prompt.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName: prompt.clientName,
          requestId: prompt.requestId,
          reasoning: prompt.reasoning,
          response: prompt.response
        })
      });
      updatePromptSetCallbackCompleted(prompt.id);
      logger.info(
        `Successfully sent callback for prompt ${prompt.clientName}-${prompt.requestId} to ${prompt.callbackUrl}`
      );
    } catch (error) {
      logger.error(`Failed to send callback for prompt ${prompt.id}: ${error}`);
    }
};

export const processQueuedPrompts = async () => {
  const queuedPrompt = findFirstQueuedPrompt();
  if (!queuedPrompt) {
    logger.debug('No queued prompts to process');
    return;
  }

  try {
    updatePromptSetInProgress(queuedPrompt.id);

    const {
      reasoning,
      response,
      timing: { reasoningTime, reasoningTokenPerSecond, responseTime, responseTokenPerSecond }
    } = await executeOpenAIPrompt(
      { system: queuedPrompt.systemPrompt ?? undefined, user: queuedPrompt.userPrompt },
      0.5
    );
    updatePromptSetCompleted(queuedPrompt.id, {
      reasoning,
      response,
      reasoningTime,
      reasoningTokenPerSecond,
      responseTime,
      responseTokenPerSecond
    });
    logger.info(`Successfully processed prompt ${queuedPrompt.clientName}-${queuedPrompt.requestId}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    updatePromptSetFailed(queuedPrompt.id, errorMessage, false);
    logger.error(`Failed to process prompt ${queuedPrompt.clientName}-${queuedPrompt.requestId}: ${errorMessage}`);
  }
};

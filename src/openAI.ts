import OpenAI from 'openai';
import type { ChatCompletionChunk } from 'openai/resources';

import { config } from './config';
import { logger } from './logger';

// Types
type LlamaDelta = ChatCompletionChunk.Choice.Delta & {
  reasoning_content?: string;
};

type LlamaChoice = Omit<ChatCompletionChunk.Choice, 'delta'> & {
  delta: LlamaDelta;
};

type LlamaChunk = Omit<ChatCompletionChunk, 'choices'> & {
  choices: LlamaChoice[];
};

const openai = new OpenAI({
  baseURL: config.openai.url,
  apiKey: config.openai.key,
  timeout: config.openai.timeout
});

let resolvedModelPromise: Promise<string> | undefined;

const resolveModel = (): Promise<string> => {
  if (!resolvedModelPromise)
    resolvedModelPromise = (async () => {
      const requestedModel = config.openai.model;
      const list = await openai.models.list();
      const model = requestedModel ? list.data.find((m) => m.id === requestedModel)?.id : list.data[0]?.id;
      if (!model) throw new Error('No models found' + (requestedModel ? ` with id ${requestedModel}` : ''));
      logger.info(`[OpenAI] Using model: ${model}`);
      return model;
    })();

  return resolvedModelPromise;
};

export const executeOpenAIPrompt = async (
  prompt: { system: string | undefined; user: string },
  temperature: number
): Promise<{
  reasoning: string;
  response: string;
  timing: {
    reasoningTime: number;
    reasoningTokenPerSecond: number;
    responseTime: number;
    responseTokenPerSecond: number;
  };
}> => {
  const model = await resolveModel();

  logger.info(
    `[OpenAI] Sending prompt: System: ${prompt.system?.slice(0, 100)}... User: ${prompt.user.slice(0, 100)}...`
  );
  const completion = (await openai.chat.completions.create({
    model,
    messages: prompt.system
      ? [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user }
        ]
      : [{ role: 'user', content: prompt.user }],
    temperature,
    stream: true
  })) as unknown as AsyncIterable<LlamaChunk>;

  let reasoning = '';
  let response = '';
  let reasoningToken = 0;
  let responseToken = 0;
  let reasoningStartedAt = 0;
  let reasoningEndedAt = 0;
  let responseStartedAt = 0;

  let isReasoningStarted = false;
  let isReasoningEnded = false;
  for await (const part of completion) {
    const delta = part.choices[0]?.delta;

    const content = delta?.content ?? '';
    const reasoning_content = delta?.reasoning_content ?? '';

    if (isReasoningStarted && !isReasoningEnded && !reasoning_content) {
      isReasoningEnded = true;
      reasoningEndedAt = Date.now();
      responseStartedAt = Date.now();
    }

    if (!isReasoningStarted && reasoning_content) {
      isReasoningStarted = true;
      reasoningStartedAt = Date.now();
    }

    if (reasoning_content) {
      reasoning += reasoning_content;
      reasoningToken++;
    }
    if (content) {
      response += content;
      responseToken++;
    }
  }
  const responseEndedAt = Date.now();

  return {
    reasoning,
    response,
    timing: {
      reasoningTime: Math.round(
        reasoningEndedAt && reasoningStartedAt ? (reasoningEndedAt - reasoningStartedAt) / 1000 : 0
      ),
      reasoningTokenPerSecond: Math.round(
        reasoningEndedAt && reasoningStartedAt
          ? Math.round(reasoningToken / ((reasoningEndedAt - reasoningStartedAt) / 1000))
          : 0
      ),
      responseTime: Math.round(responseEndedAt && responseStartedAt ? (responseEndedAt - responseStartedAt) / 1000 : 0),
      responseTokenPerSecond:
        responseEndedAt && responseStartedAt
          ? Math.round(responseToken / ((responseEndedAt - responseStartedAt) / 1000))
          : 0
    }
  };
};

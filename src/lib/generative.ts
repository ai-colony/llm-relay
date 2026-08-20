import OpenAI from 'openai';
import type { ChatCompletionChunk, ChatCompletionMessageParam, ReasoningEffort } from 'openai/resources';

import type { RelayMessage, RelayTool } from './chatSchemas';
import { config } from './config';
import { logger } from './logger';
import { createModelResolver } from './modelInfo';

// Types — the upstream chunk shape plus the reasoning_content field OpenAI-compatible backends add.
type RelayDelta = ChatCompletionChunk.Choice.Delta & {
  reasoning_content?: string;
};

type RelayChoice = Omit<ChatCompletionChunk.Choice, 'delta'> & {
  delta: RelayDelta;
};

type RelayChunk = Omit<ChatCompletionChunk, 'choices'> & {
  choices: RelayChoice[];
};

const openai = new OpenAI({
  baseURL: config.generative.url,
  apiKey: config.generative.key,
  timeout: config.upstream.timeout
});

const resolver = createModelResolver('generative', () => config.generative);

export const getGenerativeModelInfo = resolver.getModelInfo;
export const checkGenerative = resolver.check;

// Spread into every completion request. 'default' means "say nothing and let the backend decide";
// any other value is sent verbatim. See config.reasoning.effort for why the default is 'none'.
const reasoningParameters = (): { reasoning_effort?: ReasoningEffort } =>
  config.reasoning.effort === 'default' ? {} : { reasoning_effort: config.reasoning.effort };

const resolveModel = async (): Promise<string> => {
  const info = await getGenerativeModelInfo();
  return info.model;
};

export const streamChatCompletion = async function* (
  messages: RelayMessage[],
  tools?: RelayTool[],
  temperature?: number,
  signal?: AbortSignal
): AsyncGenerator<RelayChunk> {
  const model = await resolveModel();
  const completion = (await openai.chat.completions.create(
    {
      model,
      messages: messages as unknown as ChatCompletionMessageParam[],
      tools,
      ...(temperature !== undefined && { temperature }),
      ...reasoningParameters(),
      stream: true
    },
    { signal }
  )) as unknown as AsyncIterable<RelayChunk>;

  for await (const chunk of completion) yield chunk;
};

export const executeGenerativePrompt = async (
  prompt: { system: string | null | undefined; user: string },
  temperature: number
): Promise<{
  reasoning: string;
  response: string;
  timing: {
    reasoningTimeMs: number;
    reasoningTokenPerSecond: number;
    responseTimeMs: number;
    responseTokenPerSecond: number;
  };
}> => {
  const model = await resolveModel();

  logger.info(
    {
      component: 'generative',
      sizes: { system: prompt.system?.length, user: prompt.user.length },
      system: prompt.system?.slice(0, 100),
      user: prompt.user.slice(0, 100)
    },
    'Sending prompt'
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
    ...reasoningParameters(),
    stream: true
  })) as unknown as AsyncIterable<RelayChunk>;

  let reasoning = '';
  let response = '';
  let reasoningChars = 0;
  let responseChars = 0;
  let reasoningStartedAt = 0;
  let reasoningEndedAt = 0;
  let responseStartedAt = 0;

  let isReasoningStarted = false;
  let isReasoningEnded = false;
  for await (const part of completion) {
    const delta = part.choices[0]?.delta;

    const content = delta?.content ?? '';
    const reasoningContent = delta?.reasoning_content ?? '';

    if (isReasoningStarted && !isReasoningEnded && !reasoningContent) {
      isReasoningEnded = true;
      reasoningEndedAt = Date.now();
    }

    if (!isReasoningStarted && reasoningContent) {
      isReasoningStarted = true;
      reasoningStartedAt = Date.now();
    }

    if (reasoningContent) {
      reasoning += reasoningContent;
      reasoningChars += reasoningContent.length;
    }
    if (content) {
      if (!responseStartedAt) responseStartedAt = Date.now();
      response += content;
      responseChars += content.length;
    }
  }
  const responseEndedAt = Date.now();

  const reasoningTimeMs = reasoningEndedAt && reasoningStartedAt ? reasoningEndedAt - reasoningStartedAt : 0;
  const responseTimeMs = responseStartedAt ? responseEndedAt - responseStartedAt : 0;
  // chars/4 is a standard approximation for token count
  const reasoningToken = Math.round(reasoningChars / 4);
  const responseToken = Math.round(responseChars / 4);

  const timing = {
    reasoningTimeMs,
    reasoningTokenPerSecond: reasoningTimeMs > 0 ? Math.round(reasoningToken / (reasoningTimeMs / 1000)) : 0,
    responseTimeMs,
    responseTokenPerSecond: responseTimeMs > 0 ? Math.round(responseToken / (responseTimeMs / 1000)) : 0
  };
  logger.info({ component: 'generative', model, ...timing }, 'Upstream completion finished');
  return { reasoning, response, timing };
};

export { type ModelInfo } from './modelInfo';

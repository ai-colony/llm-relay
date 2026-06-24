import OpenAI from 'openai';
import type { ChatCompletionChunk, ChatCompletionMessageParam } from 'openai/resources';
import type { z } from 'zod';

import type { RelayMessageSchema, RelayToolSchema } from '../hono/chat/schemas';
import { config } from './config';
import { logger } from './logger';

type RelayMessage = z.infer<typeof RelayMessageSchema>;
type RelayTool = z.infer<typeof RelayToolSchema>;

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
      logger.info({ component: 'openai', model }, 'Using model');
      return model;
    })().catch((error: unknown) => {
      resolvedModelPromise = undefined;
      throw error;
    });

  return resolvedModelPromise;
};

export async function checkOpenAI(): Promise<{ ok: boolean; error?: string }> {
  let response: Response;
  try {
    response = await fetch(`${config.openai.url}/models`, {
      headers: { Authorization: `Bearer ${config.openai.key}` },
      signal: AbortSignal.timeout(5000)
    });
  } catch (error) {
    return { ok: false, error: String(error) };
  }
  return response.ok ? { ok: true } : { ok: false, error: `HTTP ${response.status}` };
}

export const streamChatCompletion = async function* (
  messages: RelayMessage[],
  tools?: RelayTool[]
): AsyncGenerator<LlamaChunk> {
  const model = await resolveModel();
  const completion = (await openai.chat.completions.create({
    model,
    messages: messages as unknown as ChatCompletionMessageParam[],
    tools,
    stream: true
  })) as unknown as AsyncIterable<LlamaChunk>;

  for await (const chunk of completion) yield chunk;
};

export const executeOpenAIPrompt = async (
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
      component: 'openai',
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
    stream: true
  })) as unknown as AsyncIterable<LlamaChunk>;

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
    const reasoning_content = delta?.reasoning_content ?? '';

    if (isReasoningStarted && !isReasoningEnded && !reasoning_content) {
      isReasoningEnded = true;
      reasoningEndedAt = Date.now();
    }

    if (!isReasoningStarted && reasoning_content) {
      isReasoningStarted = true;
      reasoningStartedAt = Date.now();
    }

    if (reasoning_content) {
      reasoning += reasoning_content;
      reasoningChars += reasoning_content.length;
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
  logger.info({ component: 'openai', model, ...timing }, 'Prompt completed');
  return { reasoning, response, timing };
};

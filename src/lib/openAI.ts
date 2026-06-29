import path from 'node:path';

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

export type ModelInfo = { model: string; contextSize: number | undefined };

let resolvedModelInfoPromise: Promise<ModelInfo> | undefined;

const resolveModelInfo = (): Promise<ModelInfo> => {
  if (!resolvedModelInfoPromise)
    resolvedModelInfoPromise = (async () => {
      const requestedModel = config.openai.model;
      const response = await fetch(`${config.openai.url}/models`, {
        headers: { Authorization: `Bearer ${config.openai.key}` },
        signal: AbortSignal.timeout(config.openai.timeout)
      });
      if (!response.ok) throw new Error(`Models endpoint returned HTTP ${response.status}`);
      const json = (await response.json()) as { data: Array<{ id: string; meta?: { n_ctx?: number } }> };
      const entry = requestedModel ? json.data.find((m) => m.id === requestedModel) : json.data[0];
      if (!entry) throw new Error('No models found' + (requestedModel ? ` with id ${requestedModel}` : ''));
      const contextSize = entry.meta?.n_ctx;
      const model = path.basename(entry.id);
      logger.info({ component: 'openai', model, contextSize }, 'Using model');
      return { model, contextSize };
    })().catch((error: unknown) => {
      resolvedModelInfoPromise = undefined;
      throw error;
    });

  return resolvedModelInfoPromise;
};

const resolveModel = async (): Promise<string> => {
  const info = await resolveModelInfo();
  return info.model;
};

export const getModelInfo = (): Promise<ModelInfo> => resolveModelInfo();

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
  tools?: RelayTool[],
  temperature?: number,
  signal?: AbortSignal
): AsyncGenerator<LlamaChunk> {
  const model = await resolveModel();
  const completion = (await openai.chat.completions.create(
    {
      model,
      messages: messages as unknown as ChatCompletionMessageParam[],
      tools,
      ...(temperature !== undefined && { temperature }),
      stream: true
    },
    { signal }
  )) as unknown as AsyncIterable<LlamaChunk>;

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

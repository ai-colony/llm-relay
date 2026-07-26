import path from 'node:path';

import OpenAI from 'openai';
import type { ChatCompletionChunk, ChatCompletionMessageParam } from 'openai/resources';

import type { RelayMessage, RelayTool } from './chatSchemas';
import { config } from './config';
import { logger } from './logger';

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
  baseURL: config.openai.url,
  apiKey: config.openai.key,
  timeout: config.openai.timeout
});

export type ModelInfo = { model: string; contextSize: number | undefined };

// Deliberately short and decoupled from config.openai.timeout so /health fails fast even when
// the configured completion timeout is long.
const HEALTH_CHECK_TIMEOUT_MS = 5000;

let resolvedModelInfoPromise: Promise<ModelInfo> | undefined;
let resolvedAt = 0;

export const getModelInfo = (): Promise<ModelInfo> => {
  if (resolvedModelInfoPromise && Date.now() - resolvedAt > config.openai.modelCacheTtlMs)
    resolvedModelInfoPromise = undefined;

  if (!resolvedModelInfoPromise) {
    // Stamped here rather than only after the fetch resolves: while the request is in flight the TTL
    // check above must not consider the cache stale, or every concurrent caller would discard the
    // in-flight promise and fire its own /models request. Re-stamped on success below so the TTL
    // window measures from the resolved value.
    resolvedAt = Date.now();
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
      resolvedAt = Date.now();
      return { model, contextSize };
    })().catch((error: unknown) => {
      resolvedModelInfoPromise = undefined;
      throw error;
    });
  }

  return resolvedModelInfoPromise;
};

const resolveModel = async (): Promise<string> => {
  const info = await getModelInfo();
  return info.model;
};

export async function checkOpenAI(): Promise<{ ok: boolean; error?: string }> {
  let response: Response;
  try {
    response = await fetch(`${config.openai.url}/models`, {
      headers: { Authorization: `Bearer ${config.openai.key}` },
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS)
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
): AsyncGenerator<RelayChunk> {
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
  )) as unknown as AsyncIterable<RelayChunk>;

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
  logger.info({ component: 'openai', model, ...timing }, 'Upstream completion finished');
  return { reasoning, response, timing };
};

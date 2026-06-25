import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { z } from 'zod';

import { logger } from '../../lib/logger';
import { streamChatCompletion } from '../../lib/openAI';
import type { RelayChatRequestSchema } from './schemas';
import { RelayChatRequestSchema as schema } from './schemas';

type RelayChatRequest = z.infer<typeof RelayChatRequestSchema>;
type StreamingApiType = Parameters<Parameters<typeof stream>[1]>[0];

const writeChunks = async (s: StreamingApiType, request: RelayChatRequest, signal?: AbortSignal) => {
  for await (const chunk of streamChatCompletion(request.messages, request.tools, request.temperature, signal))
    await s.write(`data: ${JSON.stringify(chunk)}\n\n`);
  await s.write('data: [DONE]\n\n');
};

export const completions = new Hono().post('/', zValidator('json', schema), async (c) => {
  const request = c.req.valid('json');
  const signal = c.req.raw.signal;
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  return stream(c, async (s) => {
    try {
      await writeChunks(s, request, signal);
    } catch (error) {
      logger.error({ component: 'chat', error }, 'Chat stream error');
      await s.write(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`);
    }
  });
});

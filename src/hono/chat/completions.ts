import { zValidator } from '@hono/zod-validator';
import {
  logger,
  recordUpstreamMetrics,
  type RelayChatRequest,
  streamChatCompletion,
  type UpstreamMetricsSpec
} from '@lib';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';

import { RelayChatRequestSchema } from './schemas';

type StreamingApiType = Parameters<Parameters<typeof stream>[1]>[0];

const CHAT_METRICS: UpstreamMetricsSpec = {
  counter: { name: 'generative_chat_requests_total', help: 'Total generative chat completion streaming requests' },
  histogram: {
    name: 'generative_chat_request_duration_seconds',
    help: 'Generative chat completion streaming duration in seconds'
  }
};

const writeChunks = async (s: StreamingApiType, request: RelayChatRequest, signal?: AbortSignal) => {
  for await (const chunk of streamChatCompletion(request.messages, request.tools, request.temperature, signal))
    await s.write(`data: ${JSON.stringify(chunk)}\n\n`);
  await s.write('data: [DONE]\n\n');
};

export const completions = new Hono().post('/', zValidator('json', RelayChatRequestSchema), async (c) => {
  const request = c.req.valid('json');
  const signal = c.req.raw.signal;
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  return stream(c, async (s) => {
    const startedAt = performance.now();
    try {
      await writeChunks(s, request, signal);
      recordUpstreamMetrics(CHAT_METRICS, 'success', startedAt);
    } catch (error) {
      recordUpstreamMetrics(CHAT_METRICS, 'failure', startedAt);
      logger.error({ component: 'chat', error }, 'Chat stream error');
      await s.write(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`);
    }
  });
});

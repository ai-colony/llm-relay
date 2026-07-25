import { zValidator } from '@hono/zod-validator';
import { findPromptByClientNameAndRequestId } from '@prompt/repo';
import { Hono } from 'hono';

import { jsonError } from '../errors';
import { PromptKeyQuerySchema } from './schemas';

type GetPromptResponse =
  | { status: 'queued' | 'in_progress' | 'failed_retry' }
  | { status: 'failed'; statusError: string | null }
  | {
      status: 'completed';
      reasoning: string | null;
      response: string | null;
      reasoningTimeMs: number | null;
      reasoningTokenPerSecond: number | null;
      responseTimeMs: number | null;
      responseTokenPerSecond: number | null;
    };

export const get = new Hono().get('/', zValidator('query', PromptKeyQuerySchema), async (c) => {
  const { clientName, requestId } = c.req.valid('query');
  const prompt = await findPromptByClientNameAndRequestId(clientName, requestId);

  if (!prompt) return jsonError(c, 404, 'Prompt not found');

  if (prompt.status === 'completed')
    return c.json(
      {
        status: prompt.status,
        reasoning: prompt.reasoning,
        response: prompt.response,
        reasoningTimeMs: prompt.reasoningTimeMs,
        reasoningTokenPerSecond: prompt.reasoningTokenPerSecond,
        responseTimeMs: prompt.responseTimeMs,
        responseTokenPerSecond: prompt.responseTokenPerSecond
      } satisfies GetPromptResponse,
      200
    );

  if (prompt.status === 'failed')
    return c.json({ status: prompt.status, statusError: prompt.statusError } satisfies GetPromptResponse, 200);

  return c.json({ status: prompt.status } satisfies GetPromptResponse, 200);
});

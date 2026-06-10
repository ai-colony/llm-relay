import { getPromptStatusCounts } from '@prompt/repository';
import { Hono } from 'hono';

const metric = (name: string, type: 'gauge' | 'counter', help: string, value: number) =>
  `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}`;

export const metrics = new Hono().get('/', async (c) => {
  const counts = await getPromptStatusCounts();

  const body =
    [
      metric(
        'llm_relay_prompts_queued',
        'gauge',
        'Number of prompts currently queued (including failed_retry)',
        counts.queued
      ),
      metric('llm_relay_prompts_pending', 'gauge', 'Number of prompts currently being processed', counts.pending),
      metric(
        'llm_relay_prompts_completed_total',
        'counter',
        'Total number of prompts successfully completed',
        counts.completed
      ),
      metric(
        'llm_relay_prompts_failed_total',
        'counter',
        'Total number of prompts that failed permanently',
        counts.failed
      ),
      metric(
        'llm_relay_callbacks_pending',
        'gauge',
        'Number of completed prompts awaiting callback delivery',
        counts.callbackPending
      ),
      metric('llm_relay_uptime_seconds', 'gauge', 'Process uptime in seconds', Math.floor(process.uptime()))
    ].join('\n') + '\n';

  return c.text(body, 200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
});

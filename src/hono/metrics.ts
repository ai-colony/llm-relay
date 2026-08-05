import { getEmbeddingStatusCounts } from '@embedding/repo';
import { config, renderMetrics, setGauge } from '@lib';
import { getPromptStatusCounts } from '@prompt/repo';
import { Hono } from 'hono';

export const metrics = new Hono().get('/', async (c) => {
  const [counts, embeddingCounts] = await Promise.all([
    getPromptStatusCounts(),
    config.embedding ? getEmbeddingStatusCounts() : undefined
  ]);

  // All point-in-time counts read back from the database — they can decrease (DELETE /prompt/purge
  // removes completed rows), so they are gauges rather than counters.
  setGauge('llm_relay_prompts_queued', 'Number of prompts currently queued (including failed_retry)', counts.queued);
  setGauge('llm_relay_prompts_in_progress', 'Number of prompts currently being processed', counts.inProgress);
  setGauge('llm_relay_prompts_completed', 'Number of prompts successfully completed', counts.completed);
  setGauge('llm_relay_prompts_failed', 'Number of prompts that failed permanently', counts.failed);
  setGauge(
    'llm_relay_prompt_callbacks_pending',
    'Number of completed prompts awaiting callback delivery',
    counts.callbackPending
  );

  if (embeddingCounts) {
    setGauge(
      'llm_relay_embeddings_queued',
      'Number of embeddings currently queued (including failed_retry)',
      embeddingCounts.queued
    );
    setGauge(
      'llm_relay_embeddings_in_progress',
      'Number of embeddings currently being processed',
      embeddingCounts.inProgress
    );
    setGauge(
      'llm_relay_embeddings_completed',
      'Number of embeddings successfully completed',
      embeddingCounts.completed
    );
    setGauge('llm_relay_embeddings_failed', 'Number of embeddings that failed permanently', embeddingCounts.failed);
    setGauge(
      'llm_relay_embedding_callbacks_pending',
      'Number of completed embeddings awaiting callback delivery',
      embeddingCounts.callbackPending
    );
  }

  setGauge('llm_relay_uptime_seconds', 'Process uptime in seconds', Math.floor(process.uptime()));

  return c.text(renderMetrics(), 200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
});

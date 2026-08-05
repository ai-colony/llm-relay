vi.mock('../../src/prompt/repo', () => ({
  getPromptStatusCounts: vi.fn()
}));

vi.mock('../../src/embedding/repo', () => ({
  getEmbeddingStatusCounts: vi.fn()
}));

// Without this the route pulls in the real @lib barrel, which reads .env and constructs a live
// upstream client at import time. Only the metrics registry is needed here, so use the real one.
vi.mock('@lib', async () => ({
  ...(await import('../../src/lib/metrics')),
  config: { embedding: undefined }
}));

import { config } from '@lib';

import { getEmbeddingStatusCounts } from '../../src/embedding/repo';
import { metrics } from '../../src/hono/metrics';
import { incCounter, observeHistogram, resetMetrics } from '../../src/lib/metrics';
import { getPromptStatusCounts } from '../../src/prompt/repo';
import { makeStatusCounts } from '../helpers/mocks';

describe('GET /metrics', () => {
  beforeEach(() => {
    resetMetrics();
    vi.mocked(config).embedding = undefined;
  });

  it('returns Prometheus text format with queue counts', async () => {
    vi.mocked(getPromptStatusCounts).mockResolvedValue(
      makeStatusCounts({ queued: 2, inProgress: 1, completed: 10, failed: 3, callbackPending: 1 })
    );

    const response = await metrics.request('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');

    const body = await response.text();
    expect(body).toContain('llm_relay_prompts_queued 2');
    expect(body).toContain('llm_relay_prompts_in_progress 1');
    expect(body).toContain('llm_relay_prompts_completed 10');
    expect(body).toContain('llm_relay_prompts_failed 3');
    expect(body).toContain('llm_relay_prompt_callbacks_pending 1');
    expect(body).toContain('llm_relay_uptime_seconds');
    expect(body).toContain('# TYPE llm_relay_prompts_queued gauge');
    expect(body).toContain('# TYPE llm_relay_prompts_completed gauge');
  });

  it('includes labeled counters and histograms recorded in the metrics registry', async () => {
    vi.mocked(getPromptStatusCounts).mockResolvedValue(makeStatusCounts());
    incCounter('http_requests_total', 'Total HTTP requests', { method: 'GET', path: '/health', status: '200' });
    observeHistogram(
      'http_request_duration_seconds',
      'HTTP request duration in seconds',
      { method: 'GET', path: '/health' },
      0.05
    );

    const response = await metrics.request('/');
    const body = await response.text();

    expect(body).toContain('# TYPE http_requests_total counter');
    expect(body).toContain('http_requests_total{method="GET",path="/health",status="200"} 1');
    expect(body).toContain('# TYPE http_request_duration_seconds histogram');
    expect(body).toContain('http_request_duration_seconds_count{method="GET",path="/health"} 1');
  });

  it('omits the embedding gauges when no embedding backend is configured', async () => {
    vi.mocked(getPromptStatusCounts).mockResolvedValue(makeStatusCounts());

    const response = await metrics.request('/');
    const body = await response.text();

    expect(body).not.toContain('llm_relay_embeddings_');
    expect(body).not.toContain('llm_relay_embedding_callbacks_pending');
    expect(getEmbeddingStatusCounts).not.toHaveBeenCalled();
  });

  it('emits the embedding gauges when an embedding backend is configured', async () => {
    vi.mocked(config).embedding = { url: 'http://localhost:8081/v1', model: '', key: 'none' };
    vi.mocked(getPromptStatusCounts).mockResolvedValue(makeStatusCounts({ queued: 2 }));
    vi.mocked(getEmbeddingStatusCounts).mockResolvedValue(
      makeStatusCounts({ queued: 7, inProgress: 1, completed: 4, failed: 2, callbackPending: 3 })
    );

    const response = await metrics.request('/');
    const body = await response.text();

    expect(body).toContain('llm_relay_embeddings_queued 7');
    expect(body).toContain('llm_relay_embeddings_in_progress 1');
    expect(body).toContain('llm_relay_embeddings_completed 4');
    expect(body).toContain('llm_relay_embeddings_failed 2');
    expect(body).toContain('llm_relay_embedding_callbacks_pending 3');
    // The two queues keep separate series.
    expect(body).toContain('llm_relay_prompts_queued 2');
  });
});

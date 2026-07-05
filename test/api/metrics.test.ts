vi.mock('../../src/prompt/repo', () => ({
  getPromptStatusCounts: vi.fn()
}));

import { metrics } from '../../src/hono/metrics';
import { incCounter, observeHistogram, resetMetrics } from '../../src/lib/metrics';
import { getPromptStatusCounts } from '../../src/prompt/repo';

describe('GET /metrics', () => {
  beforeEach(() => resetMetrics());

  it('returns Prometheus text format with queue counts', async () => {
    vi.mocked(getPromptStatusCounts).mockResolvedValue({
      queued: 2,
      pending: 1,
      completed: 10,
      failed: 3,
      callbackPending: 1
    });

    const response = await metrics.request('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');

    const body = await response.text();
    expect(body).toContain('llm_relay_prompts_queued 2');
    expect(body).toContain('llm_relay_prompts_pending 1');
    expect(body).toContain('llm_relay_prompts_completed_total 10');
    expect(body).toContain('llm_relay_prompts_failed_total 3');
    expect(body).toContain('llm_relay_callbacks_pending 1');
    expect(body).toContain('llm_relay_uptime_seconds');
    expect(body).toContain('# TYPE llm_relay_prompts_queued gauge');
    expect(body).toContain('# TYPE llm_relay_prompts_completed_total counter');
  });

  it('includes labeled counters and histograms recorded in the metrics registry', async () => {
    vi.mocked(getPromptStatusCounts).mockResolvedValue({
      queued: 0,
      pending: 0,
      completed: 0,
      failed: 0,
      callbackPending: 0
    });
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
});

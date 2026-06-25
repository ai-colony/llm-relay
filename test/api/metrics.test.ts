vi.mock('../../src/prompt/repo', () => ({
  getPromptStatusCounts: vi.fn()
}));

import { metrics } from '../../src/hono/metrics';
import { getPromptStatusCounts } from '../../src/prompt/repo';

describe('GET /metrics', () => {
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
});

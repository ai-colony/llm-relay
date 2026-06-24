vi.mock('../../src/prompt/repo', () => ({
  getPromptStatusCounts: vi.fn()
}));

import { status } from '../../src/hono/status';
import { getPromptStatusCounts } from '../../src/prompt/repo';

describe('GET /status', () => {
  it('returns queue and uptime metrics from the database', async () => {
    vi.mocked(getPromptStatusCounts).mockResolvedValue({
      queued: 2,
      pending: 1,
      completed: 10,
      failed: 0,
      callbackPending: 1
    });

    const response = await status.request('/');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.queued).toBe(2);
    expect(body.pending).toBe(1);
    expect(body.completed).toBe(10);
    expect(body.failed).toBe(0);
    expect(body.callbackPending).toBe(1);
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('uptime');
    expect(typeof body.uptime).toBe('number');
  });
});

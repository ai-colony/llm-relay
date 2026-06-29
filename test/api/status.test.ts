vi.mock('../../src/prompt/repo', () => ({
  getPromptStatusCounts: vi.fn()
}));

vi.mock('../../src/lib', () => ({
  getModelInfo: vi.fn()
}));

import { status } from '../../src/hono/status';
import { getModelInfo } from '../../src/lib';
import { getPromptStatusCounts } from '../../src/prompt/repo';

describe('GET /status', () => {
  beforeEach(() => {
    vi.mocked(getPromptStatusCounts).mockResolvedValue({
      queued: 2,
      pending: 1,
      completed: 10,
      failed: 0,
      callbackPending: 1
    });
  });

  it('returns queue metrics, uptime, model name and context size', async () => {
    vi.mocked(getModelInfo).mockResolvedValue({ model: 'test-model', contextSize: 32_768 });

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
    expect(body.model).toBe('test-model');
    expect(body.contextSize).toBe(32_768);
  });

  it('returns model and contextSize as undefined when upstream is unreachable', async () => {
    vi.mocked(getModelInfo).mockRejectedValue(new Error('connection refused'));

    const response = await status.request('/');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.model).toBeUndefined();
    expect(body.contextSize).toBeUndefined();
    expect(body.queued).toBe(2);
  });
});

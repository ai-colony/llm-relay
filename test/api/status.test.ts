vi.mock('../../src/prompt/repo', () => ({
  getPromptStatusCounts: vi.fn()
}));

vi.mock('@lib', () => ({
  getModelInfo: vi.fn()
}));

import { getModelInfo } from '@lib';

import { status } from '../../src/hono/status';
import { getPromptStatusCounts } from '../../src/prompt/repo';
import { makeStatusCounts } from '../helpers/mocks';

describe('GET /status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPromptStatusCounts).mockResolvedValue(
      makeStatusCounts({ queued: 2, inProgress: 1, completed: 10, callbackPending: 1 })
    );
  });

  it('returns queue metrics, uptime, model name and context size', async () => {
    vi.mocked(getModelInfo).mockResolvedValue({ model: 'test-model', contextSize: 32_768 });

    const response = await status.request('/');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.queued).toBe(2);
    expect(body.inProgress).toBe(1);
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

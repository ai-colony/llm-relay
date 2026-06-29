vi.mock('../../src/prompt/repo', () => ({
  findPromptByClientNameAndRequestId: vi.fn()
}));

import { get } from '../../src/hono/prompt/get';
import { findPromptByClientNameAndRequestId } from '../../src/prompt/repo';

const getRequest = (clientName: string, requestId: string) =>
  get.request(`/?clientName=${encodeURIComponent(clientName)}&requestId=${encodeURIComponent(requestId)}`);

describe('GET /prompt/get', () => {
  it('returns 404 when the prompt is not found', async () => {
    vi.mocked(findPromptByClientNameAndRequestId).mockResolvedValue([]);
    const response = await getRequest('test', 'req-1');
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it('returns the status for a queued prompt', async () => {
    vi.mocked(findPromptByClientNameAndRequestId).mockResolvedValue([{ status: 'queued' } as never]);
    const response = await getRequest('test', 'req-1');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('queued');
  });

  it('returns the status for an in_progress prompt', async () => {
    vi.mocked(findPromptByClientNameAndRequestId).mockResolvedValue([{ status: 'in_progress' } as never]);
    const response = await getRequest('test', 'req-1');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('in_progress');
  });

  it('returns the full result for a completed prompt', async () => {
    vi.mocked(findPromptByClientNameAndRequestId).mockResolvedValue([
      {
        status: 'completed',
        reasoning: 'deep thought',
        response: 'final answer',
        reasoningTimeMs: 100,
        reasoningTokenPerSecond: 10,
        responseTimeMs: 200,
        responseTokenPerSecond: 20
      } as never
    ]);
    const response = await getRequest('test', 'req-1');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('completed');
    expect(body.reasoning).toBe('deep thought');
    expect(body.response).toBe('final answer');
    expect(body.responseTimeMs).toBe(200);
  });

  it('returns the status and error for a failed prompt', async () => {
    vi.mocked(findPromptByClientNameAndRequestId).mockResolvedValue([
      { status: 'failed', statusError: 'upstream timeout' } as never
    ]);
    const response = await getRequest('test', 'req-1');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('failed');
    expect(body.statusError).toBe('upstream timeout');
  });

  it('returns 400 when query params are missing', async () => {
    const response = await get.request('/');
    expect(response.status).toBe(400);
  });

  it('returns 400 when clientName is empty', async () => {
    const response = await getRequest('', 'req-1');
    expect(response.status).toBe(400);
  });
});

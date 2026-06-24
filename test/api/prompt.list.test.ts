vi.mock('../../src/prompt/repo', () => ({
  findPromptsByClientName: vi.fn()
}));

import { list } from '../../src/hono/prompt/list';
import { findPromptsByClientName } from '../../src/prompt/repo';

const makeRow = (requestId: number, promptStatus: string) => ({
  requestId,
  status: promptStatus,
  createdAt: new Date(),
  completedAt: null
});

describe('GET /prompt/list', () => {
  it('returns all prompts for a client', async () => {
    vi.mocked(findPromptsByClientName).mockResolvedValue([makeRow(1, 'queued'), makeRow(2, 'completed')] as never);

    const response = await list.request('/?clientName=test-client');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(2);
    expect(vi.mocked(findPromptsByClientName)).toHaveBeenCalledWith('test-client', undefined);
  });

  it('filters by status when the query parameter is provided', async () => {
    vi.mocked(findPromptsByClientName).mockResolvedValue([makeRow(1, 'queued')] as never);

    const response = await list.request('/?clientName=test-client&status=queued');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(vi.mocked(findPromptsByClientName)).toHaveBeenCalledWith('test-client', 'queued');
  });

  it('returns 400 when clientName is missing', async () => {
    const response = await list.request('/');
    expect(response.status).toBe(400);
  });

  it('returns an empty array when the client has no prompts', async () => {
    vi.mocked(findPromptsByClientName).mockResolvedValue([]);

    const response = await list.request('/?clientName=nobody');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(0);
  });
});

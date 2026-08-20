vi.mock('../../src/embedding/repo', () => ({
  findEmbeddingsByClientName: vi.fn()
}));

import { findEmbeddingsByClientName } from '../../src/embedding/repo';
import { list } from '../../src/hono/embedding/list';
import { readJson, withQuery } from '../helpers/mocks';

const row = {
  priority: 0,
  requestId: 'req-1',
  status: 'completed' as const,
  inputCount: 2,
  dimensions: 2560,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  completedAt: new Date('2026-01-01T00:00:01Z')
};

describe('GET /embedding/list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findEmbeddingsByClientName).mockResolvedValue([row]);
  });

  it('returns the rows for a client', async () => {
    const response = await list.request(withQuery({ clientName: 'my-client' }));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body).toHaveLength(1);
    expect(body[0].requestId).toBe('req-1');
    expect(body[0].inputCount).toBe(2);
    expect(body[0].dimensions).toBe(2560);
  });

  it('never includes the vectors blob', async () => {
    const body = await readJson(await list.request(withQuery({ clientName: 'my-client' })));
    expect(body[0]).not.toHaveProperty('vectors');
  });

  it('passes the status filter through', async () => {
    await list.request(withQuery({ clientName: 'my-client', status: 'queued' }));
    expect(findEmbeddingsByClientName).toHaveBeenCalledWith('my-client', 'queued');
  });

  it('leaves the status undefined when not given', async () => {
    await list.request(withQuery({ clientName: 'my-client' }));
    expect(findEmbeddingsByClientName).toHaveBeenCalledWith('my-client', undefined);
  });

  it('returns 400 when clientName is missing', async () => {
    const response = await list.request(withQuery({}));
    expect(response.status).toBe(400);
  });

  it('returns 400 for an unknown status', async () => {
    const response = await list.request(withQuery({ clientName: 'my-client', status: 'cancelled' }));
    expect(response.status).toBe(400);
  });

  it('returns an empty array when the client has no jobs', async () => {
    vi.mocked(findEmbeddingsByClientName).mockResolvedValue([]);
    const body = await readJson(await list.request(withQuery({ clientName: 'nobody' })));
    expect(body).toEqual([]);
  });
});

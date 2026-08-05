vi.mock('../../src/embedding/repo', () => ({
  findEmbeddingStatusByKey: vi.fn(),
  deleteEmbeddingByKey: vi.fn(),
  CANCELLABLE_STATUSES: ['queued', 'failed', 'failed_retry']
}));

import { CANCELLABLE_STATUSES, deleteEmbeddingByKey, findEmbeddingStatusByKey } from '../../src/embedding/repo';
import { cancel } from '../../src/hono/embedding/cancel';
import { readJson, withQuery } from '../helpers/mocks';

const request = () => cancel.request(withQuery({ clientName: 'my-client', requestId: 'req-1' }), { method: 'DELETE' });

describe('DELETE /embedding/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deleteEmbeddingByKey).mockResolvedValue({ rowsAffected: 1 } as never);
  });

  it('returns 404 when the job does not exist', async () => {
    vi.mocked(findEmbeddingStatusByKey).mockResolvedValue(undefined);

    const response = await request();
    expect(response.status).toBe(404);
    expect(deleteEmbeddingByKey).not.toHaveBeenCalled();
  });

  it.each([['queued'], ['failed'], ['failed_retry']] as const)('deletes a %s job', async (status) => {
    vi.mocked(findEmbeddingStatusByKey).mockResolvedValue({ status });

    const response = await request();
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.success).toBe(true);
    expect(deleteEmbeddingByKey).toHaveBeenCalledWith('my-client', 'req-1', CANCELLABLE_STATUSES);
  });

  it.each([['in_progress'], ['completed']] as const)('returns 409 for a %s job', async (status) => {
    vi.mocked(findEmbeddingStatusByKey).mockResolvedValue({ status });

    const response = await request();
    expect(response.status).toBe(409);
    const body = await readJson(response);
    expect(body.success).toBe(false);
    expect(body.error).toContain(status);
    expect(deleteEmbeddingByKey).not.toHaveBeenCalled();
  });

  it('returns 400 when requestId is missing', async () => {
    const response = await cancel.request(withQuery({ clientName: 'my-client' }), { method: 'DELETE' });
    expect(response.status).toBe(400);
  });
});

vi.mock('../../src/prompt/repo', () => ({
  findPromptStatusByKey: vi.fn(),
  deletePromptByKey: vi.fn(),
  CANCELLABLE_STATUSES: ['queued', 'failed', 'failed_retry']
}));

import { cancel } from '../../src/hono/prompt/cancel';
import { CANCELLABLE_STATUSES, deletePromptByKey, findPromptStatusByKey } from '../../src/prompt/repo';
import { withQuery } from '../helpers/mocks';

const deleteRequest = (clientName: string, requestId: string) =>
  cancel.request(withQuery({ clientName, requestId }), { method: 'DELETE' });

describe('DELETE /prompt/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when the prompt does not exist', async () => {
    vi.mocked(findPromptStatusByKey).mockResolvedValue(undefined);
    const response = await deleteRequest('test', 'req-1');
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it('returns 409 when the prompt is in_progress', async () => {
    vi.mocked(findPromptStatusByKey).mockResolvedValue({ status: 'in_progress' } as never);
    const response = await deleteRequest('test', 'req-1');
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it('returns 409 when the prompt is already completed', async () => {
    vi.mocked(findPromptStatusByKey).mockResolvedValue({ status: 'completed' } as never);
    const response = await deleteRequest('test', 'req-1');
    expect(response.status).toBe(409);
  });

  it('cancels a queued prompt and returns success', async () => {
    vi.mocked(findPromptStatusByKey).mockResolvedValue({
      status: 'queued',
      clientName: 'test',
      requestId: 'req-1'
    } as never);
    vi.mocked(deletePromptByKey).mockResolvedValue({} as never);

    const response = await deleteRequest('test', 'req-1');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(deletePromptByKey).toHaveBeenCalledWith('test', 'req-1', CANCELLABLE_STATUSES);
  });

  it('cancels a failed prompt and returns success', async () => {
    vi.mocked(findPromptStatusByKey).mockResolvedValue({
      status: 'failed',
      clientName: 'test',
      requestId: 'req-2'
    } as never);
    vi.mocked(deletePromptByKey).mockResolvedValue({} as never);

    const response = await deleteRequest('test', 'req-2');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it('returns 400 when query params are missing', async () => {
    const response = await cancel.request('/', { method: 'DELETE' });
    expect(response.status).toBe(400);
  });

  it('returns 400 when clientName is empty', async () => {
    const response = await deleteRequest('', 'req-1');
    expect(response.status).toBe(400);
  });
});

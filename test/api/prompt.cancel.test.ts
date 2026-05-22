vi.mock('../../src/prompt/repository', () => ({
  findPromptByClientNameAndRequestId: vi.fn(),
  deletePromptByClientNameAndRequestId: vi.fn()
}));

import { cancel } from '../../src/hono/prompt/cancel';
import { deletePromptByClientNameAndRequestId, findPromptByClientNameAndRequestId } from '../../src/prompt/repository';

const deleteRequest = (clientName: string, requestId: number) =>
  cancel.request(`/?clientName=${encodeURIComponent(clientName)}&requestId=${requestId}`, { method: 'DELETE' });

describe('DELETE /prompt/cancel', () => {
  it('returns 404 when the prompt does not exist', async () => {
    vi.mocked(findPromptByClientNameAndRequestId).mockResolvedValue([]);
    const response = await deleteRequest('test', 1);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it('returns 409 when the prompt is in_progress', async () => {
    vi.mocked(findPromptByClientNameAndRequestId).mockResolvedValue([{ status: 'in_progress' } as never]);
    const response = await deleteRequest('test', 1);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it('returns 409 when the prompt is already completed', async () => {
    vi.mocked(findPromptByClientNameAndRequestId).mockResolvedValue([{ status: 'completed' } as never]);
    const response = await deleteRequest('test', 1);
    expect(response.status).toBe(409);
  });

  it('cancels a queued prompt and returns success', async () => {
    vi.mocked(findPromptByClientNameAndRequestId).mockResolvedValue([
      { status: 'queued', clientName: 'test', requestId: 1 } as never
    ]);
    vi.mocked(deletePromptByClientNameAndRequestId).mockResolvedValue({} as never);

    const response = await deleteRequest('test', 1);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(deletePromptByClientNameAndRequestId).toHaveBeenCalledWith('test', 1);
  });

  it('cancels a failed prompt and returns success', async () => {
    vi.mocked(findPromptByClientNameAndRequestId).mockResolvedValue([
      { status: 'failed', clientName: 'test', requestId: 2 } as never
    ]);
    vi.mocked(deletePromptByClientNameAndRequestId).mockResolvedValue({} as never);

    const response = await deleteRequest('test', 2);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it('returns 400 when query params are missing', async () => {
    const response = await cancel.request('/', { method: 'DELETE' });
    expect(response.status).toBe(400);
  });
});

vi.mock('../../src/prompt/repo', () => ({
  purgeCompletedPrompts: vi.fn()
}));

import { purge } from '../../src/hono/prompt/purge';
import { purgeCompletedPrompts } from '../../src/prompt/repo';
import { readJson, withQuery } from '../helpers/mocks';

const deleteRequest = (parameters: Record<string, string | number>) =>
  purge.request(withQuery(parameters), { method: 'DELETE' });

describe('DELETE /prompt/purge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('purges records and returns the deleted count', async () => {
    vi.mocked(purgeCompletedPrompts).mockResolvedValue(42);
    const response = await deleteRequest({ clientName: 'test', days: 7 });
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body).toEqual({ success: true, deleted: 42 });
    expect(purgeCompletedPrompts).toHaveBeenCalledWith({ clientName: 'test', olderThanDays: 7 });
  });

  it('defaults days to 7 when omitted', async () => {
    vi.mocked(purgeCompletedPrompts).mockResolvedValue(0);
    const response = await purge.request('/', { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(purgeCompletedPrompts).toHaveBeenCalledWith({ clientName: undefined, olderThanDays: 7 });
  });

  it('works without clientName (purges all clients)', async () => {
    vi.mocked(purgeCompletedPrompts).mockResolvedValue(100);
    const response = await deleteRequest({ days: 30 });
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body).toEqual({ success: true, deleted: 100 });
    expect(purgeCompletedPrompts).toHaveBeenCalledWith({ clientName: undefined, olderThanDays: 30 });
  });

  it('returns 400 when days is 0', async () => {
    const response = await deleteRequest({ days: 0 });
    expect(response.status).toBe(400);
  });

  it('returns 400 when days is negative', async () => {
    const response = await deleteRequest({ days: -1 });
    expect(response.status).toBe(400);
  });

  it('returns 400 when days is not a number', async () => {
    const response = await purge.request('/?days=abc', { method: 'DELETE' });
    expect(response.status).toBe(400);
  });
});

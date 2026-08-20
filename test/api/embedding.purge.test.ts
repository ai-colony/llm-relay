vi.mock('../../src/embedding/repo', () => ({
  purgeCompletedEmbeddings: vi.fn()
}));

import { purgeCompletedEmbeddings } from '../../src/embedding/repo';
import { purge } from '../../src/hono/embedding/purge';
import { readJson, withQuery } from '../helpers/mocks';

const request = (parameters: Record<string, string | number | undefined> = {}) =>
  purge.request(withQuery(parameters), { method: 'DELETE' });

describe('DELETE /embedding/purge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(purgeCompletedEmbeddings).mockResolvedValue(3);
  });

  it('returns the number of deleted records', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.success).toBe(true);
    expect(body.deleted).toBe(3);
  });

  it('defaults to a 7-day window', async () => {
    await request();
    expect(purgeCompletedEmbeddings).toHaveBeenCalledWith({ clientName: undefined, olderThanDays: 7 });
  });

  it('coerces the days query parameter to a number', async () => {
    await request({ days: 30 });
    expect(purgeCompletedEmbeddings).toHaveBeenCalledWith({ clientName: undefined, olderThanDays: 30 });
  });

  it('scopes the purge to one client when given', async () => {
    await request({ clientName: 'my-client', days: 1 });
    expect(purgeCompletedEmbeddings).toHaveBeenCalledWith({ clientName: 'my-client', olderThanDays: 1 });
  });

  it('returns 400 for days below 1', async () => {
    const response = await request({ days: 0 });
    expect(response.status).toBe(400);
  });

  it('returns 400 for a non-numeric days value', async () => {
    const response = await request({ days: 'lots' });
    expect(response.status).toBe(400);
  });
});

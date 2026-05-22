vi.mock('@db', () => ({
  checkDatabase: vi.fn()
}));

vi.mock('@lib', () => ({
  checkOpenAI: vi.fn()
}));

import { checkDatabase } from '@db';
import { checkOpenAI } from '@lib';

import { health } from '../../src/hono/health';

describe('GET /health', () => {
  it('returns 200 with success true when all checks pass', async () => {
    vi.mocked(checkDatabase).mockReturnValue({ ok: true });
    vi.mocked(checkOpenAI).mockResolvedValue({ ok: true });

    const response = await health.request('/');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.checks.db.ok).toBe(true);
    expect(body.checks.openai.ok).toBe(true);
  });

  it('returns 503 with success false when the database check fails', async () => {
    vi.mocked(checkDatabase).mockReturnValue({ ok: false, error: 'cannot open database' });
    vi.mocked(checkOpenAI).mockResolvedValue({ ok: true });

    const response = await health.request('/');
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.checks.db.ok).toBe(false);
    expect(body.checks.db.error).toBe('cannot open database');
  });

  it('returns 503 with success false when the openai check fails', async () => {
    vi.mocked(checkDatabase).mockReturnValue({ ok: true });
    vi.mocked(checkOpenAI).mockResolvedValue({ ok: false, error: 'HTTP 503' });

    const response = await health.request('/');
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.checks.openai.ok).toBe(false);
  });
});

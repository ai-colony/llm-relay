vi.mock('@db', () => ({
  checkDatabase: vi.fn()
}));

vi.mock('@lib', () => ({
  checkGenerative: vi.fn(),
  checkEmbedding: vi.fn(),
  config: { embedding: undefined }
}));

import { checkDatabase } from '@db';
import { checkEmbedding, checkGenerative, config } from '@lib';

import { health } from '../../src/hono/health';
import { readJson } from '../helpers/mocks';

const enableEmbedding = () => {
  vi.mocked(config).embedding = { url: 'http://localhost:8081/v1', model: '', key: 'none' };
};

describe('GET /health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(config).embedding = undefined;
  });

  it('returns 200 with success true when all checks pass', async () => {
    vi.mocked(checkDatabase).mockReturnValue({ ok: true });
    vi.mocked(checkGenerative).mockResolvedValue({ ok: true });

    const response = await health.request('/');
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.success).toBe(true);
    expect(body.checks.db.ok).toBe(true);
    expect(body.checks.generative.ok).toBe(true);
  });

  it('returns 503 with success false when the database check fails', async () => {
    vi.mocked(checkDatabase).mockReturnValue({ ok: false, error: 'cannot open database' });
    vi.mocked(checkGenerative).mockResolvedValue({ ok: true });

    const response = await health.request('/');
    expect(response.status).toBe(503);
    const body = await readJson(response);
    expect(body.success).toBe(false);
    expect(body.checks.db.ok).toBe(false);
    expect(body.checks.db.error).toBe('cannot open database');
  });

  it('returns 503 with success false when the generative check fails', async () => {
    vi.mocked(checkDatabase).mockReturnValue({ ok: true });
    vi.mocked(checkGenerative).mockResolvedValue({ ok: false, error: 'HTTP 503' });

    const response = await health.request('/');
    expect(response.status).toBe(503);
    const body = await readJson(response);
    expect(body.success).toBe(false);
    expect(body.checks.generative.ok).toBe(false);
  });

  describe('with no embedding backend configured', () => {
    it('omits the embedding check entirely and never probes it', async () => {
      vi.mocked(checkDatabase).mockReturnValue({ ok: true });
      vi.mocked(checkGenerative).mockResolvedValue({ ok: true });

      const response = await health.request('/');
      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.checks).not.toHaveProperty('embedding');
      expect(checkEmbedding).not.toHaveBeenCalled();
    });
  });

  describe('with an embedding backend configured', () => {
    it('includes the embedding check when it passes', async () => {
      enableEmbedding();
      vi.mocked(checkDatabase).mockReturnValue({ ok: true });
      vi.mocked(checkGenerative).mockResolvedValue({ ok: true });
      vi.mocked(checkEmbedding).mockResolvedValue({ ok: true });

      const response = await health.request('/');
      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.success).toBe(true);
      expect(body.checks.embedding.ok).toBe(true);
    });

    it('returns 503 when only the embedding backend is down', async () => {
      enableEmbedding();
      vi.mocked(checkDatabase).mockReturnValue({ ok: true });
      vi.mocked(checkGenerative).mockResolvedValue({ ok: true });
      vi.mocked(checkEmbedding).mockResolvedValue({ ok: false, error: 'HTTP 503' });

      const response = await health.request('/');
      expect(response.status).toBe(503);
      const body = await readJson(response);
      expect(body.success).toBe(false);
      expect(body.checks.generative.ok).toBe(true);
      expect(body.checks.embedding.ok).toBe(false);
      expect(body.checks.embedding.error).toBe('HTTP 503');
    });
  });
});

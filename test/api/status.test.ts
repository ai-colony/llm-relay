vi.mock('../../src/prompt/repo', () => ({
  getPromptStatusCounts: vi.fn()
}));

vi.mock('../../src/embedding/repo', () => ({
  getEmbeddingStatusCounts: vi.fn()
}));

vi.mock('@lib', () => ({
  getGenerativeModelInfo: vi.fn(),
  getEmbeddingModelInfo: vi.fn(),
  config: { embedding: undefined }
}));

import { config, getEmbeddingModelInfo, getGenerativeModelInfo } from '@lib';

import { getEmbeddingStatusCounts } from '../../src/embedding/repo';
import { status } from '../../src/hono/status';
import { getPromptStatusCounts } from '../../src/prompt/repo';
import { makeStatusCounts, readJson } from '../helpers/mocks';

const enableEmbedding = () => {
  vi.mocked(config).embedding = { url: 'http://localhost:8081/v1', model: '', key: 'none' };
};

describe('GET /status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(config).embedding = undefined;
    vi.mocked(getPromptStatusCounts).mockResolvedValue(
      makeStatusCounts({ queued: 2, inProgress: 1, completed: 10, callbackPending: 1 })
    );
  });

  it('returns queue metrics, uptime, model name and context size', async () => {
    vi.mocked(getGenerativeModelInfo).mockResolvedValue({ model: 'test-model', contextSize: 32_768 });

    const response = await status.request('/');
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.queued).toBe(2);
    expect(body.inProgress).toBe(1);
    expect(body.completed).toBe(10);
    expect(body.failed).toBe(0);
    expect(body.callbackPending).toBe(1);
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('uptime');
    expect(typeof body.uptime).toBe('number');
    expect(body.model).toBe('test-model');
    expect(body.contextSize).toBe(32_768);
  });

  it('returns model and contextSize as undefined when upstream is unreachable', async () => {
    vi.mocked(getGenerativeModelInfo).mockRejectedValue(new Error('connection refused'));

    const response = await status.request('/');
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.model).toBeUndefined();
    expect(body.contextSize).toBeUndefined();
    expect(body.queued).toBe(2);
  });

  describe('with no embedding backend configured', () => {
    it('omits the embedding block and never queries its counts', async () => {
      vi.mocked(getGenerativeModelInfo).mockResolvedValue({ model: 'test-model', contextSize: 32_768 });

      const response = await status.request('/');
      const body = await readJson(response);
      expect(body).not.toHaveProperty('embedding');
      expect(getEmbeddingStatusCounts).not.toHaveBeenCalled();
    });
  });

  describe('with an embedding backend configured', () => {
    it('reports the embedding model and its own queue counts', async () => {
      enableEmbedding();
      vi.mocked(getGenerativeModelInfo).mockResolvedValue({ model: 'test-model', contextSize: 32_768 });
      vi.mocked(getEmbeddingModelInfo).mockResolvedValue({ model: 'test-embed', contextSize: 8192 });
      vi.mocked(getEmbeddingStatusCounts).mockResolvedValue(makeStatusCounts({ queued: 5, completed: 3 }));

      const response = await status.request('/');
      const body = await readJson(response);
      expect(body.embedding.model).toBe('test-embed');
      expect(body.embedding.contextSize).toBe(8192);
      expect(body.embedding.queued).toBe(5);
      expect(body.embedding.completed).toBe(3);
      // The prompt counts stay in their own namespace.
      expect(body.queued).toBe(2);
    });

    it('still returns 200 with counts when the embedding upstream is unreachable', async () => {
      enableEmbedding();
      vi.mocked(getGenerativeModelInfo).mockResolvedValue({ model: 'test-model', contextSize: 32_768 });
      vi.mocked(getEmbeddingModelInfo).mockRejectedValue(new Error('connection refused'));
      vi.mocked(getEmbeddingStatusCounts).mockResolvedValue(makeStatusCounts({ queued: 5 }));

      const response = await status.request('/');
      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.embedding.model).toBeUndefined();
      expect(body.embedding.queued).toBe(5);
    });
  });
});

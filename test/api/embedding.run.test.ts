vi.mock('@lib', async () => {
  const vectors = await import('../../src/lib/vectors');
  const { makeLoggerMock } = await import('../helpers/mocks');
  return {
    ...vectors,
    executeEmbedding: vi.fn(),
    recordUpstreamMetrics: vi.fn(),
    logger: makeLoggerMock(),
    isCallbackUrlAllowed: vi.fn().mockReturnValue(true)
  };
});

import { executeEmbedding, packVectors, recordUpstreamMetrics } from '@lib';

import { run } from '../../src/hono/embedding/run';
import { postJson as post, readJson } from '../helpers/mocks';

const postJson = (body: unknown) => post(run, body);

const result = { vectors: packVectors([[0.5, 0.25, -1]]), model: 'embed-model', dimensions: 3 };

describe('POST /embedding/run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeEmbedding).mockResolvedValue(result);
  });

  it('returns the vectors as number arrays by default', async () => {
    const response = await postJson({ input: 'hello' });
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.success).toBe(true);
    expect(body.model).toBe('embed-model');
    expect(body.dimensions).toBe(3);
    expect(body.encodingFormat).toBe('float');
    expect(body.embedding).toEqual([[0.5, 0.25, -1]]);
  });

  it('returns one base64 string per vector when asked', async () => {
    const response = await postJson({ input: 'hello', encodingFormat: 'base64' });
    const body = await readJson(response);
    expect(body.encodingFormat).toBe('base64');
    expect(body.embedding).toHaveLength(1);
    expect(typeof body.embedding[0]).toBe('string');
  });

  it('wraps a single string input into an array before calling upstream', async () => {
    await postJson({ input: 'hello' });
    expect(executeEmbedding).toHaveBeenCalledWith(['hello']);
  });

  it('passes a batch through unchanged', async () => {
    vi.mocked(executeEmbedding).mockResolvedValue({
      vectors: packVectors([
        [1, 2, 3],
        [4, 5, 6]
      ]),
      model: 'embed-model',
      dimensions: 3
    });

    const response = await postJson({ input: ['one', 'two'] });
    const body = await readJson(response);
    expect(executeEmbedding).toHaveBeenCalledWith(['one', 'two']);
    expect(body.embedding).toEqual([
      [1, 2, 3],
      [4, 5, 6]
    ]);
  });

  it('returns 400 for a missing input', async () => {
    const response = await postJson({});
    expect(response.status).toBe(400);
  });

  it('returns 400 for an unknown encodingFormat', async () => {
    const response = await postJson({ input: 'hi', encodingFormat: 'float64' });
    expect(response.status).toBe(400);
  });

  it('returns 502 with the upstream message when the backend rejects the request', async () => {
    const message = 'input is too large to process. increase the physical batch size';
    vi.mocked(executeEmbedding).mockRejectedValue(new Error(message));

    const response = await postJson({ input: 'a very long text' });
    expect(response.status).toBe(502);
    const body = await readJson(response);
    expect(body.success).toBe(false);
    expect(body.error).toBe(message);
  });

  it('records success and failure against the metrics registry', async () => {
    await postJson({ input: 'hello' });
    expect(recordUpstreamMetrics).toHaveBeenCalledWith(expect.anything(), 'success', expect.any(Number));

    vi.mocked(executeEmbedding).mockRejectedValue(new Error('boom'));
    await postJson({ input: 'hello' });
    expect(recordUpstreamMetrics).toHaveBeenCalledWith(expect.anything(), 'failure', expect.any(Number));
  });
});

vi.mock('../../src/embedding/repo', () => ({
  addEmbedding: vi.fn(),
  countQueuedEmbeddings: vi.fn(),
  findEmbeddingStatusByKey: vi.fn(),
  deleteEmbeddingByKey: vi.fn(),
  OVERWRITABLE_STATUSES: ['queued', 'completed', 'failed', 'failed_retry']
}));

vi.mock('../../src/lib/callbackUrl', () => ({
  isCallbackUrlAllowed: vi.fn().mockReturnValue(true),
  checkCallbackAvailability: vi.fn().mockResolvedValue(true)
}));

import {
  addEmbedding,
  countQueuedEmbeddings,
  deleteEmbeddingByKey,
  findEmbeddingStatusByKey
} from '../../src/embedding/repo';
import { add } from '../../src/hono/embedding/add';
import { checkCallbackAvailability, isCallbackUrlAllowed } from '../../src/lib/callbackUrl';
import { postJson as post, readJson } from '../helpers/mocks';

const validBody = { clientName: 'my-client', requestId: 'req-1', input: 'hello' };

// Drizzle wraps driver failures, so the node:sqlite error carrying code/errcode sits on `cause`.
const makeUniqueConstraintError = () =>
  new Error('Failed query: insert into "embeddings"', {
    cause: Object.assign(new Error('UNIQUE constraint failed: embeddings.clientName, embeddings.requestId'), {
      code: 'ERR_SQLITE_ERROR',
      errcode: 2067
    })
  });

const postJson = (body: unknown) => post(add, body);

describe('POST /embedding/add', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(countQueuedEmbeddings).mockResolvedValue(1);
    vi.mocked(findEmbeddingStatusByKey).mockResolvedValue(undefined);
    vi.mocked(deleteEmbeddingByKey).mockResolvedValue({ rowsAffected: 1 } as never);
    vi.mocked(addEmbedding).mockResolvedValue(1);
    vi.mocked(isCallbackUrlAllowed).mockReturnValue(true);
    vi.mocked(checkCallbackAvailability).mockResolvedValue(true);
  });

  it('returns 201 with the queue count on valid input', async () => {
    const response = await postJson(validBody);
    expect(response.status).toBe(201);
    const body = await readJson(response);
    expect(body.success).toBe(true);
    expect(body.queued).toBe(1);
  });

  describe('input normalisation', () => {
    it('wraps a single string input into a one-element array', async () => {
      await postJson(validBody);
      expect(addEmbedding).toHaveBeenCalledWith(expect.objectContaining({ input: ['hello'] }));
    });

    it('passes an array input through unchanged', async () => {
      await postJson({ ...validBody, input: ['one', 'two'] });
      expect(addEmbedding).toHaveBeenCalledWith(expect.objectContaining({ input: ['one', 'two'] }));
    });

    it('defaults encodingFormat to float', async () => {
      await postJson(validBody);
      expect(addEmbedding).toHaveBeenCalledWith(expect.objectContaining({ encodingFormat: 'float' }));
    });

    it('accepts an explicit base64 encodingFormat', async () => {
      await postJson({ ...validBody, encodingFormat: 'base64' });
      expect(addEmbedding).toHaveBeenCalledWith(expect.objectContaining({ encodingFormat: 'base64' }));
    });
  });

  describe('validation', () => {
    it('returns 400 when input is missing', async () => {
      const response = await postJson({ clientName: 'c', requestId: 'r' });
      expect(response.status).toBe(400);
    });

    it('returns 400 for an empty string input', async () => {
      const response = await postJson({ ...validBody, input: '' });
      expect(response.status).toBe(400);
    });

    it('returns 400 for an empty array input', async () => {
      const response = await postJson({ ...validBody, input: [] });
      expect(response.status).toBe(400);
    });

    it('returns 400 when an array entry is empty', async () => {
      const response = await postJson({ ...validBody, input: ['ok', ''] });
      expect(response.status).toBe(400);
    });

    it('returns 400 for an unknown encodingFormat', async () => {
      const response = await postJson({ ...validBody, encodingFormat: 'float64' });
      expect(response.status).toBe(400);
    });

    it('returns 400 for an empty clientName', async () => {
      const response = await postJson({ ...validBody, clientName: '' });
      expect(response.status).toBe(400);
    });

    it('returns 400 for a negative priority', async () => {
      const response = await postJson({ ...validBody, priority: -1 });
      expect(response.status).toBe(400);
    });
  });

  describe('duplicates and overwrite', () => {
    it('returns 409 when the (clientName, requestId) pair already exists', async () => {
      vi.mocked(addEmbedding).mockRejectedValue(makeUniqueConstraintError());

      const response = await postJson(validBody);
      expect(response.status).toBe(409);
      const body = await readJson(response);
      expect(body.success).toBe(false);
    });

    it('deletes the existing record before inserting when overwrite is set', async () => {
      vi.mocked(findEmbeddingStatusByKey).mockResolvedValue({ status: 'completed' });

      const response = await postJson({ ...validBody, overwrite: true });
      expect(response.status).toBe(201);
      expect(deleteEmbeddingByKey).toHaveBeenCalledWith('my-client', 'req-1', expect.any(Array));
    });

    it('returns 409 when overwriting an in-progress job', async () => {
      vi.mocked(findEmbeddingStatusByKey).mockResolvedValue({ status: 'in_progress' });

      const response = await postJson({ ...validBody, overwrite: true });
      expect(response.status).toBe(409);
      expect(deleteEmbeddingByKey).not.toHaveBeenCalled();
    });

    it('skips the callback probe when the request is already destined for a 409', async () => {
      vi.mocked(findEmbeddingStatusByKey).mockResolvedValue({ status: 'in_progress' });

      await postJson({ ...validBody, overwrite: true, callbackUrl: 'https://example.com/cb' });

      expect(checkCallbackAvailability).not.toHaveBeenCalled();
    });
  });

  describe('callbackUrl', () => {
    it('returns 400 when the URL is not in the allowlist', async () => {
      vi.mocked(isCallbackUrlAllowed).mockReturnValue(false);

      const response = await postJson({ ...validBody, callbackUrl: 'https://blocked.example.com/cb' });
      expect(response.status).toBe(400);
    });

    it('returns 503 when the URL fails the reachability probe', async () => {
      vi.mocked(checkCallbackAvailability).mockResolvedValue(false);

      const response = await postJson({ ...validBody, callbackUrl: 'https://example.com/cb' });
      expect(response.status).toBe(503);
    });

    it('does not probe when no callbackUrl is given', async () => {
      await postJson(validBody);
      expect(checkCallbackAvailability).not.toHaveBeenCalled();
    });
  });

  it('propagates a non-constraint error as a 500 rather than swallowing it as a 409', async () => {
    vi.mocked(addEmbedding).mockRejectedValue(new Error('disk I/O error'));
    const response = await postJson(validBody);
    expect(response.status).toBe(500);
  });
});

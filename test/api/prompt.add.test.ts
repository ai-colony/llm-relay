vi.mock('../../src/prompt/repo', () => ({
  addPrompt: vi.fn(),
  countQueuedPrompts: vi.fn(),
  findPromptStatusByKey: vi.fn(),
  deletePromptByKey: vi.fn(),
  OVERWRITABLE_STATUSES: ['queued', 'completed', 'failed', 'failed_retry']
}));

vi.mock('../../src/lib/callbackUrl', () => ({
  isCallbackUrlAllowed: vi.fn().mockReturnValue(true),
  checkCallbackAvailability: vi.fn().mockResolvedValue(true)
}));

import { add } from '../../src/hono/prompt/add';
import { checkCallbackAvailability, isCallbackUrlAllowed } from '../../src/lib/callbackUrl';
import {
  addPrompt,
  countQueuedPrompts,
  deletePromptByKey,
  findPromptStatusByKey,
  OVERWRITABLE_STATUSES
} from '../../src/prompt/repo';
import { postJson as post } from '../helpers/mocks';

const validBody = { clientName: 'my-client', requestId: 'req-1', userPrompt: 'hello', temperature: 0.7 };

// Drizzle wraps driver failures, so the node:sqlite error carrying code/errcode sits on `cause` —
// the flat shape a naive mock would use never actually occurs at runtime.
const makeUniqueConstraintError = () =>
  new Error('Failed query: insert into "prompts"', {
    cause: Object.assign(new Error('UNIQUE constraint failed: prompts.clientName, prompts.requestId'), {
      code: 'ERR_SQLITE_ERROR',
      errcode: 2067
    })
  });

const postJson = (body: unknown) => post(add, body);

describe('POST /prompt/add', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(countQueuedPrompts).mockResolvedValue(1);
    vi.mocked(findPromptStatusByKey).mockResolvedValue(undefined);
    vi.mocked(deletePromptByKey).mockResolvedValue({ rowsAffected: 1 } as never);
    vi.mocked(isCallbackUrlAllowed).mockReturnValue(true);
    vi.mocked(checkCallbackAvailability).mockResolvedValue(true);
  });

  it('returns 201 with success true and queue count on valid input', async () => {
    vi.mocked(addPrompt).mockResolvedValue(1);
    const response = await postJson(validBody);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.queued).toBe(1);
  });

  it('returns 400 when required fields are missing', async () => {
    const response = await postJson({ clientName: 'test' });
    expect(response.status).toBe(400);
  });

  it('returns 400 when requestId is a number', async () => {
    const response = await postJson({ ...validBody, requestId: 42 });
    expect(response.status).toBe(400);
  });

  it('returns 400 when requestId is an empty string', async () => {
    const response = await postJson({ ...validBody, requestId: '' });
    expect(response.status).toBe(400);
  });

  it('returns 400 when temperature is out of range', async () => {
    const response = await postJson({ ...validBody, temperature: 3 });
    expect(response.status).toBe(400);
  });

  it('returns 400 when clientName is empty', async () => {
    const response = await postJson({ ...validBody, clientName: '' });
    expect(response.status).toBe(400);
  });

  it('returns 409 on duplicate clientName + requestId', async () => {
    vi.mocked(addPrompt).mockRejectedValue(makeUniqueConstraintError());
    const response = await postJson(validBody);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it('propagates a non-constraint error as a 500', async () => {
    vi.mocked(addPrompt).mockRejectedValue(new Error('database is locked'));
    const response = await postJson(validBody);
    expect(response.status).toBe(500);
  });

  it('accepts an optional priority field', async () => {
    vi.mocked(addPrompt).mockResolvedValue(1);
    const response = await postJson({ ...validBody, priority: 3 });
    expect(response.status).toBe(201);
  });

  it('returns 400 when priority is negative', async () => {
    const response = await postJson({ ...validBody, priority: -1 });
    expect(response.status).toBe(400);
  });

  it('accepts an optional callbackUrl and systemPrompt', async () => {
    vi.mocked(addPrompt).mockResolvedValue(1);
    const response = await postJson({
      ...validBody,
      callbackUrl: 'https://example.com/callback',
      systemPrompt: 'be concise'
    });
    expect(response.status).toBe(201);
  });

  describe('overwrite=true', () => {
    it('deletes existing queued prompt and returns 201', async () => {
      vi.mocked(findPromptStatusByKey).mockResolvedValue({ status: 'queued' });
      vi.mocked(addPrompt).mockResolvedValue(1);
      const response = await postJson({ ...validBody, overwrite: true });
      expect(response.status).toBe(201);
      expect(vi.mocked(deletePromptByKey)).toHaveBeenCalledWith(
        validBody.clientName,
        validBody.requestId,
        OVERWRITABLE_STATUSES
      );
    });

    it('deletes existing completed prompt and returns 201', async () => {
      vi.mocked(findPromptStatusByKey).mockResolvedValue({ status: 'completed' });
      vi.mocked(addPrompt).mockResolvedValue(1);
      const response = await postJson({ ...validBody, overwrite: true });
      expect(response.status).toBe(201);
      expect(vi.mocked(deletePromptByKey)).toHaveBeenCalledWith(
        validBody.clientName,
        validBody.requestId,
        OVERWRITABLE_STATUSES
      );
    });

    it('returns 409 when existing prompt is in_progress', async () => {
      vi.mocked(findPromptStatusByKey).mockResolvedValue({ status: 'in_progress' });
      const response = await postJson({ ...validBody, overwrite: true });
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(vi.mocked(deletePromptByKey)).not.toHaveBeenCalled();
    });

    it('skips the callback probe when the overwrite attempt is rejected with a 409', async () => {
      vi.mocked(findPromptStatusByKey).mockResolvedValue({ status: 'in_progress' });
      const response = await postJson({
        ...validBody,
        overwrite: true,
        callbackUrl: 'https://example.com/callback'
      });
      expect(response.status).toBe(409);
      expect(vi.mocked(checkCallbackAvailability)).not.toHaveBeenCalled();
    });

    it('inserts normally when no existing prompt found', async () => {
      vi.mocked(findPromptStatusByKey).mockResolvedValue(undefined);
      vi.mocked(addPrompt).mockResolvedValue(1);
      const response = await postJson({ ...validBody, overwrite: true });
      expect(response.status).toBe(201);
      expect(vi.mocked(deletePromptByKey)).not.toHaveBeenCalled();
    });

    it('overwrite=false still returns 409 on UNIQUE conflict', async () => {
      vi.mocked(addPrompt).mockRejectedValue(makeUniqueConstraintError());
      const response = await postJson({ ...validBody, overwrite: false });
      expect(response.status).toBe(409);
    });
  });

  describe('callbackUrl availability check', () => {
    beforeEach(() => {
      vi.mocked(addPrompt).mockResolvedValue(1);
    });

    it('returns 201 when callbackUrl is available', async () => {
      vi.mocked(checkCallbackAvailability).mockResolvedValue(true);
      const response = await postJson({ ...validBody, callbackUrl: 'https://example.com/callback' });
      expect(response.status).toBe(201);
    });

    it('returns 503 when callbackUrl is not available', async () => {
      vi.mocked(checkCallbackAvailability).mockResolvedValue(false);
      const response = await postJson({ ...validBody, callbackUrl: 'https://example.com/callback' });
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('callbackUrl is not available');
    });

    it('skips availability check when no callbackUrl provided', async () => {
      const response = await postJson(validBody);
      expect(response.status).toBe(201);
      expect(vi.mocked(checkCallbackAvailability)).not.toHaveBeenCalled();
    });
  });

  describe('callbackUrl allowlist', () => {
    beforeEach(() => {
      vi.mocked(addPrompt).mockResolvedValue(1);
    });

    it('accepts any valid URL when allowlist allows it', async () => {
      vi.mocked(isCallbackUrlAllowed).mockReturnValue(true);
      const response = await postJson({ ...validBody, callbackUrl: 'http://localhost/hook' });
      expect(response.status).toBe(201);
    });

    it('accepts a URL when allowlist returns true', async () => {
      vi.mocked(isCallbackUrlAllowed).mockReturnValue(true);
      const response = await postJson({ ...validBody, callbackUrl: 'https://example.com/callback' });
      expect(response.status).toBe(201);
    });

    it('rejects a URL when allowlist returns false', async () => {
      vi.mocked(isCallbackUrlAllowed).mockReturnValue(false);
      const response = await postJson({ ...validBody, callbackUrl: 'https://other.com/hook' });
      expect(response.status).toBe(400);
    });

    it('rejects a URL when allowlist excludes it', async () => {
      vi.mocked(isCallbackUrlAllowed).mockReturnValue(false);
      const response = await postJson({ ...validBody, callbackUrl: 'http://localhost/hook' });
      expect(response.status).toBe(400);
    });
  });
});

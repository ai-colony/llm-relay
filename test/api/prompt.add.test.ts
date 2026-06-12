vi.mock('../../src/prompt/service', () => ({
  createPrompt: vi.fn()
}));

vi.mock('../../src/prompt/repository', () => ({
  countQueuedPrompts: vi.fn(),
  findPromptByClientNameAndRequestId: vi.fn(),
  deletePromptForOverwrite: vi.fn()
}));

import { add } from '../../src/hono/prompt/add';
import {
  countQueuedPrompts,
  deletePromptForOverwrite,
  findPromptByClientNameAndRequestId
} from '../../src/prompt/repository';
import { createPrompt } from '../../src/prompt/service';

const validBody = { clientName: 'my-client', requestId: 'req-1', userPrompt: 'hello', temperature: 0.7 };

const postJson = (body: unknown) =>
  add.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

describe('POST /prompt/add', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(countQueuedPrompts).mockResolvedValue(1);
    vi.mocked(findPromptByClientNameAndRequestId).mockResolvedValue([]);
    vi.mocked(deletePromptForOverwrite).mockResolvedValue({ rowsAffected: 1 } as never);
  });

  it('returns 201 with success true and queue count on valid input', async () => {
    vi.mocked(createPrompt).mockResolvedValue(1);
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
    vi.mocked(createPrompt).mockRejectedValue(
      new Error('UNIQUE constraint failed: prompts.clientName, prompts.requestId')
    );
    const response = await postJson(validBody);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it('accepts an optional priority field', async () => {
    vi.mocked(createPrompt).mockResolvedValue(1);
    const response = await postJson({ ...validBody, priority: 3 });
    expect(response.status).toBe(201);
  });

  it('returns 400 when priority is negative', async () => {
    const response = await postJson({ ...validBody, priority: -1 });
    expect(response.status).toBe(400);
  });

  it('accepts an optional callbackUrl and systemPrompt', async () => {
    vi.mocked(createPrompt).mockResolvedValue(1);
    const response = await postJson({
      ...validBody,
      callbackUrl: 'https://example.com/callback',
      systemPrompt: 'be concise'
    });
    expect(response.status).toBe(201);
  });

  describe('overwrite=true', () => {
    it('deletes existing queued prompt and returns 201', async () => {
      vi.mocked(findPromptByClientNameAndRequestId).mockResolvedValue([{ status: 'queued' } as never]);
      vi.mocked(createPrompt).mockResolvedValue(1);
      const response = await postJson({ ...validBody, overwrite: true });
      expect(response.status).toBe(201);
      expect(vi.mocked(deletePromptForOverwrite)).toHaveBeenCalledWith(validBody.clientName, validBody.requestId);
    });

    it('deletes existing completed prompt and returns 201', async () => {
      vi.mocked(findPromptByClientNameAndRequestId).mockResolvedValue([{ status: 'completed' } as never]);
      vi.mocked(createPrompt).mockResolvedValue(1);
      const response = await postJson({ ...validBody, overwrite: true });
      expect(response.status).toBe(201);
      expect(vi.mocked(deletePromptForOverwrite)).toHaveBeenCalledWith(validBody.clientName, validBody.requestId);
    });

    it('returns 409 when existing prompt is in_progress', async () => {
      vi.mocked(findPromptByClientNameAndRequestId).mockResolvedValue([{ status: 'in_progress' } as never]);
      const response = await postJson({ ...validBody, overwrite: true });
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(vi.mocked(deletePromptForOverwrite)).not.toHaveBeenCalled();
    });

    it('inserts normally when no existing prompt found', async () => {
      vi.mocked(findPromptByClientNameAndRequestId).mockResolvedValue([]);
      vi.mocked(createPrompt).mockResolvedValue(1);
      const response = await postJson({ ...validBody, overwrite: true });
      expect(response.status).toBe(201);
      expect(vi.mocked(deletePromptForOverwrite)).not.toHaveBeenCalled();
    });

    it('overwrite=false still returns 409 on UNIQUE conflict', async () => {
      vi.mocked(createPrompt).mockRejectedValue(
        new Error('UNIQUE constraint failed: prompts.clientName, prompts.requestId')
      );
      const response = await postJson({ ...validBody, overwrite: false });
      expect(response.status).toBe(409);
    });
  });
});

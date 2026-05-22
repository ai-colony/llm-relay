vi.mock('../../src/prompt/service', () => ({
  createPrompt: vi.fn()
}));

vi.mock('../../src/prompt/repository', () => ({
  getPromptStatusCounts: vi.fn()
}));

import { add } from '../../src/hono/prompt/add';
import { getPromptStatusCounts } from '../../src/prompt/repository';
import { createPrompt } from '../../src/prompt/service';

const validBody = { clientName: 'my-client', requestId: 1, userPrompt: 'hello', temperature: 0.7 };

const postJson = (body: unknown) =>
  add.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

describe('POST /prompt/add', () => {
  beforeEach(() => {
    vi.mocked(getPromptStatusCounts).mockResolvedValue({
      queued: 1,
      pending: 0,
      completed: 0,
      failed: 0,
      callbackPending: 0
    });
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

  it('accepts an optional callbackUrl and systemPrompt', async () => {
    vi.mocked(createPrompt).mockResolvedValue(1);
    const response = await postJson({
      ...validBody,
      callbackUrl: 'https://example.com/callback',
      systemPrompt: 'be concise'
    });
    expect(response.status).toBe(201);
  });
});

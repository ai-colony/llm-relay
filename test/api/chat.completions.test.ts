vi.mock('../../src/lib/openAI', () => ({
  streamChatCompletion: vi.fn()
}));

vi.mock('../../src/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() }
}));

import { completions } from '../../src/hono/chat/completions';
import { streamChatCompletion } from '../../src/lib/openAI';

const validMessages = [{ role: 'user', content: 'Hello' }];

const postJson = (body: unknown) =>
  completions.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

async function* makeChunks(chunks: object[]) {
  for (const chunk of chunks) yield chunk;
}

const readStream = async (response: Response): Promise<string> => {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
};

describe('POST /chat/completions', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('validation', () => {
    it('returns 400 when body is missing', async () => {
      const response = await completions.request('/', { method: 'POST' });
      expect(response.status).toBe(400);
    });

    it('returns 400 when messages array is missing', async () => {
      const response = await postJson({});
      expect(response.status).toBe(400);
    });

    it('returns 400 when messages array is empty', async () => {
      const response = await postJson({ messages: [] });
      expect(response.status).toBe(400);
    });

    it('returns 400 when role is invalid', async () => {
      const response = await postJson({ messages: [{ role: 'unknown', content: 'hi' }] });
      expect(response.status).toBe(400);
    });

    it('returns 400 when messages is not an array', async () => {
      const response = await postJson({ messages: 'hello' });
      expect(response.status).toBe(400);
    });
  });

  describe('SSE streaming', () => {
    it('streams chunks as SSE events and ends with [DONE]', async () => {
      const chunk = { id: 'c1', choices: [{ delta: { content: 'hi' } }] };
      vi.mocked(streamChatCompletion).mockReturnValue(makeChunks([chunk]));

      const response = await postJson({ messages: validMessages });
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/event-stream');

      const body = await readStream(response);
      expect(body).toContain(`data: ${JSON.stringify(chunk)}`);
      expect(body).toContain('data: [DONE]');
    });

    it('streams multiple chunks in order', async () => {
      const chunks = [
        { id: 'c1', choices: [{ delta: { content: 'Hello' } }] },
        { id: 'c2', choices: [{ delta: { content: ' world' } }] }
      ];
      vi.mocked(streamChatCompletion).mockReturnValue(makeChunks(chunks));

      const response = await postJson({ messages: validMessages });
      const body = await readStream(response);

      expect(body.indexOf(JSON.stringify(chunks[0]))).toBeLessThan(body.indexOf(JSON.stringify(chunks[1])));
      expect(body).toContain('data: [DONE]');
    });

    it('sets Cache-Control: no-cache header', async () => {
      vi.mocked(streamChatCompletion).mockReturnValue(makeChunks([]));

      const response = await postJson({ messages: validMessages });
      expect(response.headers.get('Cache-Control')).toBe('no-cache');
    });

    it('passes messages to streamChatCompletion', async () => {
      vi.mocked(streamChatCompletion).mockReturnValue(makeChunks([]));

      await postJson({ messages: validMessages });
      expect(vi.mocked(streamChatCompletion)).toHaveBeenCalledWith(validMessages, undefined, undefined);
    });

    it('passes tools to streamChatCompletion when provided', async () => {
      vi.mocked(streamChatCompletion).mockReturnValue(makeChunks([]));
      const tools = [
        {
          type: 'function' as const,
          function: { name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: {} } }
        }
      ];

      await postJson({ messages: validMessages, tools });
      expect(vi.mocked(streamChatCompletion)).toHaveBeenCalledWith(validMessages, tools, undefined);
    });

    it('passes temperature to streamChatCompletion when provided', async () => {
      vi.mocked(streamChatCompletion).mockReturnValue(makeChunks([]));

      await postJson({ messages: validMessages, temperature: 0.2 });
      expect(vi.mocked(streamChatCompletion)).toHaveBeenCalledWith(validMessages, undefined, 0.2);
    });

    it('returns 400 when temperature is out of range', async () => {
      const response = await postJson({ messages: validMessages, temperature: 3 });
      expect(response.status).toBe(400);
    });
  });

  describe('message roles', () => {
    it('accepts system role', async () => {
      vi.mocked(streamChatCompletion).mockReturnValue(makeChunks([]));
      const response = await postJson({ messages: [{ role: 'system', content: 'You are helpful' }] });
      expect(response.status).toBe(200);
    });

    it('accepts assistant role', async () => {
      vi.mocked(streamChatCompletion).mockReturnValue(makeChunks([]));
      const response = await postJson({ messages: [{ role: 'assistant', content: 'OK' }] });
      expect(response.status).toBe(200);
    });

    it('accepts tool role with tool_call_id', async () => {
      vi.mocked(streamChatCompletion).mockReturnValue(makeChunks([]));
      const response = await postJson({
        messages: [{ role: 'tool', content: 'result', tool_call_id: 'call_1' }]
      });
      expect(response.status).toBe(200);
    });

    it('accepts assistant message with tool_calls', async () => {
      vi.mocked(streamChatCompletion).mockReturnValue(makeChunks([]));
      const response = await postJson({
        messages: [
          {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'fn', arguments: '{}' } }]
          }
        ]
      });
      expect(response.status).toBe(200);
    });
  });

  describe('error handling', () => {
    it('writes error chunk when streamChatCompletion throws', async () => {
      vi.mocked(streamChatCompletion).mockImplementation(async function* () {
        yield* [];
        throw new Error('upstream failure');
      });

      const response = await postJson({ messages: validMessages });
      expect(response.status).toBe(200);

      const body = await readStream(response);
      expect(body).toContain(JSON.stringify({ error: 'Stream failed' }));
    });
  });
});

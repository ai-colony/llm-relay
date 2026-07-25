// The prompt schemas pull isCallbackUrlAllowed from the barrel; narrow the mock to that module so
// importing the spec does not also construct a live OpenAI client at module scope.
vi.mock('@lib', async () => await import('../../src/lib/callbackUrl'));

import { z } from 'zod';

import { openapi } from '../../src/hono/openapi';
import { AddPromptBodySchema } from '../../src/hono/prompt/schemas';

type Operation = { responses: Record<string, unknown>; security?: unknown[] };

const getSpec = async () => {
  const response = await openapi.request('/openapi.json');
  return (await response.json()) as {
    paths: Record<string, Record<string, Operation>>;
    components: { schemas: Record<string, Record<string, unknown>>; securitySchemes: Record<string, unknown> };
  };
};

const VALIDATED_PATHS = [
  '/prompt/add',
  '/prompt/get',
  '/prompt/list',
  '/prompt/cancel',
  '/prompt/purge',
  '/chat/completions'
];

describe('GET /openapi.json', () => {
  it('returns the OpenAPI spec as JSON', async () => {
    const response = await openapi.request('/openapi.json');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');

    const body = await response.json();
    expect(body.openapi).toBe('3.1.0');
    expect(body.info.title).toBe('LLM Relay');
    expect(body.paths).toHaveProperty('/health');
  });

  it('documents every route the server mounts', async () => {
    const spec = await getSpec();
    for (const path of ['/health', '/metrics', '/status', '/openapi.json', '/docs', ...VALIDATED_PATHS])
      expect(Object.keys(spec.paths)).toContain(path);
  });

  it('declares bearer auth on exactly the routes the auth middleware guards', async () => {
    const spec = await getSpec();
    expect(spec.components.securitySchemes).toHaveProperty('bearerAuth');

    for (const [path, operations] of Object.entries(spec.paths))
      for (const operation of Object.values(operations)) {
        const isGuarded = path.startsWith('/prompt/') || path.startsWith('/chat/');
        // Public routes carry an explicit empty list rather than omitting the key.
        expect(operation.security).toEqual(isGuarded ? [{ bearerAuth: [] }] : []);
        // Guarded routes can always answer 401, and 500 via the global onError handler.
        if (isGuarded) expect(Object.keys(operation.responses)).toEqual(expect.arrayContaining(['401', '500']));
      }
  });

  it('documents a 400 on every route that runs request validation', async () => {
    const spec = await getSpec();
    for (const path of VALIDATED_PATHS) {
      const [operation] = Object.values(spec.paths[path] ?? {});
      expect(Object.keys(operation?.responses ?? {})).toContain('400');
    }
  });

  it('generates AddPromptBody from the Zod schema the route validates with', async () => {
    const spec = await getSpec();
    const generated = z.toJSONSchema(AddPromptBodySchema, { io: 'input' }) as Record<string, unknown>;
    const documented = spec.components.schemas['AddPromptBody'] ?? {};
    expect(documented['required']).toEqual(generated['required']);

    // Constraints must survive generation rather than being retyped by hand.
    const properties = documented['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['clientName']).toMatchObject({ type: 'string', minLength: 1 });
    expect(properties['temperature']).toMatchObject({ type: 'number', minimum: 0, maximum: 2 });
  });

  it('resolves every $ref to a defined component schema', async () => {
    const spec = await getSpec();
    const references = JSON.stringify(spec)
      .matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g)
      .map((match) => match[1] as string)
      .toArray();
    expect(references.length).toBeGreaterThan(0);

    const unique = new Set(references);
    for (const name of unique) expect(spec.components.schemas).toHaveProperty(name);
  });
});

describe('GET /docs', () => {
  it('returns the Swagger UI HTML page', async () => {
    const response = await openapi.request('/docs');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');

    const body = await response.text();
    expect(body).toContain('swagger-ui');
  });
});

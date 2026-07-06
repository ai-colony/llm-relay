import { openapi } from '../../src/hono/openapi';

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

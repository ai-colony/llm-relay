import { PROMPT_STATUSES } from '@db/schema';
import { Hono } from 'hono';
import { html } from 'hono/html';
import { z } from 'zod';

import { version } from '../../package.json';
import { RelayChatRequestSchema } from './chat/schemas';
import { AddPromptBodySchema, ListQuerySchema, PromptKeyQuerySchema, PurgeQuerySchema } from './prompt/schemas';

type JsonSchema = Record<string, unknown>;

// Drops the $schema marker and the explicit MAX_SAFE_INTEGER bound that z.int() emits — both are
// noise in a published contract.
const clean = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => clean(item));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as JsonSchema)
      .filter(([key, entry]) => key !== '$schema' && !(key === 'maximum' && entry === Number.MAX_SAFE_INTEGER))
      .map(([key, entry]) => [key, clean(entry)])
  );
};

// Request schemas are generated from the Zod schemas the routes actually validate with, so the two
// can never drift. `io: 'input'` describes what a client sends (defaults optional, before coercion).
const fromZod = (schema: z.ZodType): JsonSchema => clean(z.toJSONSchema(schema, { io: 'input' })) as JsonSchema;

// Turns an object schema into an OpenAPI `parameters` array for query-string routes.
const queryParameters = (schema: z.ZodType) => {
  const generated = fromZod(schema);
  const properties = (generated['properties'] ?? {}) as Record<string, JsonSchema>;
  const required = new Set((generated['required'] ?? []) as string[]);
  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: 'query',
    required: required.has(name),
    schema: property
  }));
};

const jsonContent = (schema: JsonSchema) => ({ 'application/json': { schema } });
const reference = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const errorResponse = (description: string) => ({ description, content: jsonContent(reference('ErrorResponse')) });
const validationErrorResponse = {
  description: 'Request failed schema validation',
  content: jsonContent(reference('ValidationErrorResponse'))
};
const unauthorizedResponse = errorResponse('Missing or invalid Bearer token (only when API_KEY is configured)');
const serverErrorResponse = errorResponse('Unhandled server error');

// `secured` marks the routes behind the auth middleware (/prompt/*, /chat/*); `unauthenticated` is
// the explicit "no auth required" form, clearer than omitting the key on the always-open routes.
const secured = { security: [{ bearerAuth: [] }] };
const unauthenticated = { security: [] };
const authedResponses = { '401': unauthorizedResponse, '500': serverErrorResponse };

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'LLM Relay',
    version,
    description:
      'HTTP relay server that queues LLM prompts against OpenAI-compatible APIs with SQLite persistence and async callback delivery.'
  },
  servers: [{ url: '/', description: 'The relay itself; base path depends on how it is deployed.' }],
  paths: {
    '/health': {
      get: {
        operationId: 'getHealth',
        ...unauthenticated,
        summary: 'Health check',
        description: 'Returns 503 if either the SQLite database or the upstream OpenAI endpoint is unavailable.',
        responses: {
          '200': { description: 'All systems healthy', content: jsonContent(reference('HealthResponse')) },
          '503': { description: 'One or more systems unhealthy', content: jsonContent(reference('HealthResponse')) }
        }
      }
    },
    '/metrics': {
      get: {
        operationId: 'getMetrics',
        ...unauthenticated,
        summary: 'Prometheus metrics',
        description: 'Returns queue depths, processing rates, and error counts in Prometheus text exposition format.',
        responses: { '200': { description: 'OK', content: { 'text/plain': { schema: { type: 'string' } } } } }
      }
    },
    '/status': {
      get: {
        operationId: 'getStatus',
        ...unauthenticated,
        summary: 'Server status and queue counts',
        responses: { '200': { description: 'OK', content: jsonContent(reference('StatusResponse')) } }
      }
    },
    '/openapi.json': {
      get: {
        operationId: 'getOpenapiDocument',
        ...unauthenticated,
        summary: 'This OpenAPI document',
        responses: { '200': { description: 'OK', content: jsonContent({ type: 'object' }) } }
      }
    },
    '/docs': {
      get: {
        operationId: 'getDocs',
        ...unauthenticated,
        summary: 'Swagger UI',
        responses: { '200': { description: 'OK', content: { 'text/html': { schema: { type: 'string' } } } } }
      }
    },
    '/prompt/add': {
      post: {
        operationId: 'addPrompt',
        summary: 'Queue a new prompt',
        description:
          'Adds a prompt to the queue identified by (clientName, requestId). Set overwrite=true to replace an existing non-in-progress prompt.',
        ...secured,
        requestBody: { required: true, content: jsonContent(reference('AddPromptBody')) },
        responses: {
          '201': { description: 'Prompt queued', content: jsonContent(reference('AddPromptResponse')) },
          '400': validationErrorResponse,
          '409': errorResponse('Duplicate (clientName, requestId) or in-progress overwrite attempt'),
          '503': errorResponse('callbackUrl did not answer the reachability probe'),
          ...authedResponses
        }
      }
    },
    '/prompt/get': {
      get: {
        operationId: 'getPrompt',
        summary: 'Get prompt status and result',
        ...secured,
        parameters: queryParameters(PromptKeyQuerySchema),
        responses: {
          '200': { description: 'Prompt found', content: jsonContent(reference('GetPromptResponse')) },
          '400': validationErrorResponse,
          '404': errorResponse('Prompt not found'),
          ...authedResponses
        }
      }
    },
    '/prompt/list': {
      get: {
        operationId: 'listPrompts',
        summary: 'List prompts for a client',
        description: 'Returns up to 500 prompts ordered by creation time. Filter by status to narrow results.',
        ...secured,
        parameters: queryParameters(ListQuerySchema),
        responses: {
          '200': { description: 'OK', content: jsonContent({ type: 'array', items: reference('PromptListItem') }) },
          '400': validationErrorResponse,
          ...authedResponses
        }
      }
    },
    '/prompt/cancel': {
      delete: {
        operationId: 'cancelPrompt',
        summary: 'Cancel and delete a prompt',
        description: 'Deletes the prompt record. Only allowed for queued, failed, and failed_retry statuses.',
        ...secured,
        parameters: queryParameters(PromptKeyQuerySchema),
        responses: {
          '200': { description: 'Cancelled', content: jsonContent(reference('SuccessResponse')) },
          '400': validationErrorResponse,
          '404': errorResponse('Prompt not found'),
          '409': errorResponse('Cannot cancel – prompt is in_progress or completed'),
          ...authedResponses
        }
      }
    },
    '/prompt/purge': {
      delete: {
        operationId: 'purgePrompts',
        summary: 'Purge old completed and failed prompts',
        description:
          'Deletes completed and failed prompts older than the given number of days. Optionally scoped to a single client.',
        ...secured,
        parameters: queryParameters(PurgeQuerySchema),
        responses: {
          '200': { description: 'Purge complete', content: jsonContent(reference('PurgeResponse')) },
          '400': validationErrorResponse,
          ...authedResponses
        }
      }
    },
    '/chat/completions': {
      post: {
        operationId: 'chatCompletions',
        summary: 'Streaming chat completions',
        description:
          'Proxies a chat conversation to the upstream LLM and streams the response as Server-Sent Events. Each event is `data: <JSON chunk>` ending with `data: [DONE]`. Bypasses the prompt queue entirely.',
        ...secured,
        requestBody: { required: true, content: jsonContent(reference('ChatCompletionsBody')) },
        responses: {
          '200': {
            description: 'SSE stream of chat completion chunks',
            content: {
              'text/event-stream': {
                schema: { type: 'string' },
                example: 'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n'
              }
            }
          },
          '400': validationErrorResponse,
          ...authedResponses
        }
      }
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Set to the relay API_KEY. Auth is disabled entirely when API_KEY is empty.'
      }
    },
    schemas: {
      // --- Generated from the Zod schemas the routes validate with -----------------------------
      AddPromptBody: fromZod(AddPromptBodySchema),
      ChatCompletionsBody: fromZod(RelayChatRequestSchema),

      // --- Hand-written response envelopes ----------------------------------------------------
      HealthCheck: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          error: { type: 'string', description: 'Present only when ok is false' }
        },
        required: ['ok']
      },
      HealthResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          checks: {
            type: 'object',
            properties: { db: reference('HealthCheck'), openai: reference('HealthCheck') },
            required: ['db', 'openai']
          }
        },
        required: ['success', 'checks']
      },
      StatusResponse: {
        type: 'object',
        properties: {
          version: { type: 'string' },
          uptime: { type: 'integer', description: 'Process uptime in seconds' },
          model: { type: 'string', description: 'Active model name; absent when the upstream is unreachable' },
          contextSize: {
            type: 'integer',
            description: 'Model context window size in tokens; absent when not reported by the upstream'
          },
          queued: { type: 'integer' },
          inProgress: { type: 'integer' },
          completed: { type: 'integer' },
          failed: { type: 'integer' },
          callbackPending: { type: 'integer' }
        },
        required: ['version', 'uptime', 'queued', 'inProgress', 'completed', 'failed', 'callbackPending']
      },
      AddPromptResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', const: true },
          queued: { type: 'integer', description: 'Total prompts currently queued' }
        },
        required: ['success', 'queued']
      },
      SuccessResponse: {
        type: 'object',
        properties: { success: { type: 'boolean', const: true } },
        required: ['success']
      },
      PurgeResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', const: true },
          deleted: { type: 'integer', description: 'Number of records deleted' }
        },
        required: ['success', 'deleted']
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', const: false },
          error: { type: 'string' },
          path: { type: 'string', description: 'Request path, present on unhandled errors' },
          method: { type: 'string', description: 'Request method, present on unhandled errors' }
        },
        required: ['success', 'error']
      },
      ValidationErrorResponse: {
        type: 'object',
        description: 'Emitted by the request validator; `error` is an object here, not a string.',
        properties: {
          success: { type: 'boolean', const: false },
          error: {
            type: 'object',
            properties: {
              name: { type: 'string', const: 'ZodError' },
              message: { type: 'string', description: 'JSON-encoded array of validation issues' }
            },
            required: ['name', 'message']
          }
        },
        required: ['success', 'error']
      },
      PromptStatus: { type: 'string', enum: [...PROMPT_STATUSES] },
      GetPromptResponsePending: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['queued', 'in_progress', 'failed_retry'] } },
        required: ['status']
      },
      GetPromptResponseFailed: {
        type: 'object',
        properties: {
          status: { type: 'string', const: 'failed' },
          statusError: { type: ['string', 'null'] }
        },
        required: ['status', 'statusError']
      },
      GetPromptResponseCompleted: {
        type: 'object',
        properties: {
          status: { type: 'string', const: 'completed' },
          reasoning: { type: ['string', 'null'] },
          response: { type: ['string', 'null'] },
          reasoningTimeMs: { type: ['integer', 'null'] },
          reasoningTokenPerSecond: { type: ['integer', 'null'] },
          responseTimeMs: { type: ['integer', 'null'] },
          responseTokenPerSecond: { type: ['integer', 'null'] }
        },
        required: [
          'status',
          'reasoning',
          'response',
          'reasoningTimeMs',
          'reasoningTokenPerSecond',
          'responseTimeMs',
          'responseTokenPerSecond'
        ]
      },
      GetPromptResponse: {
        oneOf: [
          reference('GetPromptResponsePending'),
          reference('GetPromptResponseFailed'),
          reference('GetPromptResponseCompleted')
        ],
        discriminator: { propertyName: 'status' }
      },
      PromptListItem: {
        type: 'object',
        properties: {
          priority: { type: 'integer', minimum: 0 },
          requestId: { type: 'string' },
          status: reference('PromptStatus'),
          createdAt: { type: 'string', format: 'date-time' },
          completedAt: { type: ['string', 'null'], format: 'date-time' }
        },
        required: ['priority', 'requestId', 'status', 'createdAt', 'completedAt']
      }
    }
  }
};

export const openapi = new Hono()
  .get('/openapi.json', (c) => c.json(spec))
  .get('/docs', (c) =>
    c.html(html`
      <!doctype html>
      <html>
        <head>
          <title>LLM Relay API</title>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
        </head>
        <body>
          <div id="swagger-ui"></div>
          <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
          <script>
            SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui' });
          </script>
        </body>
      </html>
    `)
  );

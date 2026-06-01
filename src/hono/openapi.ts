import { Hono } from 'hono';
import { html } from 'hono/html';

import { version } from '../../package.json';

const PROMPT_STATUS_SCHEMA = {
  type: 'string',
  enum: ['queued', 'in_progress', 'completed', 'failed', 'failed_retry']
} as const;

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'LLM Relay',
    version,
    description:
      'HTTP relay server that queues LLM prompts against OpenAI-compatible APIs with SQLite persistence and async callback delivery.'
  },
  paths: {
    '/health': {
      get: {
        operationId: 'getHealth',
        summary: 'Health check',
        description: 'Returns 503 if either the SQLite database or the upstream OpenAI endpoint is unavailable.',
        responses: {
          '200': {
            description: 'All systems healthy',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } }
          },
          '503': {
            description: 'One or more systems unhealthy',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } }
          }
        }
      }
    },
    '/status': {
      get: {
        operationId: 'getStatus',
        summary: 'Server status and queue counts',
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/StatusResponse' } } }
          }
        }
      }
    },
    '/prompt/add': {
      post: {
        operationId: 'addPrompt',
        summary: 'Queue a new prompt',
        description:
          'Adds a prompt to the queue identified by (clientName, requestId). Set overwrite=true to replace an existing non-in-progress prompt.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AddPromptBody' } } }
        },
        responses: {
          '201': {
            description: 'Prompt queued',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AddPromptResponse' } } }
          },
          '409': {
            description: 'Duplicate (clientName, requestId) or in-progress overwrite attempt',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
          }
        }
      }
    },
    '/prompt/get': {
      get: {
        operationId: 'getPrompt',
        summary: 'Get prompt status and result',
        parameters: [
          { name: 'clientName', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'requestId', in: 'query', required: true, schema: { type: 'integer', minimum: 1 } }
        ],
        responses: {
          '200': {
            description: 'Prompt found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GetPromptResponse' } } }
          },
          '404': {
            description: 'Prompt not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
          }
        }
      }
    },
    '/prompt/list': {
      get: {
        operationId: 'listPrompts',
        summary: 'List prompts for a client',
        description: 'Returns up to 500 prompts ordered by creation time. Filter by status to narrow results.',
        parameters: [
          { name: 'clientName', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'status', in: 'query', required: false, schema: PROMPT_STATUS_SCHEMA }
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/PromptListItem' } }
              }
            }
          }
        }
      }
    },
    '/prompt/cancel': {
      delete: {
        operationId: 'cancelPrompt',
        summary: 'Cancel and delete a prompt',
        description: 'Deletes the prompt record. Only allowed for queued, failed, and failed_retry statuses.',
        parameters: [
          { name: 'clientName', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'requestId', in: 'query', required: true, schema: { type: 'integer', minimum: 1 } }
        ],
        responses: {
          '200': {
            description: 'Cancelled',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { success: { type: 'boolean', const: true } },
                  required: ['success']
                }
              }
            }
          },
          '404': {
            description: 'Prompt not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
          },
          '409': {
            description: 'Cannot cancel – prompt is in_progress or completed',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
          }
        }
      }
    }
  },
  components: {
    schemas: {
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
            properties: {
              db: { $ref: '#/components/schemas/HealthCheck' },
              openai: { $ref: '#/components/schemas/HealthCheck' }
            },
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
          queued: { type: 'integer' },
          pending: { type: 'integer' },
          completed: { type: 'integer' },
          failed: { type: 'integer' },
          callbackPending: { type: 'integer' }
        },
        required: ['version', 'uptime', 'queued', 'pending', 'completed', 'failed', 'callbackPending']
      },
      AddPromptBody: {
        type: 'object',
        properties: {
          clientName: { type: 'string', minLength: 1 },
          requestId: { type: 'integer', minimum: 1 },
          callbackUrl: { type: 'string', format: 'uri', description: 'POSTed to after the prompt completes' },
          systemPrompt: { type: 'string' },
          userPrompt: { type: 'string', minLength: 1 },
          temperature: { type: 'number', minimum: 0, maximum: 2 },
          overwrite: { type: 'boolean', default: false, description: 'Replace existing non-in-progress prompt' }
        },
        required: ['clientName', 'requestId', 'userPrompt', 'temperature']
      },
      AddPromptResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', const: true },
          queued: { type: 'integer', description: 'Total prompts currently queued' }
        },
        required: ['success', 'queued']
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', const: false },
          error: { type: 'string' }
        },
        required: ['success', 'error']
      },
      PromptStatus: PROMPT_STATUS_SCHEMA,
      GetPromptResponsePending: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['queued', 'in_progress', 'failed_retry'] }
        },
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
          reasoningTokenPerSecond: { type: ['number', 'null'] },
          responseTimeMs: { type: ['integer', 'null'] },
          responseTokenPerSecond: { type: ['number', 'null'] }
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
          { $ref: '#/components/schemas/GetPromptResponsePending' },
          { $ref: '#/components/schemas/GetPromptResponseFailed' },
          { $ref: '#/components/schemas/GetPromptResponseCompleted' }
        ],
        discriminator: { propertyName: 'status' }
      },
      PromptListItem: {
        type: 'object',
        properties: {
          requestId: { type: 'integer' },
          status: { $ref: '#/components/schemas/PromptStatus' },
          createdAt: { type: 'string', format: 'date-time' },
          completedAt: { type: ['string', 'null'], format: 'date-time' }
        },
        required: ['requestId', 'status', 'createdAt', 'completedAt']
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

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
    '/metrics': {
      get: {
        operationId: 'getMetrics',
        summary: 'Prometheus metrics',
        description: 'Returns queue depths, processing rates, and error counts in Prometheus text exposition format.',
        responses: {
          '200': {
            description: 'OK',
            content: { 'text/plain': { schema: { type: 'string' } } }
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
          { name: 'requestId', in: 'query', required: true, schema: { type: 'string', minLength: 1 } }
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
    '/prompt/purge': {
      delete: {
        operationId: 'purgePrompts',
        summary: 'Purge old completed and failed prompts',
        description:
          'Deletes completed and failed prompts older than the given number of days. Optionally scoped to a single client.',
        parameters: [
          { name: 'clientName', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'days', in: 'query', required: false, schema: { type: 'integer', minimum: 1, default: 7 } }
        ],
        responses: {
          '200': {
            description: 'Purge complete',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PurgeResponse' } } }
          }
        }
      }
    },
    '/chat/completions': {
      post: {
        operationId: 'chatCompletions',
        summary: 'Streaming chat completions',
        description:
          'Proxies a chat conversation to the upstream LLM and streams the response as Server-Sent Events. Each event is `data: <JSON chunk>` ending with `data: [DONE]`. Requires Bearer auth when API_KEY is configured.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ChatCompletionsBody' } } }
        },
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
          '400': {
            description: 'Invalid request body',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
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
          { name: 'requestId', in: 'query', required: true, schema: { type: 'string', minLength: 1 } }
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
          model: { type: 'string', description: 'Active model name; absent when the upstream is unreachable' },
          contextSize: {
            type: 'integer',
            description: 'Model context window size in tokens; absent when not reported by the upstream'
          },
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
          requestId: { type: 'string', minLength: 1 },
          callbackUrl: { type: 'string', format: 'uri', description: 'POSTed to after the prompt completes' },
          systemPrompt: { type: 'string' },
          userPrompt: { type: 'string', minLength: 1 },
          temperature: { type: 'number', minimum: 0, maximum: 2 },
          priority: {
            type: 'integer',
            minimum: 0,
            default: 0,
            description: 'Lower value = higher priority (processed first)'
          },
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
          priority: { type: 'integer', minimum: 0 },
          requestId: { type: 'string' },
          status: { $ref: '#/components/schemas/PromptStatus' },
          createdAt: { type: 'string', format: 'date-time' },
          completedAt: { type: ['string', 'null'], format: 'date-time' }
        },
        required: ['priority', 'requestId', 'status', 'createdAt', 'completedAt']
      },
      PurgeResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', const: true },
          deleted: { type: 'integer', description: 'Number of records deleted' }
        },
        required: ['success', 'deleted']
      },
      RelayToolCall: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string', const: 'function' },
          function: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              arguments: { type: 'string', description: 'JSON-encoded function arguments' }
            },
            required: ['name', 'arguments']
          }
        },
        required: ['id', 'type', 'function']
      },
      ChatMessage: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool'] },
          content: { type: ['string', 'null'], description: 'Message text; null for tool-call-only assistant turns' },
          tool_calls: { type: 'array', items: { $ref: '#/components/schemas/RelayToolCall' } },
          tool_call_id: { type: 'string', description: 'Required when role is tool' },
          name: { type: 'string' }
        },
        required: ['role']
      },
      ChatTool: {
        type: 'object',
        properties: {
          type: { type: 'string', const: 'function' },
          function: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              parameters: { type: 'object', additionalProperties: true }
            },
            required: ['name', 'parameters']
          }
        },
        required: ['type', 'function']
      },
      ChatCompletionsBody: {
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            items: { $ref: '#/components/schemas/ChatMessage' },
            minItems: 1,
            description: 'Conversation history in OpenAI message format'
          },
          tools: {
            type: 'array',
            items: { $ref: '#/components/schemas/ChatTool' },
            description: 'Optional tool/function definitions available to the model'
          },
          temperature: {
            type: 'number',
            minimum: 0,
            maximum: 2,
            description: 'Sampling temperature (0–2). Omit to use the model default.'
          }
        },
        required: ['messages']
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

import { blob, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Every queued job shares one lifecycle, so both tables share one status list.
export const JOB_STATUSES = ['queued', 'in_progress', 'completed', 'failed', 'failed_retry'] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

// The shape a client asks embedding results back in. Lives here for the same reason the status list
// does: it backs the Drizzle column, the Zod enum and the OpenAPI enum from one definition.
export const ENCODING_FORMATS = ['float', 'base64'] as const;

export type EncodingFormat = (typeof ENCODING_FORMATS)[number];

export const PROMPT_STATUSES = JOB_STATUSES;
export type PromptStatus = JobStatus;

export const EMBEDDING_STATUSES = JOB_STATUSES;
export type EmbeddingStatus = JobStatus;

export const prompts = sqliteTable(
  'prompts',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    clientName: text().notNull(),
    requestId: text().notNull(),
    callbackUrl: text(),
    callbackCompleted: integer({ mode: 'boolean' }).notNull(),

    createdAt: integer({ mode: 'timestamp' }).notNull(),
    status: text({ enum: PROMPT_STATUSES }).notNull(),
    statusError: text(),
    completedAt: integer({ mode: 'timestamp' }),

    systemPrompt: text(),
    userPrompt: text().notNull(),
    temperature: real().notNull(),
    priority: integer().notNull().default(0),

    retryCount: integer().notNull(),
    nextRetryAt: integer({ mode: 'timestamp' }),

    reasoning: text(),
    response: text(),
    reasoningTimeMs: integer(),
    reasoningTokenPerSecond: integer(),
    responseTimeMs: integer(),
    responseTokenPerSecond: integer()
  },
  (t) => [
    index('idx_prompts_callback').on(t.status, t.callbackCompleted, t.callbackUrl),
    index('idx_prompts_status_priority_created').on(t.status, t.priority, t.createdAt),
    index('idx_prompts_client_created').on(t.clientName, t.createdAt),
    uniqueIndex('idx_prompts_client_request').on(t.clientName, t.requestId)
  ]
);

export const embeddings = sqliteTable(
  'embeddings',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    clientName: text().notNull(),
    requestId: text().notNull(),
    callbackUrl: text(),
    callbackCompleted: integer({ mode: 'boolean' }).notNull(),

    createdAt: integer({ mode: 'timestamp' }).notNull(),
    status: text({ enum: EMBEDDING_STATUSES }).notNull(),
    statusError: text(),
    completedAt: integer({ mode: 'timestamp' }),

    // JSON array of the inputs to embed; inputCount mirrors its length so the queue and list queries
    // never have to parse it. encodingFormat is the shape the client asked results back in.
    input: text().notNull(),
    inputCount: integer().notNull(),
    encodingFormat: text({ enum: ENCODING_FORMATS }).notNull(),
    priority: integer().notNull().default(0),

    retryCount: integer().notNull(),
    nextRetryAt: integer({ mode: 'timestamp' }),

    model: text(),
    dimensions: integer(),
    // inputCount × dimensions little-endian float32s, back to back.
    vectors: blob({ mode: 'buffer' }),
    durationMs: integer()
  },
  (t) => [
    index('idx_embeddings_callback').on(t.status, t.callbackCompleted, t.callbackUrl),
    index('idx_embeddings_status_priority_created').on(t.status, t.priority, t.createdAt),
    index('idx_embeddings_client_created').on(t.clientName, t.createdAt),
    uniqueIndex('idx_embeddings_client_request').on(t.clientName, t.requestId)
  ]
);

export const schema = {
  prompts,
  embeddings
};

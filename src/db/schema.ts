import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export type PromptStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'failed_retry';

export const prompts = sqliteTable(
  'prompts',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    clientName: text().notNull(),
    requestId: text().notNull(),
    callbackUrl: text(),
    callbackCompleted: integer({ mode: 'boolean' }).notNull(),

    createdAt: integer({ mode: 'timestamp' }).notNull(),
    status: text({ enum: ['queued', 'in_progress', 'completed', 'failed', 'failed_retry'] }).notNull(),
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

export const schema = {
  prompts
};

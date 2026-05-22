import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export type PromptStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'failed_retry';

export const prompts = sqliteTable(
  'prompts',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    clientName: text().notNull(),
    requestId: integer().notNull(),
    callbackUrl: text(),
    callbackCompleted: integer({ mode: 'boolean' }).notNull(),

    createdAt: integer({ mode: 'timestamp' }).notNull(),
    status: text({ enum: ['queued', 'in_progress', 'completed', 'failed', 'failed_retry'] }).notNull(),
    statusError: text(),
    completedAt: integer({ mode: 'timestamp' }),

    systemPrompt: text(),
    userPrompt: text().notNull(),
    temperature: real().notNull(),

    reasoning: text(),
    response: text(),
    reasoningTimeMs: integer(),
    reasoningTokenPerSecond: integer(),
    responseTimeMs: integer(),
    responseTokenPerSecond: integer()
  },
  (t) => [index('idx_prompts_status').on(t.status), index('idx_prompts_callback').on(t.callbackCompleted, t.status)]
);

export const schema = {
  prompts
};

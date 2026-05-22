import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export type PromptStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'failed_retry';

export const prompts = sqliteTable('prompts', {
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

  reasoning: text(),
  response: text(),
  reasoningTime: integer(),
  reasoningTokenPerSecond: integer(),
  responseTime: integer(),
  responseTokenPerSecond: integer()
});

export const schema = {
  prompts
};

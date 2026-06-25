import { DatabaseSync } from 'node:sqlite';

import { drizzle } from 'drizzle-orm/node-sqlite';

import { schema } from '../../src/db/schema';

const sqlite = new DatabaseSync(':memory:');

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    clientName TEXT NOT NULL,
    requestId TEXT NOT NULL,
    callbackUrl TEXT,
    callbackCompleted INTEGER NOT NULL,
    createdAt INTEGER NOT NULL,
    status TEXT NOT NULL,
    statusError TEXT,
    completedAt INTEGER,
    systemPrompt TEXT,
    userPrompt TEXT NOT NULL,
    temperature REAL NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    retryCount INTEGER NOT NULL,
    nextRetryAt INTEGER,
    reasoning TEXT,
    response TEXT,
    reasoningTimeMs INTEGER,
    reasoningTokenPerSecond INTEGER,
    responseTimeMs INTEGER,
    responseTokenPerSecond INTEGER
  )
`);
sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_client_request ON prompts (clientName, requestId)');
sqlite.exec('CREATE INDEX IF NOT EXISTS idx_prompts_callback ON prompts (callbackCompleted, status, callbackUrl)');
sqlite.exec('CREATE INDEX IF NOT EXISTS idx_prompts_status_priority_created ON prompts (status, priority, createdAt)');
sqlite.exec('CREATE INDEX IF NOT EXISTS idx_prompts_client_created ON prompts (clientName, createdAt)');

export const testSqlite = sqlite;
export const testDatabaseClient = drizzle({ client: sqlite, schema });

export const clearDatabase = () => sqlite.exec('DELETE FROM prompts');

export { schema as testDbSchema } from '../../src/db/schema';

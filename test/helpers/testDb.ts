import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { schema } from '../../src/db/schema';

const sqlite = new Database(':memory:');

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    clientName TEXT NOT NULL,
    requestId INTEGER NOT NULL,
    callbackUrl TEXT,
    callbackCompleted INTEGER NOT NULL,
    createdAt INTEGER NOT NULL,
    status TEXT NOT NULL,
    statusError TEXT,
    completedAt INTEGER,
    systemPrompt TEXT,
    userPrompt TEXT NOT NULL,
    temperature REAL NOT NULL,
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

export const testSqlite = sqlite;
export const testDbClient = drizzle({ client: sqlite, schema });

export function clearDatabase() {
  sqlite.exec('DELETE FROM prompts');
}

export { schema as testDbSchema } from '../../src/db/schema';

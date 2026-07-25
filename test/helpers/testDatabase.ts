import { DatabaseSync } from 'node:sqlite';

import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';

import { schema } from '../../src/db/schema';

const sqlite = new DatabaseSync(':memory:');

export const testDatabaseClient = drizzle({ client: sqlite, schema });

// Built from the same migrations production runs (src/index.ts) rather than hand-written DDL, so the
// test schema — columns and indexes alike — cannot drift from the real one.
migrate(testDatabaseClient, { migrationsFolder: './drizzle' });

export const clearDatabase = () => sqlite.exec('DELETE FROM prompts');

export { schema as testDbSchema } from '../../src/db/schema';

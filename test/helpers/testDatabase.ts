import { DatabaseSync } from 'node:sqlite';

import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';

const sqlite = new DatabaseSync(':memory:');

// Constructed exactly as production does in src/db/index.ts; `schema` is exported separately
// rather than passed here, since drizzle's config no longer accepts it.
export const testDatabaseClient = drizzle({ client: sqlite });

// Built from the same migrations production runs (src/index.ts) rather than hand-written DDL, so the
// test schema — columns and indexes alike — cannot drift from the real one.
migrate(testDatabaseClient, { migrationsFolder: './drizzle' });

export const clearDatabase = () => sqlite.exec('DELETE FROM prompts');

export { schema as testDbSchema } from '../../src/db/schema';

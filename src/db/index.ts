import { config } from '@lib';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { schema } from './schema';

const sqlite = new Database(config.database.filename);
const client = drizzle({ client: sqlite, schema });

export const database = {
  dbClient: client,
  dbSchema: schema
};

export function checkDatabase(): { ok: boolean; error?: string } {
  try {
    client.run(sql`SELECT 1`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

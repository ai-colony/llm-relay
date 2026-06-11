import { DatabaseSync } from 'node:sqlite';

import { config } from '@lib';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-sqlite';

import { schema } from './schema';

const sqlite = new DatabaseSync(config.database.filename);
const client = drizzle({ client: sqlite });

export const database = {
  dbClient: client,
  dbSchema: schema
};

export const checkDatabase = (): { ok: boolean; error?: string } => {
  try {
    client.run(sql`SELECT 1`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
};

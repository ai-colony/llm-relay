import { config } from '@lib';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { schema } from './schema';

const sqlite = new Database(config.database.filename);
const client = drizzle({ client: sqlite, schema });

export const database = {
  dbClient: client,
  dbSchema: schema
};

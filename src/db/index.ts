import { Database } from '@andrewitsover/midnight';
import { schema } from './schema';
import { existsSync } from 'fs'

const filename = 'forest.db';
const dbExists = existsSync(filename);

export const db = new Database(filename).getClient(schema);
db.migrate(db.diff(dbExists ? db.getSchema() : []));

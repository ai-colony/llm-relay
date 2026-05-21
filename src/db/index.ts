import { existsSync } from 'node:fs';

import { Database } from '@andrewitsover/midnight';

import { config } from '../config';
import { schema } from './schema';

const filename = config.database.filename;
const databaseExistsAtStartup = existsSync(filename);

export const database = new Database(filename).getClient(schema);
database.migrate(database.diff(databaseExistsAtStartup ? database.getSchema() : []));

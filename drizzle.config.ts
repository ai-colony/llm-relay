import { defineConfig } from 'drizzle-kit';

import { config } from './src/lib';

export default defineConfig({
  dialect: 'sqlite',
  dbCredentials: {
    url: config.database.filename
  },
  schema: './src/db/schema.ts'
});

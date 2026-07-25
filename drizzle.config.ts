import { defineConfig } from 'drizzle-kit';

import { config } from './src/lib';

export default defineConfig({
  dialect: 'sqlite',
  dbCredentials: {
    url: config.database.filename
  },
  schema: './src/db/schema.ts',
  // Explicit rather than relying on the default: the Dockerfile copies ./drizzle into the image and
  // src/index.ts applies migrations from that exact path on startup.
  out: './drizzle'
});

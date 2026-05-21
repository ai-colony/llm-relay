import { config as load } from 'dotenv';
import envVar from 'env-var';

load({ quiet: true });

export const config = {
  database: {
    filename: envVar.get('DATABASE_FILENAME').default('./database.sqlite').asString()
  },
  http: {
    port: envVar.get('PORT').default(3000).asInt()
  }
};

// src/db/index.ts opens a real DatabaseSync(config.database.filename) at module import time, so the
// filename must be mocked to ':memory:' before the module is imported — same technique
// test/helpers/testDatabase.ts uses for its own in-memory setup. Every other test suite mocks '@db'
// away entirely; this file is the one place the real implementation runs.
vi.mock('@lib', () => ({ config: { database: { filename: ':memory:' } } }));

import { checkDatabase, closeDatabase, database } from '../../src/db';

describe('checkDatabase / closeDatabase', () => {
  it('returns ok true against a healthy in-memory database', () => {
    expect(checkDatabase()).toEqual({ ok: true });
  });

  it('exposes the drizzle client and schema', () => {
    expect(database.client).toBeDefined();
    expect(database.schema).toBeDefined();
  });

  it('returns ok false with an error string once the connection has been closed', () => {
    closeDatabase();

    const result = checkDatabase();

    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error).toBeTruthy();
  });
});

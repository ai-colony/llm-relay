import { isUniqueConstraintError, SQLITE_CONSTRAINT_UNIQUE } from '../../src/db/errors';

const sqliteError = (errcode: number) =>
  Object.assign(new Error('UNIQUE constraint failed: prompts.clientName, prompts.requestId'), {
    code: 'ERR_SQLITE_ERROR',
    errcode
  });

describe('isUniqueConstraintError', () => {
  it('detects the error when it is thrown directly', () => {
    expect(isUniqueConstraintError(sqliteError(SQLITE_CONSTRAINT_UNIQUE))).toBe(true);
  });

  it('detects the error through a Drizzle wrapper, which is how it actually arrives', () => {
    const wrapped = new Error('Failed query: insert into "prompts"', {
      cause: sqliteError(SQLITE_CONSTRAINT_UNIQUE)
    });
    expect(isUniqueConstraintError(wrapped)).toBe(true);
  });

  it('detects the error through several layers of wrapping', () => {
    const wrapped = new Error('outer', {
      cause: new Error('middle', { cause: sqliteError(SQLITE_CONSTRAINT_UNIQUE) })
    });
    expect(isUniqueConstraintError(wrapped)).toBe(true);
  });

  it('ignores a different SQLite constraint code', () => {
    expect(isUniqueConstraintError(new Error('wrapped', { cause: sqliteError(787) }))).toBe(false);
  });

  it.each([
    ['a plain error', new Error('database is locked')],
    ['a non-error value', 'boom'],
    ['undefined', undefined]
  ])('returns false for %s', (_label, value) => {
    expect(isUniqueConstraintError(value)).toBe(false);
  });

  it('stops walking instead of looping forever on a deep cause chain', () => {
    let error = new Error('deepest');
    for (let index = 0; index < 20; index += 1) error = new Error(`layer-${index}`, { cause: error });
    expect(isUniqueConstraintError(error)).toBe(false);
  });
});

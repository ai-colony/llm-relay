export const SQLITE_CONSTRAINT_UNIQUE = 2067;

export interface SqliteError extends Error {
  code: string;
  errcode: number;
}

const isSqliteError = (error: unknown): error is SqliteError =>
  error instanceof Error &&
  (error as SqliteError).code === 'ERR_SQLITE_ERROR' &&
  typeof (error as SqliteError).errcode === 'number';

// Drizzle wraps driver failures in a DrizzleQueryError and puts the node:sqlite error on `cause`,
// so the constraint code is never on the error that is actually caught — walk the chain to find it.
export const isUniqueConstraintError = (error: unknown, depth = 0): boolean => {
  if (!(error instanceof Error) || depth > 5) return false;
  if (isSqliteError(error) && error.errcode === SQLITE_CONSTRAINT_UNIQUE) return true;
  return isUniqueConstraintError(error.cause, depth + 1);
};

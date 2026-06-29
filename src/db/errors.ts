export const SQLITE_CONSTRAINT_UNIQUE = 2067;

export interface SqliteError extends Error {
  code: string;
  errcode: number;
}

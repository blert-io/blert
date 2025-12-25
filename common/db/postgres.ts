import { PostgresError } from 'postgres';

const POSTGRES_INVALID_TEXT_REPRESENTATION_CODE = '22P02';
const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';
const POSTGRES_UNDEFINED_COLUMN_CODE = '42703';

const POSTGRES_ERROR_NAME = 'PostgresError';

/**
 * Checks if an error is a Postgres error.
 *
 * @param e Error to check.
 * @returns True if the error is a Postgres error.
 */
export function isPostgresError(e: unknown): e is PostgresError {
  return e instanceof Error && e.name === POSTGRES_ERROR_NAME;
}

function isPostgresErrorCode(e: unknown, code: string): boolean {
  try {
    return isPostgresError(e) && e.code === code;
  } catch {
    return false;
  }
}

export function isPostgresUniqueViolation(e: any) {
  return isPostgresErrorCode(e, POSTGRES_UNIQUE_VIOLATION_CODE);
}

export function isPostgresUndefinedColumn(e: any) {
  return isPostgresErrorCode(e, POSTGRES_UNDEFINED_COLUMN_CODE);
}

export function isPostgresInvalidTextRepresentation(e: any) {
  return isPostgresErrorCode(e, POSTGRES_INVALID_TEXT_REPRESENTATION_CODE);
}

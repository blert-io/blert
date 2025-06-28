const POSTGRES_INVALID_TEXT_REPRESENTATION_CODE = '22P02';
const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';
const POSTGRES_UNDEFINED_COLUMN_CODE = '42703';

const POSTGRES_ERROR_NAME = 'PostgresError';

function isPostgresError(e: any, code: string) {
  try {
    return e.name === POSTGRES_ERROR_NAME && e.code === code;
  } catch (e) {
    return false;
  }
}

export function isPostgresUniqueViolation(e: any) {
  return isPostgresError(e, POSTGRES_UNIQUE_VIOLATION_CODE);
}

export function isPostgresUndefinedColumn(e: any) {
  return isPostgresError(e, POSTGRES_UNDEFINED_COLUMN_CODE);
}

export function isPostgresInvalidTextRepresentation(e: any) {
  return isPostgresError(e, POSTGRES_INVALID_TEXT_REPRESENTATION_CODE);
}

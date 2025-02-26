const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';
const POSTGRES_UNDEFINED_COLUMN_CODE = '42703';

export function isPostgresUniqueViolation(e: any) {
  try {
    return (
      e.name === 'PostgresError' && e.code === POSTGRES_UNIQUE_VIOLATION_CODE
    );
  } catch (e) {
    return false;
  }
}

export function isPostgresUndefinedColumn(e: any) {
  try {
    return (
      e.name === 'PostgresError' && e.code === POSTGRES_UNDEFINED_COLUMN_CODE
    );
  } catch (e) {
    return false;
  }
}

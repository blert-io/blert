const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';

export function isPostgresUniqueViolation(e: any) {
  try {
    return (
      e.name === 'PostgresError' && e.code === POSTGRES_UNIQUE_VIOLATION_CODE
    );
  } catch (e) {
    return false;
  }
}

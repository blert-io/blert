import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  // The original unique index on users.email is case-sensitive, but all
  // application code uses lower(email) for lookups. Fix the index to be
  // case-insensitive to prevent race conditions.
  await sql`DROP INDEX uix_users_email`;

  // Normalize any existing emails to lowercase.
  await sql`UPDATE users SET email = lower(email) WHERE email != lower(email)`;

  await sql`CREATE UNIQUE INDEX uix_users_email ON users (lower(email))`;
}

import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`ALTER TYPE gear_setup_state ADD VALUE IF NOT EXISTS 'unlisted'`;
}

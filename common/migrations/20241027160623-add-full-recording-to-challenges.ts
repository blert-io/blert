import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    ALTER TABLE challenges
    ADD COLUMN full_recording BOOLEAN NOT NULL DEFAULT FALSE;
  `;
}

import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    ALTER TABLE name_changes
    ADD COLUMN skip_checks BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT FALSE;
  `;
}

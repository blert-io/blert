import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm;`;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_players_normalized_username_trgm
    ON players USING gist (normalized_username gist_trgm_ops)
    WHERE NOT starts_with(normalized_username, '*')
  `;
}

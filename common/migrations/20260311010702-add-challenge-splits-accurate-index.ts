import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE INDEX idx_challenge_splits_challenge_id_type
      ON challenge_splits (challenge_id, type)
      WHERE accurate
  `;
}

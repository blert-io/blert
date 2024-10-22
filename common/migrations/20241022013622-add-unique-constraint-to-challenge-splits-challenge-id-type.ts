import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    ALTER TABLE challenge_splits
    ADD CONSTRAINT unique_challenge_id_type UNIQUE (challenge_id, type);
  `;
}

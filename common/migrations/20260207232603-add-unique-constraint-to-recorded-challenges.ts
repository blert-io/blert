import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    ALTER TABLE recorded_challenges
    ADD CONSTRAINT uq_recorded_challenges_challenge_recorder
    UNIQUE (challenge_id, recorder_id)
  `;
}

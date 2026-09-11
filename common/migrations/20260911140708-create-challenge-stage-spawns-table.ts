import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  await sql`
    CREATE TABLE challenge_stage_spawns (
      challenge_id INT NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
      stage SMALLINT NOT NULL,
      spawns SMALLINT[],
      modified BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (challenge_id, stage)
    );
  `;

  await sql`
    CREATE INDEX idx_challenge_stage_spawns_spawns
      ON challenge_stage_spawns USING GIN (spawns);
  `;

  await sql`
    CREATE INDEX idx_challenge_stage_spawns_stage_spawns
      ON challenge_stage_spawns (stage, spawns);
  `;
}

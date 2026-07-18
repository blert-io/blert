import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  await sql`
    CREATE TABLE colosseum_challenge_stats (
      id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      challenge_id INT NOT NULL UNIQUE REFERENCES challenges (id) ON DELETE CASCADE,
      handicaps SMALLINT[] NOT NULL DEFAULT '{}'
    );
  `;

  await sql`
    CREATE INDEX idx_colosseum_challenge_stats_handicaps
      ON colosseum_challenge_stats USING GIN (handicaps);
  `;
}

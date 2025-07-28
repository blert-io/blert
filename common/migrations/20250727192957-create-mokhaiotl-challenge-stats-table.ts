import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE TABLE mokhaiotl_challenge_stats (
      id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      challenge_id INT NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
      delve INT NOT NULL,
      larvae_leaked INT DEFAULT 0
    );
  `;

  await sql`
    CREATE INDEX idx_mokhaiotl_challenge_stats_delve ON mokhaiotl_challenge_stats (delve);
  `;
}

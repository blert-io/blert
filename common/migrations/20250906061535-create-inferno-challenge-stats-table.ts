import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE TABLE inferno_challenge_stats (
      id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      challenge_id INT NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
      wast_pillar_collapse_wave INT,
      east_pillar_collapse_wave INT,
      south_pillar_collapse_wave INT,
      meleer_digs INT DEFAULT 0,
      mager_revives INT DEFAULT 0
    );
  `;
}

import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    ALTER TABLE challenge_players
    ADD COLUMN stage_deaths SMALLINT[] NOT NULL DEFAULT '{}';
  `;
}

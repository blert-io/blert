import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE INDEX idx_challenge_players_player_id_challenge_id
      ON challenge_players (player_id, challenge_id)
  `;
  await sql`
    DROP INDEX idx_challenge_players_player_id
  `;
}

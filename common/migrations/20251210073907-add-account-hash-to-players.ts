import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    ALTER TABLE players
    ADD COLUMN account_hash BIGINT
  `;

  await sql`
    CREATE UNIQUE INDEX uix_players_account_hash
    ON players (account_hash)
    WHERE account_hash IS NOT NULL
  `;
}

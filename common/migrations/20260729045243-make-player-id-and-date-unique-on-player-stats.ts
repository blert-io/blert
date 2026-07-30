import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  await sql`
    CREATE UNIQUE INDEX uix_player_stats_player_id_date
    ON player_stats (player_id, date)
  `;
  await sql`DROP INDEX idx_player_stats_player_id_date`;
}

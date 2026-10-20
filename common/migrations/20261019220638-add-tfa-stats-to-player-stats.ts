import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  await sql`
    ALTER TABLE player_stats ADD COLUMN tfa_completions INT DEFAULT 0;
  `;
  await sql`
    ALTER TABLE player_stats ADD COLUMN tfa_wipes INT DEFAULT 0;
  `;
  await sql`
    ALTER TABLE player_stats ADD COLUMN tfa_resets INT DEFAULT 0;
  `;
}

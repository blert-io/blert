import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  await sql`
    ALTER TABLE tfa_challenge_stats
      ADD COLUMN guardian_down_count SMALLINT
  `;
}

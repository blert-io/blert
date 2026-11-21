import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  await sql`
    ALTER TABLE tfa_challenge_stats
      ADD COLUMN bork_cannonballs_hit SMALLINT,
      ADD COLUMN bork_cannonballs_missed SMALLINT
  `;
}

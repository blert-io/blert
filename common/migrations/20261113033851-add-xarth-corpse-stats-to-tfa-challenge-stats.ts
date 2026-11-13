import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  await sql`
    ALTER TABLE tfa_challenge_stats
      ADD COLUMN xarth_corpses_leaked SMALLINT,
      ADD COLUMN xarth_corpses_ignored SMALLINT,
      ADD COLUMN xarth_corpses_doused SMALLINT,
      ADD COLUMN xarth_p2_blasts SMALLINT
  `;
}

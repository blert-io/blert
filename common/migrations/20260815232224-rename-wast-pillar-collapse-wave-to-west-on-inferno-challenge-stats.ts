import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  await sql`
    ALTER TABLE inferno_challenge_stats
    RENAME COLUMN wast_pillar_collapse_wave TO west_pillar_collapse_wave;
  `;
}

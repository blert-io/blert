import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  await sql`
    ALTER TABLE challenge_stage_spawns
      ADD COLUMN player SMALLINT;
  `;
}

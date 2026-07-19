import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  await sql`
    CREATE TABLE challenge_processing_state (
      challenge_id INT PRIMARY KEY REFERENCES challenges (id) ON DELETE CASCADE,
      processed_seq BIGINT NOT NULL,
      outcome_status SMALLINT,
      outcome_ticks INT,
      finalized_seq BIGINT,
      custom_data JSONB
    );
  `;
}

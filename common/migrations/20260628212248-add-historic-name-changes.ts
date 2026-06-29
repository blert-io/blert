import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  await sql`
    ALTER TABLE name_changes
    ADD COLUMN kind SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN effective_from TIMESTAMPTZ,
    ADD COLUMN effective_to TIMESTAMPTZ,
    ADD COLUMN sequence_id UUID,
    ADD COLUMN hidden_from_profile BOOLEAN NOT NULL DEFAULT FALSE
  `;

  await sql`
    ALTER TABLE name_changes RENAME COLUMN hidden TO hidden_from_feed
  `;

  // The old `hidden` column hid a name change from both the feed and player
  // profiles. Preserve that for existing rows: anything hidden before stays
  // hidden from profiles too, rather than reappearing under the new default.
  await sql`
    UPDATE name_changes
    SET hidden_from_profile = TRUE
    WHERE hidden_from_feed = TRUE
  `;

  await sql`
    UPDATE name_changes
    SET effective_from = COALESCE(processed_at, submitted_at)
    WHERE effective_from IS NULL
  `;

  await sql`
    ALTER TABLE name_changes ALTER COLUMN effective_from SET NOT NULL
  `;

  await sql`
    ALTER TABLE name_changes ADD CONSTRAINT name_changes_kind_columns_valid
    CHECK (
      (effective_to IS NULL OR effective_from < effective_to)
      AND (
        (kind = 0 AND sequence_id IS NULL)
        OR (kind = 1
          AND effective_to IS NOT NULL
          AND sequence_id IS NOT NULL)
      )
    )
  `;

  await sql`
    CREATE INDEX idx_name_changes_sequence_id
      ON name_changes (sequence_id) WHERE sequence_id IS NOT NULL
  `;

  await sql`
    CREATE INDEX idx_name_changes_effective_from
      ON name_changes (effective_from DESC)
  `;
}

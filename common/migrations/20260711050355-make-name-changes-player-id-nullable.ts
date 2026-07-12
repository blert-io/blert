import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  // Historic name changes don't have player ids when inserted.
  await sql`
    ALTER TABLE name_changes ALTER COLUMN player_id DROP NOT NULL
  `;

  await sql`
    ALTER TABLE name_changes ADD CONSTRAINT name_changes_effective_dates_ordered
    CHECK (effective_to IS NULL OR effective_from < effective_to)
  `;

  await sql`
    ALTER TABLE name_changes DROP CONSTRAINT name_changes_kind_columns_valid
  `;
  await sql`
    ALTER TABLE name_changes ADD CONSTRAINT name_changes_kind_columns_valid
    CHECK (
      (kind = 0 AND player_id IS NOT NULL AND sequence_id IS NULL)
      OR (kind = 1 AND sequence_id IS NOT NULL)
    )
  `;

  // Exempt zombies from username uniqueness.
  await sql`DROP INDEX uix_players_username`;
  await sql`
    CREATE UNIQUE INDEX uix_players_username ON players (normalized_username)
    WHERE NOT starts_with(normalized_username, '*')
  `;
}

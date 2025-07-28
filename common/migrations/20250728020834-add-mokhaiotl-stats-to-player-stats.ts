import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    ALTER TABLE player_stats ADD COLUMN mokhaiotl_completions INT DEFAULT 0;
  `;
  await sql`
    ALTER TABLE player_stats ADD COLUMN mokhaiotl_wipes INT DEFAULT 0;
  `;
  await sql`
    ALTER TABLE player_stats ADD COLUMN mokhaiotl_resets INT DEFAULT 0;
  `;
  await sql`
    ALTER TABLE player_stats ADD COLUMN mokhaiotl_total_delves INT DEFAULT 0;
  `;
}

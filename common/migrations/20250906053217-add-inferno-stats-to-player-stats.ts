import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    ALTER TABLE player_stats ADD COLUMN inferno_completions INT DEFAULT 0;
  `;
  await sql`
    ALTER TABLE player_stats ADD COLUMN inferno_wipes INT DEFAULT 0;
  `;
  await sql`
    ALTER TABLE player_stats ADD COLUMN inferno_resets INT DEFAULT 0;
  `;
}

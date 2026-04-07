import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    UPDATE queryable_events
    SET custom_short_2 = custom_short_2 - 1
    WHERE event_type = 110
  `;
}

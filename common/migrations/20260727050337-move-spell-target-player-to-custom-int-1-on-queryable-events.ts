import { TransactionSql } from 'postgres';

import { EventType } from '../event';

export async function migrate(sql: TransactionSql) {
  await sql`
    UPDATE queryable_events
    SET custom_int_1 = custom_short_1, custom_short_1 = NULL
    WHERE event_type = ${EventType.PLAYER_SPELL} AND custom_short_1 IS NOT NULL
  `;
}

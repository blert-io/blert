import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    ALTER TABLE gear_setups
    ADD COLUMN scale SMALLINT NOT NULL DEFAULT 1;
  `;

  await sql`
    CREATE INDEX idx_gear_setups_scale ON gear_setups (scale);
  `;
}

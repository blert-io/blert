import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE TYPE gear_setup_item_category AS ENUM ('melee', 'ranged', 'magic', 'supplies', 'utility', 'runes')
  `;

  await sql`
    CREATE TABLE user_custom_items (
      id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      setup_id INT REFERENCES gear_setups (id) ON DELETE CASCADE,
      item_id INT NOT NULL,
      category gear_setup_item_category NOT NULL,
      is_added BOOLEAN NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, setup_id, category, item_id, is_added)
    )
  `;

  await sql`
    CREATE INDEX idx_user_custom_items_user_id_setup_id ON user_custom_items(user_id, setup_id)
  `;
}

import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  const [treasury, sink] = await sql<{ id: number }[]>`
    INSERT INTO blertcoin_accounts (owner_user_id, kind)
    VALUES
      (NULL, 'treasury'),
      (NULL, 'sink')
    RETURNING id
  `;

  await sql`
    INSERT INTO blertcoin_account_balances (account_id, balance)
    VALUES
      (${treasury.id}, 0),
      (${sink.id}, 0)
  `;

  await sql`
    INSERT INTO blertcoin_system_accounts (name, account_id)
    VALUES
      ('treasury', ${treasury.id}),
      ('purchases', ${sink.id})
  `;
}

import { Sql } from 'postgres';

import { applySqlFile } from './util';

export async function migrate(sql: Sql) {
  await applySqlFile(sql, 'post_blertcoin_transaction/20251115-initial.sql');
}

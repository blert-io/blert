import { distToSrc } from '@blert/common/dist/migrations';
import { promises as fs } from 'fs';
import path from 'path';
import type { Sql } from 'postgres';

/**
 * Applies a SQL file to the database.
 *
 * @param tx Database transaction to which to apply the SQL file.
 * @param relativePath Path of the file relative to the `sql` directory.
 */
export async function applySqlFile(
  tx: Sql,
  relativePath: string,
): Promise<void> {
  const fullPath = path.join(distToSrc(__dirname), '..', 'sql', relativePath);
  const sqlText = await fs.readFile(fullPath, 'utf8');
  await tx.unsafe(sqlText);
}

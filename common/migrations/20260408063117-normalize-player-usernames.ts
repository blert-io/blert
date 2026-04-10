import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  // Widen username to allow headroom beyond the 12-char OSRS limit
  // (e.g. the * zombie prefix).
  await sql`
    ALTER TABLE players
    ALTER COLUMN username TYPE VARCHAR(16)
  `;

  // Add the new column and backfill.
  await sql`
    ALTER TABLE players
    ADD COLUMN normalized_username VARCHAR(16)
  `;
  await sql`
    UPDATE players
    SET normalized_username = translate(lower(username), ' -', '__')
  `;

  const collisions = await sql<
    { normalized_username: string; count: string }[]
  >`
    SELECT normalized_username, COUNT(*) as count
    FROM players
    GROUP BY normalized_username
    HAVING COUNT(*) > 1
  `;

  if (collisions.length > 0) {
    const details = collisions
      .map((c) => `  ${c.normalized_username} (${c.count} rows)`)
      .join('\n');
    throw new Error(
      `Cannot create unique index: ${collisions.length} normalized username collision(s) found.\n` +
        `Resolve these manually before re-running the migration:\n${details}`,
    );
  }

  await sql`
    ALTER TABLE players
    ALTER COLUMN normalized_username SET NOT NULL
  `;

  await sql`DROP INDEX uix_players_username`;

  await sql`
    CREATE UNIQUE INDEX uix_players_username
    ON players (normalized_username)
  `;
}

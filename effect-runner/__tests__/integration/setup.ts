import { afterAll, beforeAll } from '@jest/globals';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load test environment variables before anything else.
config({ path: resolve(__dirname, '../../.env.test'), quiet: true });

import { connect } from '../../db';
import { EffectEventKind, EffectSubject } from '../../effects';

export const sql = connect(process.env.BLERT_TEST_DATABASE_URI!);

/** Truncates the tables tests write to, resetting state between them.  */
export async function truncateTables(): Promise<void> {
  await sql`
    TRUNCATE TABLE
      effect_deliveries, effect_events, effect_handlers, challenges, players
    RESTART IDENTITY CASCADE
  `;
}

/**
 * Inserts an effect event, deriving its idempotency key from the given subject.
 * @param kind Kind of the event.
 * @param subject Subject of the event.
 * @param createdAt Optional creation time of the event; defaults to `NOW()`.
 * @returns The id of the inserted event.
 */
export async function insertEvent<K extends EffectEventKind>(
  kind: K,
  subject: EffectSubject[K],
  createdAt?: Date,
): Promise<bigint> {
  const [row] = await sql<{ id: bigint }[]>`
    INSERT INTO effect_events (kind, subject, key, created_at)
    VALUES (
      ${kind},
      ${sql.json(subject)},
      ${eventKey(kind, subject)},
      ${createdAt ?? sql`NOW()`}
    )
    RETURNING id
  `;
  return row.id;
}

function eventKey<K extends EffectEventKind>(
  kind: K,
  subject: EffectSubject[K],
): string {
  switch (kind) {
    case EffectEventKind.CHALLENGE_FINISHED:
      return subject.uuid;
    case EffectEventKind.STAGE_FINISHED: {
      const { uuid, stage, attempt } =
        subject as EffectSubject[EffectEventKind.STAGE_FINISHED];
      return attempt === null
        ? `${uuid}:${stage}`
        : `${uuid}:${stage}:${attempt}`;
    }
  }
}

beforeAll(async () => {
  await truncateTables();
});

afterAll(async () => {
  await sql.end();
});

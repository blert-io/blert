import postgres from 'postgres';
import { parseArgs } from 'util';

import { ChallengeMode } from '../challenge';
import { adjustSplitForMode, SplitType } from '../split';

const VERZIK_P1_TRANSITION_TICKS = 13;

const TOB_MODES = [
  ChallengeMode.TOB_ENTRY,
  ChallengeMode.TOB_REGULAR,
  ChallengeMode.TOB_HARD,
];

export async function scriptMain(sql: postgres.Sql, args: string[]) {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
    },
    args,
  });

  for (const mode of TOB_MODES) {
    const reds = adjustSplitForMode(SplitType.TOB_VERZIK_REDS, mode);
    const p1End = adjustSplitForMode(SplitType.TOB_VERZIK_P1_END, mode);
    const redsPush = adjustSplitForMode(SplitType.TOB_VERZIK_REDS_PUSH, mode);

    const source = sql`
      FROM challenge_splits reds
      JOIN challenge_splits p1_end
        ON p1_end.challenge_id = reds.challenge_id
        AND p1_end.type = ${p1End}
      WHERE reds.type = ${reds}
        AND reds.ticks > p1_end.ticks + ${VERZIK_P1_TRANSITION_TICKS}
        AND NOT EXISTS (
          SELECT 1
          FROM challenge_splits reds_push
          WHERE reds_push.challenge_id = reds.challenge_id
            AND reds_push.type = ${redsPush}
        )
    `;

    if (values['dry-run']) {
      const [{ count }] = await sql<{ count: string }[]>`
        SELECT COUNT(*) AS count ${source}
      `;
      console.log(`${SplitType[redsPush]}: would insert ${count} splits`);
    } else {
      const inserted = await sql`
        INSERT INTO challenge_splits (challenge_id, type, scale, ticks, accurate)
        SELECT
          reds.challenge_id,
          ${redsPush},
          reds.scale,
          reds.ticks - p1_end.ticks - ${VERZIK_P1_TRANSITION_TICKS},
          reds.accurate AND p1_end.accurate
        ${source}
      `;
      console.log(`${SplitType[redsPush]}: inserted ${inserted.count} splits`);
    }
  }
}

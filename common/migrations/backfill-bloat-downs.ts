import postgres from 'postgres';
import { parseArgs } from 'util';

import { dataRepositoryFromEnv } from './script-helpers';
import { ChallengeType, TobRooms } from '../challenge';
import { SplitType } from '../split';

const BLOAT_SPLIT_TYPES = [
  SplitType.TOB_ENTRY_BLOAT,
  SplitType.TOB_REG_BLOAT,
  SplitType.TOB_HM_BLOAT,
];

// The number of ticks between consecutive down ticks that are not walk time:
// 32t down + 1t standing up animation + 1t stationary before next down.
const INTER_DOWN_OVERHEAD = 34;

type TobChallengeWithAccuracy = {
  id: number;
  uuid: string;
  accurate: boolean;
};

export async function scriptMain(sql: postgres.Sql, args: string[]) {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      'batch-size': { type: 'string', default: '100' },
      'start-id': { type: 'string' },
      'end-id': { type: 'string' },
    },
    args,
  });

  const dryRun = values['dry-run'];
  const batchSize = parseInt(values['batch-size']);
  const startId = values['start-id'] ? parseInt(values['start-id']) : undefined;
  const endId = values['end-id'] ? parseInt(values['end-id']) : undefined;

  const dataRepository = dataRepositoryFromEnv();

  let lastId = startId !== undefined ? startId - 1 : 0;
  let challengesProcessed = 0;

  const startTime = process.hrtime.bigint();

  const totalChallenges = await sql`
    SELECT COUNT(*)
    FROM challenges c
    JOIN challenge_splits cs
      ON cs.challenge_id = c.id
      AND cs.type = ANY(${BLOAT_SPLIT_TYPES})
    WHERE c.type = ${ChallengeType.TOB}
      AND c.id > ${lastId}
      ${endId !== undefined ? sql`AND c.id <= ${endId}` : sql``}
  `.then(([row]) => Number(row.count));

  while (true) {
    const challenges = await sql<readonly TobChallengeWithAccuracy[]>`
      SELECT c.id, c.uuid, cs.accurate
      FROM challenges c
      JOIN challenge_splits cs
        ON cs.challenge_id = c.id
        AND cs.type = ANY(${BLOAT_SPLIT_TYPES})
      WHERE c.type = ${ChallengeType.TOB}
        AND c.id > ${lastId}
        ${endId !== undefined ? sql`AND c.id <= ${endId}` : sql``}
      ORDER BY c.id ASC
      LIMIT ${batchSize}
    `;

    if (challenges.length === 0) {
      break;
    }

    const promises = challenges.map(async (challenge) => {
      let rooms: TobRooms;
      try {
        rooms = await dataRepository.loadTobChallengeData(challenge.uuid);
      } catch (error) {
        console.error(`Error loading challenge ${challenge.id}:`, error);
        return;
      }

      if (rooms.bloat === null) {
        return;
      }

      const downTicks = rooms.bloat.downTicks;

      const rows = downTicks.map((tick, i) => ({
        challenge_id: challenge.id,
        down_number: i + 1,
        down_tick: tick,
        walk_ticks:
          i === 0 ? tick : tick - downTicks[i - 1] - INTER_DOWN_OVERHEAD,
        accurate: challenge.accurate,
      }));

      if (dryRun) {
        console.log(
          `Challenge ${challenge.id}: ${rows.length} downs, accurate=${challenge.accurate}`,
          rows.map(
            (r) => `d${r.down_number}@${r.down_tick} walk=${r.walk_ticks}`,
          ),
        );
      } else {
        if (rows.length > 0) {
          await sql`
            INSERT INTO bloat_downs ${sql(rows)}
            ON CONFLICT (challenge_id, down_number) DO NOTHING
          `;
        }

        await sql`
          UPDATE tob_challenge_stats
          SET bloat_down_count = ${downTicks.length}
          WHERE challenge_id = ${challenge.id}
        `;
      }
    });

    await Promise.all(promises);

    challengesProcessed += challenges.length;
    lastId = challenges[challenges.length - 1].id;

    const elapsed = Number(process.hrtime.bigint() - startTime) / 1e9;
    const minutes = Math.floor(elapsed / 60);
    const seconds = (elapsed % 60).toFixed(2);
    console.log(
      `Processed ${challengesProcessed} of ${totalChallenges} challenges in ${minutes}:${seconds.padStart(5, '0')}`,
    );
  }

  console.log(`Completed. ${challengesProcessed} challenges processed.`);
}

import postgres from 'postgres';
import { parseArgs } from 'util';

import { ChallengeSplitRow } from '../db/challenge';
import { SplitType } from '../split';

export async function scriptMain(sql: postgres.Sql, args: string[]) {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
    },
    args,
  });

  const dryRun = values['dry-run'];

  if (!dryRun) {
    await sql`TRUNCATE TABLE personal_best_history`;
  }

  const stats = {
    totalChallenges: 0,
    withPBs: 0,
    withoutPBs: 0,
  };

  // Player ID -> Split Type -> Scale -> Ticks
  const pbsByPlayerId = new Map<number, Map<SplitType, Map<number, number>>>();

  let idCursor = 0;
  let startTimeCursor = new Date(0);

  while (true) {
    const [challenge] = await sql<
      { id: number; start_time: Date; finish_time: Date }[]
    >`
      SELECT id, start_time, finish_time
      FROM challenges c
      WHERE (c.start_time, c.id) > (${startTimeCursor}, ${idCursor})
      ORDER BY c.start_time ASC, c.id ASC
      LIMIT 1
    `;

    if (challenge === undefined) {
      break;
    }

    idCursor = challenge.id;
    startTimeCursor = challenge.start_time;

    const playersQuery = sql<{ id: number; username: string }[]>`
      SELECT player_id AS id, username
      FROM challenge_players
      WHERE challenge_id = ${challenge.id}
    `;

    const splitsQuery = sql<ChallengeSplitRow[]>`
      SELECT *
      FROM challenge_splits
      WHERE challenge_id = ${challenge.id}
    `;

    const [splits, players] = await Promise.all([splitsQuery, playersQuery]);

    if (splits.length === 0) {
      console.warn(`No splits found for challenge ${challenge.id}`);
      continue;
    }

    const pbsToCreate: {
      player_id: number;
      challenge_split_id: number;
      created_at: Date;
    }[] = [];

    for (const split of splits) {
      if (!split.accurate) {
        continue;
      }

      for (const player of players) {
        const pb = pbsByPlayerId
          .get(player.id)
          ?.get(split.type)
          ?.get(split.scale);
        if (pb === undefined || split.ticks < pb) {
          if (!pbsByPlayerId.has(player.id)) {
            pbsByPlayerId.set(player.id, new Map());
          }
          const splitMap = pbsByPlayerId.get(player.id)!;
          if (!splitMap.has(split.type)) {
            splitMap.set(split.type, new Map());
          }

          splitMap.get(split.type)!.set(split.scale, split.ticks);

          pbsToCreate.push({
            player_id: player.id,
            challenge_split_id: split.id,
            created_at: challenge.finish_time,
          });
        }
      }
    }

    stats.totalChallenges++;

    if (pbsToCreate.length > 0) {
      stats.withPBs++;

      if (dryRun) {
        console.log(
          `Inserting ${pbsToCreate.length} PBs for challenge ${challenge.id}`,
        );
      } else {
        await sql`INSERT INTO personal_best_history ${sql(pbsToCreate)}`;
      }
    } else {
      stats.withoutPBs++;
      if (dryRun) {
        console.log(`No new PBs for challenge ${challenge.id}`);
      }
    }
  }

  console.log(
    `Processed ${stats.totalChallenges} challenges, ${stats.withPBs} with PBs, ${stats.withoutPBs} without PBs`,
  );
}

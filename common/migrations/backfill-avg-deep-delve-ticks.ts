import postgres from 'postgres';
import { parseArgs } from 'util';

import {
  dataRepositoryFromEnv,
  forEachChallengeWithData,
} from './script-helpers';
import {
  ChallengeStatus,
  ChallengeType,
  MokhaiotlData,
  Stage,
} from '../challenge';

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

  const dataRepository = dataRepositoryFromEnv();

  const options = {
    batchSize: parseInt(values['batch-size']),
    startId: values['start-id'] ? parseInt(values['start-id']) : undefined,
    endId: values['end-id'] ? parseInt(values['end-id']) : undefined,
    types: [ChallengeType.MOKHAIOTL],
  };

  await forEachChallengeWithData(
    sql,
    dataRepository,
    async (challenge, data) => {
      if (challenge.status === ChallengeStatus.IN_PROGRESS) {
        return;
      }
      const [stats] = await sql<{ max_completed_delve: number }[]>`
        SELECT max_completed_delve
        FROM mokhaiotl_challenge_stats
        WHERE challenge_id = ${challenge.id}
      `;
      if (stats === undefined) {
        return;
      }

      const deepDelves = (data as MokhaiotlData).delves.filter(
        (delve) =>
          delve.stage === Stage.MOKHAIOTL_DELVE_8PLUS &&
          delve.delve <= stats.max_completed_delve,
      );
      if (deepDelves.length === 0) {
        return;
      }

      const totalTicks = deepDelves.reduce(
        (total, delve) => total + delve.challengeTicks,
        0,
      );
      const avgDeepDelveTicks = Math.round(totalTicks / deepDelves.length);

      if (dryRun) {
        console.log(
          `Setting avg_deep_delve_ticks for challenge ${challenge.id} [${challenge.uuid}] to ${avgDeepDelveTicks}`,
        );
        return;
      }

      await sql`
        UPDATE mokhaiotl_challenge_stats
        SET avg_deep_delve_ticks = ${avgDeepDelveTicks}
        WHERE challenge_id = ${challenge.id}
      `;
    },
    options,
  );
}

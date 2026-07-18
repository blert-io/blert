import postgres from 'postgres';
import { parseArgs } from 'util';

import {
  dataRepositoryFromEnv,
  forEachChallengeWithData,
} from './script-helpers';
import {
  ChallengeType,
  ColosseumData,
  handicapBase,
  handicapLevel,
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
    types: [ChallengeType.COLOSSEUM],
  };

  await forEachChallengeWithData(
    sql,
    dataRepository,
    async (challenge, data) => {
      // Expand the computed handicaps array into raw selections.
      const handicaps = (data as ColosseumData).handicaps.flatMap((handicap) =>
        Array<number>(handicapLevel(handicap)).fill(handicapBase(handicap)),
      );

      if (dryRun) {
        console.log(
          `Setting handicaps for challenge ${challenge.id} [${challenge.uuid}] to`,
          handicaps,
        );
        return;
      }

      // Create a stats row for historic runs without one, ignoring challenges
      // recorded later which would have a live populated row.
      await sql`
        INSERT INTO colosseum_challenge_stats (challenge_id, handicaps)
        VALUES (${challenge.id}, ${handicaps}::smallint[])
        ON CONFLICT (challenge_id) DO NOTHING
      `;
    },
    options,
  );
}

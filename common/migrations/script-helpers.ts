import { S3Client } from '@aws-sdk/client-s3';
import { Sql } from 'postgres';

import { DataRepository } from '../data-repository/data-repository';
import { ChallengeType, ColosseumData, TobRooms } from '../challenge';
import { ChallengeRow } from '../db/challenge';

/**
 * Initializes a data repository from the BLERT_DATA_REPOSITORY environment
 * variable.
 *
 * @returns Initialized data repository.
 * @throws Error if the environment variable is not set or the URI is invalid.
 */
export function dataRepositoryFromEnv(): DataRepository {
  if (!process.env.BLERT_DATA_REPOSITORY) {
    throw new Error('BLERT_DATA_REPOSITORY is not set');
  }

  const uri = process.env.BLERT_DATA_REPOSITORY;
  if (uri.startsWith('file://')) {
    const root = uri.slice('file://'.length);
    return new DataRepository(new DataRepository.FilesystemBackend(root));
  }

  if (uri.startsWith('s3://')) {
    const s3Client = new S3Client({
      forcePathStyle: false,
      region: process.env.BLERT_REGION,
      endpoint: process.env.BLERT_ENDPOINT,
      credentials: {
        accessKeyId: process.env.BLERT_ACCESS_KEY_ID!,
        secretAccessKey: process.env.BLERT_SECRET_ACCESS_KEY!,
      },
    });
    const bucket = uri.slice('s3://'.length);
    return new DataRepository(new DataRepository.S3Backend(s3Client, bucket));
  }

  throw new Error(`Unknown repository backend: ${uri}`);
}

function formatDuration(nanoseconds: bigint): string {
  const seconds = Number(nanoseconds) / 1e9;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toFixed(2).padStart(5, '0')}`;
}

type ForEachChallengeOptions = {
  /** Number of challenges to process concurrently. */
  batchSize?: number;
  /** First challenge ID to process. */
  startId?: number;
  /** Last challenge ID to process. */
  endId?: number;
  /** Whether to log progress. Defaults to true. */
  log?: boolean;
};

/**
 * Loads every challenge record from the database, then fetches its static data
 * from the data repository and invokes a callback with both.
 *
 * Challenges are loaded in order of database ID, which may not be the same as
 * their chronological order (start_time). Additionally, when `batchSize > 1`
 * (highly recommended), the callback is invoked multiple times concurrently,
 * so it is not safe to assume any ordering of challenges.
 *
 * This is a very long operation (hours) intended for data backfill scripts.
 *
 * @param sql Active database connection.
 * @param dataRepository Challenge data repository.
 * @param callback Callback to invoke on each challenge.
 * @param options Options for the iteration.
 */
export async function forEachChallengeWithData(
  sql: Sql,
  dataRepository: DataRepository,
  callback: (
    challenge: ChallengeRow,
    data: TobRooms | ColosseumData,
  ) => Promise<void>,
  options: ForEachChallengeOptions = {},
) {
  const { batchSize = 100, startId, endId, log = true } = options;

  // Initialize to -1 so make it inclusive of startId.
  let lastId = startId !== undefined ? startId - 1 : 0;
  let challengesProcessed = 0;

  const startTime = process.hrtime.bigint();

  const logProgress = (message: string) => {
    if (log) {
      console.log(message);
    }
  };

  const totalChallenges = await sql`
    SELECT COUNT(*)
    FROM challenges
    WHERE id > ${lastId}
    ${endId !== undefined ? sql`AND id <= ${endId}` : sql``}
  `.then(([row]) => Number(row.count));

  while (true) {
    const challenges = await sql<readonly ChallengeRow[]>`
      SELECT *
      FROM challenges
      WHERE id > ${lastId}
      ${endId !== undefined ? sql`AND id <= ${endId}` : sql``}
      ORDER BY id ASC
      LIMIT ${batchSize}
    `;

    if (challenges.length === 0) {
      break;
    }

    const promises = challenges.map(async (challenge) => {
      let data: TobRooms | ColosseumData;
      switch (challenge.type) {
        case ChallengeType.TOB:
          data = await dataRepository.loadTobChallengeData(challenge.uuid);
          break;
        case ChallengeType.COLOSSEUM:
          data = await dataRepository.loadColosseumChallengeData(
            challenge.uuid,
          );
          break;
        default:
          return;
      }

      try {
        await callback(challenge, data);
      } catch (error) {
        console.error(`Error processing challenge ${challenge.id}:`, error);
      }
    });

    await Promise.all(promises);

    challengesProcessed += challenges.length;
    lastId = challenges[challenges.length - 1].id;
    logProgress(
      `Processed ${challengesProcessed} of ${totalChallenges} challenges in ${formatDuration(
        process.hrtime.bigint() - startTime,
      )}`,
    );
  }

  logProgress(
    `Completed in ${formatDuration(process.hrtime.bigint() - startTime)}`,
  );
}

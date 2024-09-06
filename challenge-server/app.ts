import { S3Client } from '@aws-sdk/client-s3';
import { DataRepository, Stage, TobRooms } from '@blert/common';
import { ChallengeEvents } from '@blert/common/generated/challenge_storage_pb';
import dotenv from 'dotenv';
import express from 'express';

import { ClientEvents } from './client-events';
import sql from './db';
import logger from './log';
import { ChallengeInfo, Merger } from './merge';

/**
 * Initializes the repository for Blert's static challenge data files, with a
 * backend set based on the BLERT_DATA_REPOSITORY environment variable.
 * @returns The initialized data repository.
 */
function initializeDataRepository(envVar: string): DataRepository {
  let repositoryBackend: DataRepository.Backend;
  if (!process.env[envVar]) {
    throw new Error(`${envVar} is not set`);
  }

  const repositoryUri = process.env[envVar]!;

  if (repositoryUri.startsWith('file://')) {
    const root = repositoryUri.slice('file://'.length);
    logger.info(`DataRepository using filesystem backend at ${root}`);
    repositoryBackend = new DataRepository.FilesystemBackend(root);
  } else if (repositoryUri.startsWith('s3://')) {
    const s3Client = new S3Client({
      forcePathStyle: false,
      region: process.env.BLERT_REGION,
      endpoint: process.env.BLERT_ENDPOINT,
      credentials: {
        accessKeyId: process.env.BLERT_ACCESS_KEY_ID!,
        secretAccessKey: process.env.BLERT_SECRET_ACCESS_KEY!,
      },
    });
    const bucket = repositoryUri.slice('s3://'.length);
    logger.info(`DataRepository using S3 backend bucket ${bucket}`);
    repositoryBackend = new DataRepository.S3Backend(s3Client, bucket);
  } else {
    throw new Error(`Unknown repository backend type: ${repositoryUri}`);
  }

  return new DataRepository(repositoryBackend);
}

async function main() {
  dotenv.config({ path: ['.env.local', `.env.${process.env.NODE_ENV}`] });

  const app = express();
  const port = process.env.PORT || 3009;

  const challengeDataRepository = initializeDataRepository(
    'BLERT_DATA_REPOSITORY',
  );
  const testDataRepository = initializeDataRepository(
    'BLERT_CLIENT_DATA_REPOSITORY',
  );

  app.get('/ping', (_req, res) => {
    res.send('pong');
  });

  app.post('/test/:challengeId', async (req, res) => {
    // Processes challenge data stored in the testing data repository.
    // Each top-level directory in the repository is a challenge ID. Inside, it
    // contains a subdirectory for each recorded stage of the challenge, which
    // stores the raw recorded events for each client as serialized protobuf
    // files.
    const challengeId = req.params.challengeId;
    const challengeFiles = await testDataRepository.listFiles(challengeId);
    if (challengeFiles.length === 0) {
      res.status(404).send();
      return;
    }

    const [challengeInfo] = await sql`
      SELECT id, stage, status, type, uuid
      FROM challenges
      WHERE uuid = ${challengeId}
    `;
    if (!challengeInfo) {
      res.status(404).send();
      return;
    }

    const party = await sql`
      SELECT challenge_players.username
      FROM challenges
      JOIN challenge_players ON challenges.id = challenge_players.challenge_id
      WHERE uuid = ${challengeId}
      ORDER BY challenge_players.orb
    `.then((rows) => rows.map((row) => row.username));

    challengeInfo.party = party;

    const streamsByStage = new Map<string, Map<string, ClientEvents>>();

    await Promise.all(
      challengeFiles.map((file) =>
        testDataRepository.loadRaw(file).then((data) => {
          const events = ChallengeEvents.deserializeBinary(data);
          const [_uuid, stage, clientId] = file.split('/');

          if (!streamsByStage.has(stage)) {
            streamsByStage.set(stage, new Map());
          }

          streamsByStage
            .get(stage)!
            .set(
              clientId,
              ClientEvents.fromRawEvents(
                Number.parseInt(clientId),
                challengeInfo as ChallengeInfo,
                Number.parseInt(stage),
                events.getEventsList(),
              ),
            );
        }),
      ),
    );

    const fakeTobRooms: TobRooms = {
      maiden: null,
      bloat: null,
      nylocas: null,
      sotetseg: null,
      xarpus: null,
      verzik: null,
    };

    for (const [stageStr, streams] of streamsByStage) {
      const stage = Number.parseInt(stageStr) as Stage;

      const merger = new Merger(
        challengeInfo as ChallengeInfo,
        stage,
        Array.from(streams.values()),
      );

      const result = merger.merge();
      if (result !== null) {
        // Temporarily write directly to the data repository for debugging.
        // TODO(frolv): Merged events should be forwarded to a `Challenge` for
        // processing.
        challengeDataRepository.saveProtoStageEvents(
          challengeId,
          stage,
          challengeInfo.party,
          Array.from(result.events),
        );

        const fakeStageData = (additionalFields?: any) => ({
          stage,
          deaths: [],
          npcs: [],
          ticksLost: result.events.missingTicks(),
          ...additionalFields,
        });

        switch (stage) {
          case Stage.TOB_MAIDEN:
            fakeTobRooms.maiden = fakeStageData();
            break;
          case Stage.TOB_BLOAT:
            fakeTobRooms.bloat = fakeStageData({ downTicks: [] });
            break;
          case Stage.TOB_NYLOCAS:
            fakeTobRooms.nylocas = fakeStageData({ stalledWaves: [] });
            break;
          case Stage.TOB_SOTETSEG:
            fakeTobRooms.sotetseg = fakeStageData({
              maze1Pivots: [],
              maze2Pivots: [],
            });
            break;
          case Stage.TOB_XARPUS:
            fakeTobRooms.xarpus = fakeStageData();
            break;
          case Stage.TOB_VERZIK:
            fakeTobRooms.verzik = fakeStageData({ redsSpawnCount: 1 });
            break;
        }
      } else {
        logger.error(`Failed to merge events for stage ${stage}`);
      }
    }

    challengeDataRepository.saveTobChallengeData(challengeId, fakeTobRooms);

    res.status(200).send();
  });

  app.listen(port, () => {
    logger.info(`Challenge server started on port ${port}`);
  });
}

main();

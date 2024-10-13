import {
  ChallengeMode,
  ChallengeType,
  RecordingType,
  Stage,
  StageStatus,
  TobRooms,
} from '@blert/common';
import { ChallengeEvents } from '@blert/common/generated/challenge_storage_pb';
import { Application, Request, Response } from 'express';

import {
  ChallengeError,
  ChallengeErrorType,
  ChallengeUpdate,
} from './challenge-manager';
import { ClientEvents, StageInfo } from './client-events';
import sql from './db';
import { ReportedTimes } from './event-processing';
import logger from './log';
import { ChallengeInfo, Merger } from './merge';

export function registerApiRoutes(app: Application): void {
  app.get('/ping', (_req, res) => {
    res.send('pong');
  });

  app.post('/challenges/new', newChallenge);
  app.post('/challenges/:challengeId', updateChallenge);
  app.post('/challenges/:challengeId/finish', finishChallenge);
  app.post('/challenges/:challengeId/join', joinChallenge);
  app.post('/test/:challengeId', mergeTestEvents);
}

function errorStatus(e: Error): number {
  if (e instanceof ChallengeError) {
    const err = e as ChallengeError;
    switch (err.type) {
      case ChallengeErrorType.FAILED_PRECONDITION:
        return 400;
      case ChallengeErrorType.UNSUPPORTED:
        return 422;
    }
  }

  return 500;
}

type NewChallengeRequest = {
  userId: number;
  type: ChallengeType;
  mode: ChallengeMode;
  stage: Stage;
  party: string[];
  recordingType: RecordingType;
};

async function newChallenge(req: Request, res: Response): Promise<void> {
  const request = req.body as NewChallengeRequest;

  try {
    const challengeId = await res.locals.challengeManager.getOrCreate(
      request.userId,
      request.type,
      request.mode,
      request.stage,
      request.party,
      request.recordingType,
    );
    res.json({ challengeId });
  } catch (e: any) {
    logger.error(`Failed to create challenge: ${e}`);
    res.status(errorStatus(e)).send();
  }
}

type UpdateChallengeRequest = {
  userId: number;
  update: ChallengeUpdate;
};

async function updateChallenge(req: Request, res: Response): Promise<void> {
  try {
    const challengeId = req.params.challengeId;
    const request = req.body as UpdateChallengeRequest;

    const ok = await res.locals.challengeManager.update(
      challengeId,
      request.userId,
      request.update,
    );
    const status = ok ? 200 : 409;
    res.status(status).send();
  } catch (e: any) {
    logger.error(`Failed to update challenge: ${e}`);
    res.status(errorStatus(e)).send();
  }
}

type FinishChallengeRequest = {
  userId: number;
  times: ReportedTimes | null;
};

async function finishChallenge(req: Request, res: Response): Promise<void> {
  const challengeId = req.params.challengeId;
  const request = req.body as FinishChallengeRequest;

  try {
    await res.locals.challengeManager.finish(
      challengeId,
      request.userId,
      request.times,
    );
    res.status(200).send();
  } catch (e: any) {
    logger.error(`Failed to finish challenge: ${e}`);
    res.status(errorStatus(e)).send();
  }
}

type JoinChallengeRequest = {
  userId: number;
  recordingType: RecordingType;
};

async function joinChallenge(req: Request, res: Response): Promise<void> {
  const challengeId = req.params.challengeId;
  const request = req.body as JoinChallengeRequest;

  try {
    await res.locals.challengeManager.addClient(
      challengeId,
      request.userId,
      request.recordingType,
    );
    res.status(200).send();
  } catch (e: any) {
    logger.error(`Failed to finish challenge: ${e}`);
    res.status(errorStatus(e)).send();
  }
}

async function mergeTestEvents(req: Request, res: Response): Promise<void> {
  // Processes challenge data stored in the testing data repository.
  // Each top-level directory in the repository is a challenge ID. Inside, it
  // contains a subdirectory for each recorded stage of the challenge, which
  // stores the raw recorded events for each client as serialized protobuf
  // files.
  const challengeId = req.params.challengeId;

  const { challengeDataRepository, testDataRepository } = res.locals;

  const challengeFiles = await testDataRepository.listFiles(challengeId);
  if (challengeFiles.length === 0) {
    logger.error(`No test data found for challenge ${challengeId}`);
    res.status(404).send();
    return;
  }

  const [challengeInfo] = await sql`
      SELECT id, stage, status, type, uuid
      FROM challenges
      WHERE uuid = ${challengeId}
    `;
  if (!challengeInfo) {
    logger.error(`Challenge ${challengeId} does not exist`);
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

        let stageInfo: StageInfo = {
          stage: Number.parseInt(stage),
          status: StageStatus.WIPED,
          accurate: false,
          recordedTicks: 0,
          serverTicks: null,
        };

        // The test event data has legacy STAGE_UPDATE events that need to be
        // processed to determine the stage status.
        const update = events.getEventsList().find((e) => e.hasStageUpdate());
        if (update) {
          const stageUpdate = update.getStageUpdate()!;
          const isEnd =
            stageUpdate.getStatus() === StageStatus.COMPLETED ||
            stageUpdate.getStatus() === StageStatus.WIPED;
          if (isEnd) {
            stageInfo.status = stageUpdate.getStatus();
            stageInfo.accurate = stageUpdate.getAccurate();
            stageInfo.recordedTicks = update.getTick();
            if (stageUpdate.hasInGameTicks()) {
              stageInfo.serverTicks = {
                count: stageUpdate.getInGameTicks(),
                precise: true,
              };
            }
          }
        }

        streamsByStage.get(stage)!.set(
          clientId,
          ClientEvents.fromRawEvents(
            Number.parseInt(clientId),
            challengeInfo as ChallengeInfo,
            stageInfo,
            events.getEventsList().filter((e) => !e.hasStageUpdate()),
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

    const merger = new Merger(stage, Array.from(streams.values()));

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
        ticksLost: result.events.getMissingTickCount(),
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
}

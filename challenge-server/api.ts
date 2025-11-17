import {
  ChallengeMode,
  ChallengeType,
  ClientStageStream,
  DataRepository,
  RecordingType,
  Stage,
  StageStreamEvents,
  StageStreamType,
} from '@blert/common';
import { ChallengeEvents } from '@blert/common/generated/challenge_storage_pb';
import { Application, NextFunction, Request, Response } from 'express';

import {
  ChallengeError,
  ChallengeErrorType,
  ChallengeUpdate,
  UnmergedEventData,
  unmergedEventsFile,
} from './challenge-manager';
import { ClientEvents } from './client-events';
import sql from './db';
import { ReportedTimes } from './event-processing';
import logger from './log';
import { Merger } from './merge';

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return function (req: Request, res: Response, next: NextFunction) {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export function registerApiRoutes(app: Application): void {
  app.get('/ping', (_req, res) => {
    res.send('pong');
  });

  app.post('/challenges/new', asyncHandler(newChallenge));
  app.post('/challenges/:challengeId', asyncHandler(updateChallenge));
  app.post('/challenges/:challengeId/finish', asyncHandler(finishChallenge));
  app.post('/challenges/:challengeId/join', asyncHandler(joinChallenge));
  app.post('/test/merge/:challengeId/:stage', asyncHandler(mergeTestEvents));
}

function errorStatus(e: unknown): number {
  if (e instanceof ChallengeError) {
    switch (e.type) {
      case ChallengeErrorType.FAILED_PRECONDITION:
        return 400;
      case ChallengeErrorType.UNSUPPORTED:
        return 422;
      case ChallengeErrorType.INTERNAL:
        return 500;
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
    const result = await res.locals.challengeManager.createOrJoin(
      request.userId,
      request.type,
      request.mode,
      request.stage,
      request.party,
      request.recordingType,
    );
    res.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`Failed to create challenge: ${msg}`);
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

    const result = await res.locals.challengeManager.update(
      challengeId,
      request.userId,
      request.update,
    );
    if (result === null) {
      res.status(409).send();
    } else {
      res.json(result);
    }
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
    const status = await res.locals.challengeManager.addClient(
      challengeId,
      request.userId,
      request.recordingType,
    );
    res.json(status);
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
  const stage = Number.parseInt(req.params.stage);

  const { testDataRepository } = res.locals;

  let mergeData: UnmergedEventData;

  try {
    const data = await testDataRepository.loadRaw(
      unmergedEventsFile(challengeId, stage),
    );
    const raw = JSON.parse(data.toString()) as UnmergedEventData;
    mergeData = {
      ...raw,
      rawEvents: raw.rawEvents.map((e) => {
        if (e.type === StageStreamType.STAGE_EVENTS) {
          const events = (e as StageStreamEvents).events;
          return {
            ...e,
            events: Buffer.from(events),
          };
        }

        return e;
      }),
    };
  } catch (e) {
    if (e instanceof DataRepository.NotFound) {
      logger.error(`No unmerged event data for ${challengeId}:${stage}`);
      res.status(404).send();
      return;
    }

    const msg = e instanceof Error ? e.message : String(e);
    logger.error(
      `Failed to load test data for challenge ${challengeId}: ${msg}`,
    );
    res.status(500).send();
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

  const eventsByClient = new Map<number, ClientStageStream[]>();
  for (const evt of mergeData.rawEvents) {
    if (!eventsByClient.has(evt.clientId)) {
      eventsByClient.set(evt.clientId, []);
    }
    eventsByClient.get(evt.clientId)!.push(evt);
  }

  const clients: ClientEvents[] = [];

  for (const [clientId, events] of eventsByClient) {
    clients.push(
      ClientEvents.fromClientStream(
        clientId,
        mergeData.challengeInfo,
        mergeData.stage,
        events,
      ),
    );
  }

  const merger = new Merger(stage, clients);
  const result = merger.merge();
  if (result === null) {
    res.status(500).send();
    return;
  }

  logger.info(
    `Merged clients: ${result.mergedClients.map((c) => c.getId()).join(', ')}`,
  );
  logger.info(
    `Unmerged clients: ${result.unmergedClients.map((c) => c.getId()).join(', ')}`,
  );

  const mergedEvents = new ChallengeEvents();
  mergedEvents.setEventsList(Array.from(result.events));

  res
    .status(200)
    .send(Buffer.from(mergedEvents.serializeBinary()).toString('base64'));
}

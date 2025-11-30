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
import sql from './db';
import { ReportedTimes } from './event-processing';
import logger, { runWithLogContext } from './log';
import { ClientEvents, Merger } from './merging';

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

function sendErrorResponse(res: Response, e: unknown): void {
  const message = e instanceof Error ? e.message : 'Internal server error';
  res.status(errorStatus(e)).json({ error: { message } });
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

  await runWithLogContext(
    { userId: request.userId, action: 'new' },
    async () => {
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
        logger.error('challenge_api_error', {
          error: e instanceof Error ? e : new Error(String(e)),
        });
        sendErrorResponse(res, e);
      }
    },
  );
}

type UpdateChallengeRequest = {
  userId: number;
  update: ChallengeUpdate;
};

async function updateChallenge(req: Request, res: Response): Promise<void> {
  const challengeId = req.params.challengeId;
  const request = req.body as UpdateChallengeRequest;

  await runWithLogContext(
    { challengeUuid: challengeId, userId: request.userId, action: 'update' },
    async () => {
      try {
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
      } catch (e: unknown) {
        logger.error('Failed to update challenge', {
          error: e instanceof Error ? e : new Error(String(e)),
        });
        sendErrorResponse(res, e);
      }
    },
  );
}

type FinishChallengeRequest = {
  userId: number;
  times: ReportedTimes | null;
};

async function finishChallenge(req: Request, res: Response): Promise<void> {
  const challengeId = req.params.challengeId;
  const request = req.body as FinishChallengeRequest;

  await runWithLogContext(
    { challengeUuid: challengeId, userId: request.userId, action: 'finish' },
    async () => {
      try {
        await res.locals.challengeManager.finish(
          challengeId,
          request.userId,
          request.times,
        );
        res.status(200).send();
      } catch (e: unknown) {
        logger.error('Failed to finish challenge', {
          error: e instanceof Error ? e : new Error(String(e)),
        });
        sendErrorResponse(res, e);
      }
    },
  );
}

type JoinChallengeRequest = {
  userId: number;
  recordingType: RecordingType;
};

async function joinChallenge(req: Request, res: Response): Promise<void> {
  const challengeId = req.params.challengeId;
  const request = req.body as JoinChallengeRequest;

  await runWithLogContext(
    { challengeUuid: challengeId, userId: request.userId, action: 'join' },
    async () => {
      try {
        const status = await res.locals.challengeManager.addClient(
          challengeId,
          request.userId,
          request.recordingType,
        );
        res.json(status);
      } catch (e: unknown) {
        logger.error('Failed to join challenge', {
          error: e instanceof Error ? e : new Error(String(e)),
        });
        sendErrorResponse(res, e);
      }
    },
  );
}

async function mergeTestEvents(req: Request, res: Response): Promise<void> {
  // Processes challenge data stored in the testing data repository.
  // Each top-level directory in the repository is a challenge ID. Inside, it
  // contains a subdirectory for each recorded stage of the challenge, which
  // stores the raw recorded events for each client as serialized protobuf
  // files.
  const challengeId = req.params.challengeId;
  const stage = Number.parseInt(req.params.stage);

  await runWithLogContext({ challengeUuid: challengeId, stage }, async () => {
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
        logger.error('test_data_not_found');
        res.status(404).send();
        return;
      }

      const msg = e instanceof Error ? e.message : String(e);
      logger.error('test_data_load_error', { error: msg });
      res.status(500).send();
      return;
    }

    const [challengeInfo] = await sql`
          SELECT id, stage, status, type, uuid
          FROM challenges
          WHERE uuid = ${challengeId}
        `;
    if (!challengeInfo) {
      logger.error('test_challenge_not_found');
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

    logger.info('test_merge_result', { result });

    const mergedEvents = new ChallengeEvents();
    mergedEvents.setEventsList(Array.from(result.events));

    res
      .status(200)
      .send(Buffer.from(mergedEvents.serializeBinary()).toString('base64'));
  });
}

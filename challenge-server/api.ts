import {
  ChallengeMode,
  ChallengeType,
  ClientStageStream,
  DataRepository,
  RecordingType,
  Stage,
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
import {
  getMetricsSnapshot,
  metricsContentType,
  observeHttpRequest,
} from './metrics';

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return function (req: Request, res: Response, next: NextFunction) {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export function registerApiRoutes(app: Application): void {
  app.get('/ping', (req, res) => {
    res.send('pong');
  });

  app.get(
    '/metrics',
    asyncHandler(async (_req, res) => {
      try {
        const metrics = await getMetricsSnapshot();
        res.set('Content-Type', metricsContentType);
        res.send(metrics);
      } catch (err) {
        logger.error('metrics_endpoint_failure', {
          error: err instanceof Error ? err : new Error(String(err)),
        });
        res.status(500).send('metrics_unavailable');
      }
    }),
  );

  app.post('/challenges/new', asyncHandler(newChallenge));
  app.post('/challenges/:challengeId', asyncHandler(updateChallenge));
  app.post('/challenges/:challengeId/finish', asyncHandler(finishChallenge));
  app.post('/challenges/:challengeId/join', asyncHandler(joinChallenge));
  app.post('/test/merge/:challengeId/:stage', asyncHandler(mergeTestEvents));
}

function recordHttpMetrics(
  route: string,
  req: Request,
  res: Response,
  start: bigint,
): void {
  const diff = process.hrtime.bigint() - start;
  const durationMs = Number(diff) / 1_000_000;
  const status = res.statusCode ?? 200;
  observeHttpRequest(route, req.method, status, durationMs);
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

function logAndSendErrorResponse(res: Response, e: unknown): void {
  logger.error('challenge_api_error', {
    error: e instanceof Error ? e.message : String(e),
  });

  // Only surface challenge error details.
  const message =
    e instanceof ChallengeError ? e.message : 'Internal server error';
  const statusCode = errorStatus(e);
  res.status(statusCode).json({ error: { message } });
}

async function challengeApiHandler(
  req: Request,
  res: Response,
  route: string,
  context: Record<string, unknown>,
  handler: () => Promise<void>,
) {
  const start = process.hrtime.bigint();

  await runWithLogContext(context, async () => {
    try {
      await handler();
    } catch (e: unknown) {
      logAndSendErrorResponse(res, e);
    }
  });

  recordHttpMetrics(route, req, res, start);
}

type NewChallengeRequest = {
  userId: number;
  clientId: number;
  type: ChallengeType;
  mode: ChallengeMode;
  stage: Stage;
  party: string[];
  recordingType: RecordingType;
};

async function newChallenge(req: Request, res: Response): Promise<void> {
  const request = req.body as NewChallengeRequest;

  await challengeApiHandler(
    req,
    res,
    '/challenges/new',
    { userId: request.userId, clientId: request.clientId, action: 'new' },
    async () => {
      const result = await res.locals.challengeManager.createOrJoin(
        request.userId,
        request.clientId,
        request.type,
        request.mode,
        request.stage,
        request.party,
        request.recordingType,
      );
      res.json(result);
    },
  );
}

type UpdateChallengeRequest = {
  userId: number;
  clientId: number;
  update: ChallengeUpdate;
};

async function updateChallenge(req: Request, res: Response): Promise<void> {
  const challengeId = req.params.challengeId;
  const request = req.body as UpdateChallengeRequest;

  await challengeApiHandler(
    req,
    res,
    '/challenges/:challengeId',
    {
      challengeUuid: challengeId,
      userId: request.userId,
      clientId: request.clientId,
      action: 'update',
    },
    async () => {
      const result = await res.locals.challengeManager.update(
        challengeId,
        request.userId,
        request.clientId,
        request.update,
      );
      if (result === null) {
        res.status(409).json({ error: { message: 'Update rejected' } });
      } else {
        res.json(result);
      }
    },
  );
}

type FinishChallengeRequest = {
  userId: number;
  clientId: number;
  times: ReportedTimes | null;
  soft: boolean;
};

async function finishChallenge(req: Request, res: Response): Promise<void> {
  const challengeId = req.params.challengeId;
  const request = req.body as FinishChallengeRequest;

  await challengeApiHandler(
    req,
    res,
    '/challenges/:challengeId/finish',
    {
      challengeUuid: challengeId,
      userId: request.userId,
      clientId: request.clientId,
      action: 'finish',
    },
    async () => {
      await res.locals.challengeManager.finish(
        challengeId,
        request.userId,
        request.clientId,
        request.times,
        request.soft,
      );
      res.status(200).send();
    },
  );
}

type JoinChallengeRequest = {
  userId: number;
  clientId: number;
  recordingType: RecordingType;
};

async function joinChallenge(req: Request, res: Response): Promise<void> {
  const challengeId = req.params.challengeId;
  const request = req.body as JoinChallengeRequest;

  await challengeApiHandler(
    req,
    res,
    '/challenges/:challengeId/join',
    {
      challengeUuid: challengeId,
      userId: request.userId,
      clientId: request.clientId,
      action: 'join',
    },
    async () => {
      const status = await res.locals.challengeManager.addClient(
        challengeId,
        request.userId,
        request.clientId,
        request.recordingType,
      );
      res.json(status);
    },
  );
}

async function mergeTestEvents(req: Request, res: Response): Promise<void> {
  const route = '/test/merge/:challengeId/:stage';
  const start = process.hrtime.bigint();

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
            const events = e.events;
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

  recordHttpMetrics(route, req, res, start);
}

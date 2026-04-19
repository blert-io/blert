import { timingSafeEqual } from 'crypto';

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
import { ReportedTimes } from './event-processing';
import logger, { runWithLogContext } from './log';
import { ClientEvents, Merger, MergeTracer } from './merging';
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

  app.use('/test', requireApiKey);
  app.get('/test/merge/:challengeId/stages', asyncHandler(listMergeStages));
  app.post('/test/merge/:challengeId/:stage', asyncHandler(mergeTestEvents));
}

function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.BLERT_CHALLENGE_SERVER_API_KEY;
  if (!apiKey) {
    logger.error('api_key_not_configured');
    res.status(500).json({ error: 'API key not configured' });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    res.status(401).json({ error: 'Invalid Authorization header format' });
    return;
  }

  const provided = parts[1];
  try {
    const keyBuffer = Buffer.from(apiKey, 'utf-8');
    const providedBuffer = Buffer.from(provided, 'utf-8');

    if (
      keyBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(keyBuffer, providedBuffer)
    ) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }
  } catch {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  next();
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
  sessionToken: string;
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
    {
      userId: request.userId,
      clientId: request.clientId,
      sessionToken: request.sessionToken,
      action: 'new',
    },
    async () => {
      const result = await res.locals.challengeManager.createOrJoin(
        request.userId,
        request.clientId,
        request.sessionToken,
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
  sessionToken: string;
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
      sessionToken: request.sessionToken,
      action: 'update',
    },
    async () => {
      // The session token is not needed here as challenge state is a property
      // of OSRS, not Blert's system.
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
  sessionToken: string;
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
      sessionToken: request.sessionToken,
      action: 'finish',
    },
    async () => {
      // The session token is not needed here as challenge state is a property
      // of OSRS, not Blert's system.
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
  sessionToken: string;
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
      sessionToken: request.sessionToken,
      action: 'join',
    },
    async () => {
      const status = await res.locals.challengeManager.addClient(
        challengeId,
        request.userId,
        request.clientId,
        request.sessionToken,
        request.recordingType,
      );
      res.json(status);
    },
  );
}

async function loadUnmergedData(
  testDataRepository: DataRepository,
  challengeId: string,
  stage: number,
): Promise<UnmergedEventData> {
  const data = await testDataRepository.loadRaw(
    unmergedEventsFile(challengeId, stage),
  );
  const raw = JSON.parse(data.toString()) as UnmergedEventData;
  return {
    ...raw,
    rawEvents: raw.rawEvents.map((e) => {
      if (e.type === StageStreamType.STAGE_EVENTS) {
        return { ...e, events: Buffer.from(e.events) };
      }
      return e;
    }),
  };
}

async function listMergeStages(req: Request, res: Response): Promise<void> {
  const route = '/test/merge/:challengeId/stages';
  const start = process.hrtime.bigint();

  const challengeId = req.params.challengeId;

  await runWithLogContext({ challengeUuid: challengeId }, async () => {
    const { testDataRepository } = res.locals;

    try {
      const files = await testDataRepository.listFiles('unmerged-events');
      const prefix = `${challengeId}:`;
      const stages: number[] = [];

      for (const file of files) {
        const basename = file.split('/').pop() ?? '';
        if (basename.startsWith(prefix) && basename.endsWith('_events.json')) {
          const stageStr = basename.slice(
            prefix.length,
            -'_events.json'.length,
          );
          const stageNum = Number.parseInt(stageStr);
          if (!Number.isNaN(stageNum)) {
            stages.push(stageNum);
          }
        }
      }

      stages.sort((a, b) => a - b);
      res.json({ stages });
    } catch (e) {
      if (e instanceof DataRepository.NotFound) {
        res.json({ stages: [] });
        return;
      }

      const msg = e instanceof Error ? e.message : String(e);
      logger.error('list_merge_stages_error', { error: msg });
      res.status(500).json({ error: 'Failed to list stages' });
    }
  });

  recordHttpMetrics(route, req, res, start);
}

async function mergeTestEvents(req: Request, res: Response): Promise<void> {
  const route = '/test/merge/:challengeId/:stage';
  const start = process.hrtime.bigint();

  const challengeId = req.params.challengeId;
  const stage = Number.parseInt(req.params.stage);

  await runWithLogContext({ challengeUuid: challengeId, stage }, async () => {
    const { testDataRepository } = res.locals;

    let mergeData: UnmergedEventData;

    try {
      mergeData = await loadUnmergedData(
        testDataRepository,
        challengeId,
        stage,
      );
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

    const tracer = new MergeTracer();
    const merger = new Merger(stage, clients);
    const result = merger.merge(tracer);
    if (result === null) {
      res.status(500).send();
      return;
    }

    const { events, ...metadata } = result;
    logger.info('test_merge_result', { result: metadata });

    const mergedEvents = new ChallengeEvents();
    mergedEvents.setEventsList(Array.from(events));
    const mergedEventsBase64 = Buffer.from(
      mergedEvents.serializeBinary(),
    ).toString('base64');

    res.json({
      result: metadata,
      trace: tracer.toTrace(),
      mergedEventsBase64,
    });
  });

  recordHttpMetrics(route, req, res, start);
}

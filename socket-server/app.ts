import cors from 'cors';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import { readFile } from 'fs/promises';
import { RedisClientType, createClient } from 'redis';
import { WebSocket, WebSocketServer } from 'ws';

import ChallengeManager from './challenge-manager';
import Client from './client';
import ConnectionManager from './connection-manager';
import MessageHandler from './message-handler';
import { PlayerManager } from './players';
import { RemoteChallengeManager } from './remote-challenge-manager';
import ServerManager, { ServerStatus } from './server-manager';
import { PluginVersions } from './verification';
import { ConfigManager } from './config';
import logger, { runWithLogContext } from './log';
import {
  AuthFailureReason,
  getMetricsSnapshot,
  metricsContentType,
  recordAuthFailure,
  recordAuthSuccess,
  recordRedisEvent,
} from './metrics';

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return function (req: Request, res: Response, next: NextFunction) {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

type ShutdownRequest = {
  shutdownTime?: number;
  cancel?: boolean;
  force?: boolean;
};

function setupHttpRoutes(app: express.Express, serverManager: ServerManager) {
  app.get('/ping', (_req, res) => {
    res.send('pong');
  });

  app.use('/admin/*', (req, res, next) => {
    if (req.headers.authorization !== process.env.ADMIN_TOKEN) {
      res.status(401).send('Unauthorized');
      return;
    }

    next();
  });

  app.get('/admin/status', (_req, res) => {
    res.json(serverManager.getStatus());
  });

  app.post('/admin/shutdown', (req, res) => {
    const {
      shutdownTime,
      cancel = false,
      force = false,
    } = req.body as ShutdownRequest;
    if (cancel) {
      if (serverManager.hasPendingShutdown()) {
        serverManager.cancelShutdown();
      }
    } else {
      serverManager.scheduleShutdown(shutdownTime, force);
    }
    res.json(serverManager.getStatus());
  });

  app.get(
    '/metrics',
    asyncHandler(async (_req, res) => {
      try {
        res.set('Content-Type', metricsContentType);
        res.send(await getMetricsSnapshot());
      } catch (e: any) {
        logger.error('metrics_endpoint_failure', {
          error: e instanceof Error ? e : new Error(String(e)),
        });
        res.status(500).send('metrics_unavailable');
      }
    }),
  );
}

async function initializeRemoteChallengeManager(
  redisClient: RedisClientType,
): Promise<[ChallengeManager, PlayerManager]> {
  if (!process.env.BLERT_CHALLENGE_SERVER_URI) {
    throw new Error('BLERT_CHALLENGE_SERVER_URI is not set');
  }
  if (!process.env.BLERT_REDIS_URI) {
    throw new Error('BLERT_REDIS_URI is not set');
  }

  logger.info('remote_challenge_manager_selected', {
    challengeServerUri: process.env.BLERT_CHALLENGE_SERVER_URI,
  });

  const challengeManager = new RemoteChallengeManager(
    process.env.BLERT_CHALLENGE_SERVER_URI,
    redisClient,
  );

  const playerClient = redisClient.duplicate();
  playerClient.on('error', (err) => {
    recordRedisEvent('error');
    logger.error('redis_error', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
  });
  await playerClient.connect();

  const playerManager = new PlayerManager(playerClient);

  return [challengeManager, playerManager];
}

async function loadValidRevisions(): Promise<Set<string>> {
  let validPluginRevisions = new Set<string>();
  if (process.env.BLERT_REVISIONS_FILE) {
    try {
      const data = await readFile(process.env.BLERT_REVISIONS_FILE, 'utf8');
      validPluginRevisions = new Set(data.split('\n').filter((x) => x));
    } catch (e: any) {
      logger.error('revision_file_read_failed', {
        file: process.env.BLERT_REVISIONS_FILE,
        error: e instanceof Error ? e : new Error(String(e)),
      });
      process.exit(1);
    }
  }

  return validPluginRevisions;
}

async function main(): Promise<void> {
  dotenv.config({ path: ['.env.local', `.env.${process.env.NODE_ENV}`] });

  if (!process.env.BLERT_REDIS_URI) {
    throw new Error('BLERT_REDIS_URI is not set');
  }

  const redisClient: RedisClientType = createClient({
    url: process.env.BLERT_REDIS_URI,
    pingInterval: 3 * 60 * 1000,
  });
  redisClient.on('connect', () => {
    recordRedisEvent('connect');
    logger.info('redis_connected');
  });
  redisClient.on('error', (err) => {
    recordRedisEvent('error');
    logger.error('redis_error', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
  });
  await redisClient.connect();

  const validPluginRevisions = await loadValidRevisions();
  const configManager = new ConfigManager(redisClient, {
    minRuneLiteVersion: process.env.BLERT_MIN_RL_VERSION ?? null,
    allowedRevisions: validPluginRevisions,
  });

  const port = process.env.PORT ?? 3003;

  const app = express();
  app.use(cors({ origin: '*', allowedHeaders: ['Authorization'] }));
  app.use(express.json());

  const server = app.listen(port, () => {
    logger.info('event_server_listening', { port });
  });

  const wss = new WebSocketServer({ noServer: true });

  let requestId = 0;

  server.on('upgrade', (request, socket, head) => {
    ++requestId;
    void runWithLogContext({ requestId }, async () => {
      const reject = (statusLine: string, reason: AuthFailureReason) => {
        recordAuthFailure(reason);
        socket.write(`${statusLine}\r\n\r\n`);
        socket.destroy();
      };

      try {
        const auth = request.headers.authorization?.split(' ') ?? [];
        if (auth.length !== 2 || auth[0] !== 'Basic') {
          reject('HTTP/1.1 401 Unauthorized', 'missing_token');
          return;
        }

        const token = Buffer.from(auth[1], 'base64').toString();
        const user = await connectionManager.authenticate(token);
        logger.debug('websocket_token_authenticated', {
          userId: user.id,
          username: user.username,
        });

        const pluginVersions = PluginVersions.fromHeaders(request.headers);
        if (pluginVersions === null) {
          logger.warn('websocket_auth_missing_plugin_versions');
          reject('HTTP/1.1 400 Bad Request', 'missing_plugin_versions');
          return;
        }

        const isAllowed = await configManager.verify(pluginVersions);
        if (!isAllowed) {
          logger.warn('websocket_auth_plugin_not_allowed', {
            pluginVersion: pluginVersions.getVersion(),
            pluginRevision: pluginVersions.getRevision(),
            runeLiteVersion: pluginVersions.getRuneLiteVersion(),
          });
          reject('HTTP/1.1 403 Forbidden', 'plugin_not_allowed');
          return;
        }

        recordAuthSuccess();
        wss.handleUpgrade(request, socket, head, (ws) => {
          const client = new Client(ws, messageHandler, user, pluginVersions);
          wss.emit('connection', ws, request, client);
        });
      } catch (e: any) {
        const reason: AuthFailureReason =
          e instanceof Error && e.message === 'Invalid API key'
            ? 'invalid_token'
            : 'unknown';
        recordAuthFailure(reason);
        logger.warn('websocket_auth_failed', {
          error: e instanceof Error ? e : new Error(String(e)),
        });
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
      }
    });
  });

  const connectionManager = new ConnectionManager();
  const serverManager = new ServerManager(connectionManager);

  const [challengeManager, playerManager] =
    await initializeRemoteChallengeManager(redisClient);

  const messageHandler = new MessageHandler(challengeManager, playerManager);

  serverManager.onStatusUpdate(messageHandler.handleServerStatusUpdate);

  serverManager.onStatusUpdate((status) => {
    if (status.status === ServerStatus.OFFLINE) {
      server.close();
      logger.info('http_server_closed');
    }
  });

  setupHttpRoutes(app, serverManager);

  wss.on('connection', (_ws: WebSocket, _req: Request, client: Client) => {
    connectionManager.addClient(client);
    serverManager.handleNewClient(client);
    const pluginVersions = client.getPluginVersions();
    logger.info('client_connected', {
      userId: client.getUserId(),
      username: client.getUsername(),
      sessionId: client.getSessionId(),
      pluginVersion: pluginVersions.getVersion(),
      pluginRevision: pluginVersions.getRevision(),
      runeLiteVersion: pluginVersions.getRuneLiteVersion(),
    });
  });
}

void main();

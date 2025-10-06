import cors from 'cors';
import dotenv from 'dotenv';
import express, { Request } from 'express';
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
import {
  verifyRuneLiteVersion,
  verifyRevision,
  PluginVersions,
} from './verification';
import { ConfigManager } from './config';

type ShutdownRequest = {
  shutdownTime?: number;
  cancel?: boolean;
  force?: boolean;
};

async function setupHttpRoutes(
  app: express.Express,
  serverManager: ServerManager,
) {
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

  app.post('/admin/shutdown', async (req, res) => {
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

  console.log(
    `Using remote challenge manager at ${process.env.BLERT_CHALLENGE_SERVER_URI}`,
  );

  const challengeManager = new RemoteChallengeManager(
    process.env.BLERT_CHALLENGE_SERVER_URI,
    redisClient,
  );

  const playerClient = redisClient.duplicate();
  await playerClient.connect();

  const playerManager = new PlayerManager(playerClient);

  return [challengeManager, playerManager];
}

async function loadValidRevisions(): Promise<Set<string>> {
  let validPluginRevisions: Set<string> = new Set();
  if (process.env.BLERT_REVISIONS_FILE) {
    try {
      const data = await readFile(process.env.BLERT_REVISIONS_FILE, 'utf8');
      validPluginRevisions = new Set(data.split('\n').filter((x) => x));
    } catch (e: any) {
      console.error(`Failed to read ${process.env.BLERT_REVISIONS_FILE}:`, e);
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
  redisClient.on('connect', () => console.log('Connected to Redis'));
  redisClient.on('error', (err) => console.error('Redis error:', err));
  await redisClient.connect();

  const validPluginRevisions = await loadValidRevisions();
  const configManager = new ConfigManager(redisClient, {
    minRuneLiteVersion: process.env.BLERT_MIN_RL_VERSION ?? null,
    allowedRevisions: validPluginRevisions,
  });

  const port = process.env.PORT || 3003;

  const app = express();
  app.use(cors({ origin: '*', allowedHeaders: ['Authorization'] }));
  app.use(express.json());
  const server = app.listen(port, () => {
    console.log(`Blert webserver started on port ${port}`);
  });

  const wss = new WebSocketServer({ noServer: true });

  let requestId = 0;

  server.on('upgrade', async (request, socket, head) => {
    ++requestId;
    console.log(`[${requestId}] New websocket authentication request`);

    try {
      const auth = request.headers.authorization?.split(' ') || [];
      if (auth.length != 2 || auth[0] != 'Basic') {
        throw { message: 'Missing token' };
      }

      const token = Buffer.from(auth[1], 'base64').toString();
      const user = await connectionManager.authenticate(token);

      const pluginVersions = PluginVersions.fromHeaders(request.headers);
      if (pluginVersions === null) {
        console.log(`[${requestId}] missing plugin versions`);
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      const isAllowed = await configManager.verify(pluginVersions);
      if (!isAllowed) {
        console.log(`[${requestId}] Plugin not allowed: ${pluginVersions}`);
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        const client = new Client(ws, messageHandler, user, pluginVersions);
        wss.emit('connection', ws, request, client);
      });
    } catch (e: any) {
      console.log(`[${requestId}] Failed to authenticate: ${e.message}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
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
      console.log('HTTP server closed.');
    }
  });

  setupHttpRoutes(app, serverManager);

  wss.on('connection', (ws: WebSocket, req: Request, client: Client) => {
    connectionManager.addClient(client);
    serverManager.handleNewClient(client);
    console.log(`${client} (${client.getPluginVersions()}) connected`);
  });
}

main();

import { S3Client } from '@aws-sdk/client-s3';
import { DataRepository } from '@blert/common';
import cors from 'cors';
import dotenv from 'dotenv';
import { readFile } from 'fs/promises';
import express, { Request } from 'express';
import { WebSocket, WebSocketServer } from 'ws';

import ChallengeManager from './challenge-manager';
import Client from './client';
import ConnectionManager from './connection-manager';
import MessageHandler from './message-handler';
import { PlayerManager } from './players';
import ServerManager, { ServerStatus } from './server-manager';

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

/**
 * Initializes the repository for Blert's static challenge data files, with a
 * backend set based on the BLERT_DATA_REPOSITORY environment variable.
 * @returns The initialized data repository.
 */
function initializeDataRepository(): DataRepository {
  let repositoryBackend: DataRepository.Backend;
  if (!process.env.BLERT_DATA_REPOSITORY) {
    throw new Error('BLERT_DATA_REPOSITORY is not set');
  } else if (process.env.BLERT_DATA_REPOSITORY.startsWith('file://')) {
    const root = process.env.BLERT_DATA_REPOSITORY.slice('file://'.length);
    console.log(`DataRepository using filesystem backend at ${root}`);
    repositoryBackend = new DataRepository.FilesystemBackend(root);
  } else if (process.env.BLERT_DATA_REPOSITORY.startsWith('s3://')) {
    const s3Client = new S3Client({
      forcePathStyle: false,
      region: process.env.BLERT_REGION,
      endpoint: process.env.BLERT_ENDPOINT,
      credentials: {
        accessKeyId: process.env.BLERT_ACCESS_KEY_ID!,
        secretAccessKey: process.env.BLERT_SECRET_ACCESS_KEY!,
      },
    });
    const bucket = process.env.BLERT_DATA_REPOSITORY.slice('s3://'.length);
    repositoryBackend = new DataRepository.S3Backend(s3Client, bucket);
  } else {
    throw new Error('Unknown repository backend');
  }

  return new DataRepository(repositoryBackend);
}

async function main(): Promise<void> {
  dotenv.config({ path: ['.env.local', `.env.${process.env.NODE_ENV}`] });

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

      const validRevision = verifyRevision(
        validPluginRevisions,
        request.headers['blert-revision'] as string | undefined,
      );
      if (!validRevision) {
        console.log(
          `[${requestId}] Invalid plugin revision: ${request.headers['blert-revision']}`,
        );
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        const client = new Client(ws, messageHandler, user);
        wss.emit('connection', ws, request, client);
      });
    } catch (e: any) {
      console.log(`[${requestId}] Failed to authenticate: ${e.message}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  });

  const repository = initializeDataRepository();

  const connectionManager = new ConnectionManager();
  const serverManager = new ServerManager(connectionManager);
  const playerManager = new PlayerManager();
  const challengeManager = new ChallengeManager(playerManager, repository);
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
    console.log(`${client} connected`);
  });
}

function verifyRevision(
  validRevisions: Set<string>,
  revision: string | undefined,
): boolean {
  if (!process.env.BLERT_REVISIONS_FILE) {
    return true;
  }

  if (revision === undefined) {
    return false;
  }
  revision = revision.split(':')[0];
  if (revision === undefined) {
    return false;
  }

  return validRevisions.has(revision);
}

main();

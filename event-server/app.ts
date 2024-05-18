import cors from 'cors';
import { readFile } from 'fs/promises';
import express, { Request } from 'express';
import { connect } from 'mongoose';
import { WebSocket, WebSocketServer } from 'ws';

import Client from './client';
import ConnectionManager from './connection-manager';
import MessageHandler from './message-handler';
import ChallengeManager from './challenge-manager';
import ServerManager, { ServerStatus } from './server-manager';
import { PlayerManager } from './players';

async function connectToDatabase() {
  if (!process.env.DB_CONNECTION_STRING) {
    console.error('No database host is configured');
    process.exit(1);
  }

  await connect(process.env.DB_CONNECTION_STRING);

  console.log(`Connecting to database at ${process.env.DB_HOST}`);
}

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

async function main(): Promise<void> {
  await connectToDatabase();

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
    console.log(`blert server started on port ${port}`);
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

  const connectionManager = new ConnectionManager();
  const serverManager = new ServerManager(connectionManager);
  const playerManager = new PlayerManager();
  const challengeManager = new ChallengeManager(playerManager);
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

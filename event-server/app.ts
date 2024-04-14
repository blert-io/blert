import cors from 'cors';
import express, { Request } from 'express';
import { connect } from 'mongoose';
import { WebSocket, WebSocketServer } from 'ws';

import Client from './client';
import ConnectionManager from './connection-manager';
import EventHandler from './message-handler';
import ChallengeManager from './challenge-manager';

async function connectToDatabase() {
  if (!process.env.DB_CONNECTION_STRING) {
    console.error('No database host is configured');
    process.exit(1);
  }

  await connect(process.env.DB_CONNECTION_STRING);

  console.log(`Connecting to database at ${process.env.DB_HOST}`);
}

async function main(): Promise<void> {
  await connectToDatabase();

  const port = process.env.PORT || 3003;

  const app = express();
  app.use(cors({ origin: '*', allowedHeaders: ['Authorization'] }));
  const server = app.listen(port, () => {
    console.log(`blert server started on port ${port}`);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (request, socket, head) => {
    console.log('New websocket authentication request');

    try {
      const auth = request.headers.authorization?.split(' ') || [];
      if (auth.length != 2 || auth[0] != 'Basic') {
        throw { message: 'Missing token' };
      }

      const token = Buffer.from(auth[1], 'base64').toString();
      const user = await connectionManager.authenticate(token);

      wss.handleUpgrade(request, socket, head, (ws) => {
        const client = new Client(ws, eventHandler, user);
        wss.emit('connection', ws, request, client);
      });
    } catch (e: any) {
      console.log(`Failed to authenticate: ${e.message}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  });

  const connectionManager = new ConnectionManager();
  const raidManager = new ChallengeManager();
  const eventHandler = new EventHandler(raidManager);

  app.get('/ping', (_req, res) => {
    res.send('pong');
  });

  wss.on('connection', (ws: WebSocket, req: Request, client: Client) => {
    connectionManager.addClient(client);
    console.log(
      `Client ${client.getSessionId()}: user ${client.getUsername()} connected`,
    );
  });
}

main();

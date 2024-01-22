import express from 'express';
import { WebSocketServer } from 'ws';

import Client from './client';
import ConnectionManager from './connection-manager';
import EventHandler from './event-handler';
import RaidManager from './raid-manager';

const port = process.env.PORT || 3003;
const app = express();
const server = app.listen(port, () => {
  console.log(`blert starting on port ${port}`);
});

const wss = new WebSocketServer({ server, path: '/ws' });

const connectionManager = new ConnectionManager();
const raidManager = new RaidManager();
const eventHandler = new EventHandler(raidManager);

app.get('/ping', (_req, res) => {
  res.send('pong');
});

wss.on('connection', (ws, req) => {
  const client = new Client(ws, eventHandler);
  connectionManager.addClient(client);
});

import express from 'express';
import { connect } from 'mongoose';
import { WebSocketServer } from 'ws';

import Client from './client';
import ConnectionManager from './connection-manager';
import EventHandler from './event-handler';
import RaidManager from './raid-manager';

async function connectToDatabase() {
  let dbAuth = '';
  if (process.env.DB_USERNAME && process.env.DB_PASSWORD) {
    dbAuth = `${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@`;
  }

  if (!process.env.DB_HOST) {
    console.error('No database host is configured');
    process.exit(1);
  }

  const mongoUri = `mongodb://${dbAuth}${process.env.DB_HOST}`;
  await connect(mongoUri);

  console.log(`Connecting to database at ${process.env.DB_HOST}`);
}

async function main(): Promise<void> {
  await connectToDatabase();

  const port = process.env.PORT || 3003;

  const app = express();
  const server = app.listen(port, () => {
    console.log(`blert server started on port ${port}`);
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
}

main();

import {
  DataSource,
  EventType,
  jsonToServerMessage,
  Stage,
} from '@blert/common';
import { ServerMessage } from '@blert/common/generated/server_message_pb';
import { EventEmitter, once } from 'events';
import { WebSocket } from 'ws';
import { constants, createDeflateRaw, deflateRawSync } from 'zlib';

import Client from '../client';
import MessageHandler from '../message-handler';
import { MessageFormat } from '../protocol';
import { PluginVersions } from '../verification';

class FakeSocket extends EventEmitter {
  public binaryType = 'nodebuffer';
  public readonly closeCodes: number[] = [];

  public readonly send = jest.fn();

  public close(code: number): void {
    this.closeCodes.push(code);
    this.emit('close', code);
  }
}

describe('blert-json-deflate', () => {
  it('inflates consecutive frames of one deflate stream in order', async () => {
    const first = {
      type: ServerMessage.Type.EVENT_STREAM,
      challengeEvents: [
        {
          type: EventType.PLAYER_UPDATE,
          stage: Stage.TOB_NYLOCAS,
          tick: 2,
          xCoord: 3295,
          yCoord: 4254,
          player: { name: '1Ogp', dataSource: DataSource.SECONDARY },
        },
      ],
    };
    const second = {
      type: ServerMessage.Type.EVENT_STREAM,
      challengeEvents: [
        {
          type: EventType.PLAYER_UPDATE,
          stage: Stage.TOB_NYLOCAS,
          tick: 3,
          xCoord: 3295,
          yCoord: 4252,
          player: { name: '1Ogp', dataSource: DataSource.SECONDARY },
        },
      ],
    };

    const deflater = createDeflateRaw({ level: 1 });
    const frames: Buffer[] = [];
    for (const message of [first, second]) {
      deflater.write(JSON.stringify(message));
      frames.push(
        await new Promise<Buffer>((resolve) => {
          deflater.flush(constants.Z_SYNC_FLUSH, () => {
            resolve(deflater.read() as Buffer);
          });
        }),
      );
    }
    deflater.close();

    const handled: ServerMessage[] = [];
    let resolveHandled: (() => void) | null = null;
    const bothHandled = new Promise<void>((resolve) => {
      resolveHandled = resolve;
    });
    const messageHandler = {
      handleMessage: (_client: Client, message: ServerMessage) => {
        handled.push(message);
        if (handled.length === 2) {
          resolveHandled?.();
        }
        return Promise.resolve();
      },
      closeClient: jest.fn(),
    };

    const socket = new FakeSocket();
    const client = new Client(
      socket as unknown as WebSocket,
      messageHandler as unknown as MessageHandler,
      { id: 123, keyId: 456, username: '1Ogp', linkedPlayerId: 789 },
      PluginVersions.fromHeaders({
        'blert-version': '0.10.5',
        'blert-revision': 'ffaaaaff',
        'blert-jar-hash': '10101010',
        'blert-runelite-version': '1.13.1',
      })!,
      MessageFormat.JSON_DEFLATE,
    );

    socket.emit('message', frames[0], true);
    socket.emit('message', frames[1], true);
    await bothHandled;
    client.close();

    expect(handled.map((message) => message.toObject())).toEqual([
      jsonToServerMessage(first).toObject(),
      jsonToServerMessage(second).toObject(),
    ]);
  });

  it('closes with 1007 on a frame that does not inflate', async () => {
    const handleMessage = jest.fn();
    const socket = new FakeSocket();
    new Client(
      socket as unknown as WebSocket,
      { handleMessage, closeClient: jest.fn() } as unknown as MessageHandler,
      { id: 123, keyId: 456, username: '1Ogp', linkedPlayerId: 789 },
      PluginVersions.fromHeaders({
        'blert-version': '0.10.5',
        'blert-revision': 'ffaaaaff',
        'blert-jar-hash': '10101010',
        'blert-runelite-version': '1.13.1',
      })!,
      MessageFormat.JSON_DEFLATE,
    );

    const closed = once(socket, 'close');
    socket.emit('message', Buffer.from([0xff, 0xff, 0xff, 0xff]), true);
    await closed;

    expect(socket.closeCodes).toEqual([1007]);
    expect(handleMessage).not.toHaveBeenCalled();
  });

  it('closes with 1009 on a frame that inflates past 4 MiB', async () => {
    const handleMessage = jest.fn();
    const socket = new FakeSocket();
    new Client(
      socket as unknown as WebSocket,
      { handleMessage, closeClient: jest.fn() } as unknown as MessageHandler,
      { id: 123, keyId: 456, username: '1Ogp', linkedPlayerId: 789 },
      PluginVersions.fromHeaders({
        'blert-version': '0.10.5',
        'blert-revision': 'ffaaaaff',
        'blert-jar-hash': '10101010',
        'blert-runelite-version': '1.13.1',
      })!,
      MessageFormat.JSON_DEFLATE,
    );

    const frame = deflateRawSync(Buffer.alloc(4 * 1024 * 1024 + 1), {
      level: 1,
      finishFlush: constants.Z_SYNC_FLUSH,
    });
    const closed = once(socket, 'close');
    socket.emit('message', frame, true);
    await closed;

    expect(socket.closeCodes).toEqual([1009]);
    expect(handleMessage).not.toHaveBeenCalled();
  });
});

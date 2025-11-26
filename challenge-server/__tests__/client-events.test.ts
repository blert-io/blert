import {
  ChallengeStatus,
  ChallengeType,
  DataSource,
  EventType,
  Stage,
  StageStatus,
} from '@blert/common';
import {
  Event as ProtoEvent,
  StageMap,
} from '@blert/common/generated/event_pb';

import { ClientEvents } from '../client-events';

const challengeInfo = {
  id: 123,
  uuid: '11111111-2222-3333-4444-555555555555',
  type: ChallengeType.TOB,
  status: ChallengeStatus.IN_PROGRESS,
  stage: Stage.TOB_MAIDEN,
  party: ['player1', 'player2'],
};

type Proto<T> = T[keyof T];
type ProtoEventType = Proto<ProtoEvent.TypeMap>;
type ProtoStage = Proto<StageMap>;
type ProtoDataSource = Proto<ProtoEvent.Player.DataSourceMap>;

function createPlayerUpdate({
  tick,
  name,
  source = DataSource.PRIMARY,
  x = 0,
  y = 0,
}: {
  tick: number;
  name: string;
  source?: DataSource;
  x?: number;
  y?: number;
}): ProtoEvent {
  const event = new ProtoEvent();
  event.setType(EventType.PLAYER_UPDATE as ProtoEventType);
  event.setTick(tick);
  event.setStage(Stage.TOB_MAIDEN as ProtoStage);
  event.setXCoord(x);
  event.setYCoord(y);

  const player = new ProtoEvent.Player();
  player.setName(name);
  player.setDataSource(source as ProtoDataSource);
  event.setPlayer(player);

  return event;
}

describe('ClientEvents', () => {
  it('derives recorded ticks when not provided', () => {
    const client = ClientEvents.fromRawEvents(
      1,
      challengeInfo,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.STARTED,
        accurate: false,
        recordedTicks: 0,
        serverTicks: null,
      },
      [
        createPlayerUpdate({ tick: 0, name: 'player1' }),
        createPlayerUpdate({ tick: 5, name: 'player1' }),
      ],
    );

    expect(client.getFinalTick()).toBe(5);
    expect(client.isAccurate()).toBe(false);
  });

  it('treats multiple primary players as a spectator recording', () => {
    const client = ClientEvents.fromRawEvents(
      2,
      challengeInfo,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.STARTED,
        accurate: false,
        recordedTicks: 1,
        serverTicks: null,
      },
      [
        createPlayerUpdate({ tick: 0, name: 'player1' }),
        createPlayerUpdate({ tick: 0, name: 'player2' }),
      ],
    );

    expect(client.isSpectator()).toBe(true);
  });

  it('flags clients whose recorded ticks exceed reported server ticks', () => {
    const client = ClientEvents.fromRawEvents(
      3,
      challengeInfo,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.COMPLETED,
        accurate: true,
        recordedTicks: 5,
        serverTicks: { count: 4, precise: true },
      },
      [
        createPlayerUpdate({ tick: 0, name: 'player1' }),
        createPlayerUpdate({ tick: 4, name: 'player1' }),
      ],
    );

    expect(client.hasInvalidTickCount()).toBe(true);
    expect(client.isAccurate()).toBe(false);
  });

  it('detects inconsistent movement when players skip too many tiles', () => {
    const client = ClientEvents.fromRawEvents(
      4,
      challengeInfo,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.STARTED,
        accurate: false,
        recordedTicks: 1,
        serverTicks: null,
      },
      [
        createPlayerUpdate({ tick: 0, name: 'player1', x: 0, y: 0 }),
        createPlayerUpdate({ tick: 1, name: 'player1', x: 10, y: 0 }),
      ],
    );

    expect(client.checkForConsistency()).toBe(false);
  });

  it('accepts movement within allowable distance', () => {
    const client = ClientEvents.fromRawEvents(
      5,
      challengeInfo,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.STARTED,
        accurate: false,
        recordedTicks: 1,
        serverTicks: null,
      },
      [
        createPlayerUpdate({ tick: 0, name: 'player1', x: 0, y: 0 }),
        createPlayerUpdate({ tick: 1, name: 'player1', x: 2, y: 1 }),
      ],
    );

    expect(client.checkForConsistency()).toBe(true);
  });
});

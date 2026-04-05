import {
  ChallengeMode,
  ChallengeType,
  DataSource,
  EventType,
  ItemDelta,
  Stage,
  StageStatus,
  StageStreamEvents,
  StageStreamType,
} from '@blert/common';
import { ChallengeEvents } from '@blert/common/generated/challenge_storage_pb';
import {
  Event as ProtoEvent,
  StageMap,
} from '@blert/common/generated/event_pb';

import { ClientEvents, ClientAnomaly } from '../client-events';
import { createPlayerUpdateEvent } from './fixtures';
import { ChallengeInfo } from '../merge';

type ProtoEventType = ProtoEvent.TypeMap[keyof ProtoEvent.TypeMap];
type ProtoStage = StageMap[keyof StageMap];

type ProtoDataSource =
  ProtoEvent.Player.DataSourceMap[keyof ProtoEvent.Player.DataSourceMap];

const challengeInfo: ChallengeInfo = {
  uuid: '11111111-2222-3333-4444-555555555555',
  type: ChallengeType.TOB,
  mode: ChallengeMode.TOB_REGULAR,
  party: ['player1', 'player2'],
};

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
        createPlayerUpdateEvent({ tick: 0, name: 'player1' }),
        createPlayerUpdateEvent({ tick: 5, name: 'player1' }),
      ],
    );

    expect(client.getStage()).toBe(Stage.TOB_MAIDEN);
    expect(client.getFinalTick()).toBe(5);
    expect(client.isAccurate()).toBe(false);
  });

  describe('anomalies', () => {
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
          createPlayerUpdateEvent({
            tick: 0,
            name: 'player1',
            source: DataSource.PRIMARY,
          }),
          createPlayerUpdateEvent({
            tick: 0,
            name: 'player2',
            source: DataSource.PRIMARY,
          }),
        ],
      );

      expect(client.isSpectator()).toBe(true);
      expect(client.hasAnomaly(ClientAnomaly.MULTIPLE_PRIMARY_PLAYERS)).toBe(
        true,
      );
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
          createPlayerUpdateEvent({ tick: 0, name: 'player1' }),
          createPlayerUpdateEvent({ tick: 4, name: 'player1' }),
        ],
      );

      expect(client.hasInvalidTickCount()).toBe(true);
      expect(client.isAccurate()).toBe(false);
    });

    it('flags missing stage metadata when no stage end update is present', () => {
      const eventsMessage = new ChallengeEvents();
      eventsMessage.setEventsList([
        createPlayerUpdateEvent({ tick: 0, name: 'alice' }),
      ]);
      const stream: StageStreamEvents = {
        type: StageStreamType.STAGE_EVENTS,
        clientId: 6,
        events: eventsMessage.serializeBinary(),
      };

      const client = ClientEvents.fromClientStream(
        6,
        challengeInfo,
        Stage.TOB_MAIDEN,
        [stream],
      );

      expect(client.hasAnomaly(ClientAnomaly.MISSING_STAGE_METADATA)).toBe(
        true,
      );
    });

    describe('consistency', () => {
      it('flags invalid movement and demotes accuracy', () => {
        const client = ClientEvents.fromRawEvents(
          4,
          challengeInfo,
          {
            stage: Stage.TOB_MAIDEN,
            status: StageStatus.STARTED,
            accurate: true,
            recordedTicks: 2,
            serverTicks: { count: 2, precise: true },
          },
          [
            createPlayerUpdateEvent({ tick: 0, name: 'player1', x: 0, y: 0 }),
            createPlayerUpdateEvent({ tick: 1, name: 'player1', x: 10, y: 0 }),
          ],
        );

        expect(client.hasConsistencyIssues()).toBe(true);
        expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(true);
        expect(client.isAccurate()).toBe(false);
      });

      it('reports no issues for valid movement', () => {
        const client = ClientEvents.fromRawEvents(
          5,
          challengeInfo,
          {
            stage: Stage.TOB_MAIDEN,
            status: StageStatus.STARTED,
            accurate: true,
            recordedTicks: 2,
            serverTicks: { count: 2, precise: true },
          },
          [
            createPlayerUpdateEvent({ tick: 0, name: 'player1', x: 0, y: 0 }),
            createPlayerUpdateEvent({ tick: 1, name: 'player1', x: 2, y: 1 }),
          ],
        );

        expect(client.hasConsistencyIssues()).toBe(false);
        expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(false);
        expect(client.isAccurate()).toBe(true);
      });
    });
  });

  describe('player state history', () => {
    it('builds player state history with coordinates and deaths', () => {
      const updates = [
        createPlayerUpdateEvent({ tick: 0, name: 'player1', x: 5, y: 5 }),
        createPlayerUpdateEvent({ tick: 1, name: 'player1', x: 6, y: 7 }),
        (() => {
          const death = new ProtoEvent();
          death.setType(EventType.PLAYER_DEATH as ProtoEventType);
          death.setTick(2);
          death.setStage(Stage.TOB_MAIDEN as ProtoStage);
          const player = new ProtoEvent.Player();
          player.setName('player1');
          death.setPlayer(player);
          return death;
        })(),
      ];

      const client = ClientEvents.fromRawEvents(
        7,
        challengeInfo,
        {
          stage: Stage.TOB_MAIDEN,
          status: StageStatus.STARTED,
          accurate: true,
          recordedTicks: 2,
          serverTicks: null,
        },
        updates,
      );

      const tick0 = client.getTickState(0)?.getPlayerState('player1');
      expect(tick0).toMatchObject({ x: 5, y: 5, isDead: false });

      const tick1 = client.getTickState(1)?.getPlayerState('player1');
      expect(tick1).toMatchObject({ x: 6, y: 7, isDead: false });

      const tick2 = client.getTickState(2)?.getPlayerState('player1');
      expect(tick2).toMatchObject({ x: 6, y: 7, isDead: true });
    });

    it('applies equipment deltas when building player state', () => {
      const createUpdate = (
        tick: number,
        deltas: [number, number, boolean][],
      ) => {
        const event = new ProtoEvent();
        event.setType(EventType.PLAYER_UPDATE as ProtoEventType);
        event.setTick(tick);
        event.setStage(Stage.TOB_MAIDEN as ProtoStage);
        const player = new ProtoEvent.Player();
        player.setName('player1');
        player.setDataSource(DataSource.PRIMARY as ProtoDataSource);
        for (const [itemId, slot, added] of deltas) {
          const delta = new ItemDelta(itemId, 1, slot, added);
          player.addEquipmentDeltas(delta.toRaw());
        }
        event.setPlayer(player);
        return event;
      };

      const client = ClientEvents.fromRawEvents(
        8,
        challengeInfo,
        {
          stage: Stage.TOB_MAIDEN,
          status: StageStatus.STARTED,
          accurate: true,
          recordedTicks: 1,
          serverTicks: null,
        },
        [
          createUpdate(0, [[11840, 1, true]]),
          createUpdate(1, [[11840, 1, false]]),
        ],
      );

      const tick0State = client.getTickState(0)?.getPlayerState('player1');
      expect(tick0State?.equipment[1]).toMatchObject({
        id: 11840,
        quantity: 1,
      });
      const tick1State = client.getTickState(1)?.getPlayerState('player1');
      expect(tick1State?.equipment[1]).toBeNull();
    });
  });
});

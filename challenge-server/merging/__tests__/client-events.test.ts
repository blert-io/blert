import {
  ChallengeMode,
  ChallengeType,
  ClientStageStream,
  DataSource,
  EquipmentSlot,
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
import { ChallengeInfo } from '../context';
import {
  createEvent,
  createNpcDeathEvent,
  createNpcSpawnEvent,
  createNpcUpdateEvent,
  createPlayerUpdateEvent,
} from './fixtures';

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

    it('filters derived events from client input', () => {
      const client = ClientEvents.fromRawEvents(
        7,
        challengeInfo,
        {
          stage: Stage.TOB_NYLOCAS,
          status: StageStatus.STARTED,
          accurate: false,
          recordedTicks: 5,
          serverTicks: null,
        },
        [
          createPlayerUpdateEvent({ tick: 0, name: 'player1' }),
          createEvent(ProtoEvent.Type.TOB_NYLO_WAVE_STALL, 1),
          createEvent(ProtoEvent.Type.TOB_NYLO_BOSS_SPAWN, 2),
          createPlayerUpdateEvent({ tick: 3, name: 'player1' }),
          createEvent(ProtoEvent.Type.TOB_NYLO_CLEANUP_END, 4),
          createEvent(ProtoEvent.Type.TOB_VERZIK_REDS_SPAWN, 5),
        ],
      );

      const allEvents = client
        .getTickStates()
        .flatMap((t) => t?.getEvents() ?? []);
      const eventTypes = new Set(allEvents.map((e) => e.getType()));

      expect(eventTypes.has(ProtoEvent.Type.TOB_NYLO_WAVE_STALL)).toBe(false);
      expect(eventTypes.has(ProtoEvent.Type.TOB_NYLO_BOSS_SPAWN)).toBe(false);
      expect(eventTypes.has(ProtoEvent.Type.TOB_NYLO_CLEANUP_END)).toBe(false);
      expect(eventTypes.has(ProtoEvent.Type.TOB_VERZIK_REDS_SPAWN)).toBe(false);
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
      expect(client.getMetadata()).toBeNull();
    });

    it('flags bad data when a stream chunk fails to decode, keeping the rest', () => {
      const eventsMessage = new ChallengeEvents();
      eventsMessage.setEventsList([
        createPlayerUpdateEvent({
          tick: 0,
          name: 'player1',
          source: DataSource.PRIMARY,
        }),
      ]);
      const stream: ClientStageStream[] = [
        {
          type: StageStreamType.CLIENT_METADATA,
          clientId: 6,
          userId: 42,
          pluginVersion: '0.9.11',
          runeLiteVersion: '1.12.28',
        },
        {
          type: StageStreamType.STAGE_EVENTS,
          clientId: 6,
          events: new Uint8Array([0xff, 0xff, 0xff, 0xff]),
        },
        {
          type: StageStreamType.STAGE_EVENTS,
          clientId: 6,
          events: eventsMessage.serializeBinary(),
        },
        {
          type: StageStreamType.STAGE_END,
          clientId: 6,
          update: {
            stage: Stage.TOB_MAIDEN,
            status: StageStatus.COMPLETED,
            accurate: true,
            recordedTicks: 1,
            serverTicks: { count: 1, precise: true },
          },
        },
      ];

      const client = ClientEvents.fromClientStream(
        6,
        challengeInfo,
        Stage.TOB_MAIDEN,
        stream,
      );

      expect(client.hasAnomaly(ClientAnomaly.BAD_DATA)).toBe(true);
      expect(client.getPrimaryPlayer()).toBe('player1');
      expect(client.getMetadata()).toEqual({
        userId: 42,
        pluginVersion: '0.9.11',
        runeLiteVersion: '1.12.28',
      });
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

    it('rebuilds equipment from empty on a snapshot update', () => {
      const client = ClientEvents.fromRawEvents(
        8,
        challengeInfo,
        {
          stage: Stage.TOB_MAIDEN,
          status: StageStatus.STARTED,
          accurate: true,
          recordedTicks: 2,
          serverTicks: null,
        },
        [
          createPlayerUpdateEvent({
            tick: 0,
            name: 'player1',
            source: DataSource.PRIMARY,
            equipmentDeltas: [
              new ItemDelta(11840, 1, EquipmentSlot.WEAPON, true),
            ],
          }),
          createPlayerUpdateEvent({
            tick: 1,
            name: 'player1',
            source: DataSource.PRIMARY,
            snapshot: true,
            equipmentDeltas: [new ItemDelta(6570, 1, EquipmentSlot.CAPE, true)],
          }),
        ],
      );

      const tick1State = client.getTickState(1)?.getPlayerState('player1');
      expect(tick1State?.equipment[EquipmentSlot.CAPE]).toMatchObject({
        id: 6570,
        quantity: 1,
      });
      // The snapshot rebuilds from empty, dropping the tick 0 weapon.
      expect(tick1State?.equipment[EquipmentSlot.WEAPON]).toBeNull();
    });
  });

  describe('OSRS 238 Nylocas correction', () => {
    const NYLO_ROOM = 100;

    function nyloStage(stage = Stage.TOB_NYLOCAS) {
      return {
        stage,
        status: StageStatus.STARTED,
        accurate: true,
        recordedTicks: 0,
        serverTicks: null,
      };
    }

    function nyloSpawn(
      tick: number,
      x: number,
      y: number,
      stage = Stage.TOB_NYLOCAS,
    ) {
      return createNpcSpawnEvent({
        tick,
        roomId: NYLO_ROOM,
        npcId: 8342,
        x,
        y,
        hitpointsCurrent: 8,
        nylo: { wave: 1, parentRoomId: 0, big: false, style: 0, spawnType: 3 },
        stage,
      });
    }

    function nyloUpdate(tick: number, x: number, y: number) {
      return createNpcUpdateEvent({
        tick,
        roomId: NYLO_ROOM,
        npcId: 8342,
        x,
        y,
        hitpointsCurrent: 8,
        stage: Stage.TOB_NYLOCAS,
      });
    }

    function nyloDeath(
      tick: number,
      x: number,
      y: number,
      stage = Stage.TOB_NYLOCAS,
    ) {
      return createNpcDeathEvent({
        tick,
        roomId: NYLO_ROOM,
        npcId: 8342,
        x,
        y,
        stage,
      });
    }

    function deathCount(client: ClientEvents): number {
      let count = 0;
      for (const tickState of client.getTickStates()) {
        count +=
          tickState?.getEventsByType(ProtoEvent.Type.NPC_DEATH).length ?? 0;
      }
      return count;
    }

    it('interpolates a spurious death across an unambiguous straight-line move', () => {
      const client = ClientEvents.fromRawEvents(1, challengeInfo, nyloStage(), [
        nyloSpawn(1, 10, 10),
        nyloUpdate(2, 11, 10),
        nyloDeath(3, 11, 10), // frozen at the tick 2 tile
        nyloSpawn(4, 13, 10), // respawn one tick later, two tiles east
        nyloUpdate(5, 14, 10),
        nyloDeath(6, 15, 10), // real death
      ]);

      // Only the terminal death survives; the spurious one becomes an update.
      expect(deathCount(client)).toBe(1);
      const corrected = client.getTickState(3)?.getNpcState(NYLO_ROOM);
      expect(corrected).not.toBeNull();
      expect(corrected!.x).toBe(12);
      expect(corrected!.y).toBe(10);
      const spawn = client.getTickState(4)?.getNpcState(NYLO_ROOM);
      expect(spawn).not.toBeNull();
      expect(spawn!.x).toBe(13);
      expect(spawn!.y).toBe(10);

      expect(client.hasAnomaly(ClientAnomaly.GAME_CORRECTION_APPLIED)).toBe(
        true,
      );
      expect(client.getCorrections()).toEqual([
        {
          type: 'osrs_238_nylocas',
          applied: [
            { action: 'rewrite_spawn', tick: 4, roomId: NYLO_ROOM },
            { action: 'rewrite_death', tick: 3, roomId: NYLO_ROOM },
          ],
        },
      ]);
    });

    it('drops a spurious death when the implied move is ambiguous', () => {
      const client = ClientEvents.fromRawEvents(1, challengeInfo, nyloStage(), [
        nyloSpawn(1, 10, 10),
        nyloUpdate(2, 11, 10),
        nyloDeath(3, 11, 10),
        nyloSpawn(4, 13, 11), // L-shaped move with no unique midpoint
        nyloUpdate(5, 14, 11),
        nyloDeath(6, 15, 11),
      ]);

      expect(deathCount(client)).toBe(1);
      expect(client.getTickState(3)?.getNpcState(NYLO_ROOM)).toBeNull();
      expect(client.getCorrections()).toEqual([
        {
          type: 'osrs_238_nylocas',
          applied: [
            { action: 'rewrite_spawn', tick: 4, roomId: NYLO_ROOM },
            { action: 'drop_death', tick: 3, roomId: NYLO_ROOM },
          ],
        },
      ]);
    });

    it('drops rather than interpolates when the boundary shows lag', () => {
      const client = ClientEvents.fromRawEvents(1, challengeInfo, nyloStage(), [
        nyloSpawn(1, 10, 10),
        nyloUpdate(2, 11, 10),
        nyloDeath(3, 11, 10),
        nyloSpawn(4, 13, 10),
        nyloUpdate(5, 14, 10),
        nyloDeath(6, 15, 10),
        createPlayerUpdateEvent({ tick: 3, name: 'player1', x: 0, y: 0 }),
        createPlayerUpdateEvent({ tick: 4, name: 'player1', x: 4, y: 0 }),
      ]);

      expect(deathCount(client)).toBe(1);
      expect(client.getTickState(3)?.getNpcState(NYLO_ROOM)).toBeNull();
    });

    it('collapses multiple spurious lifecycle events', () => {
      const client = ClientEvents.fromRawEvents(1, challengeInfo, nyloStage(), [
        nyloSpawn(1, 10, 10),
        nyloDeath(2, 10, 10),
        nyloSpawn(3, 10, 10),
        nyloDeath(4, 10, 10),
        nyloSpawn(5, 10, 10),
        nyloDeath(6, 10, 10),
      ]);

      expect(deathCount(client)).toBe(1);
      expect(
        client.getTickState(6)?.getEventsByType(ProtoEvent.Type.NPC_DEATH)
          .length,
      ).toBe(1);
    });

    it('leaves a normal spawn/death lifecycle untouched', () => {
      const client = ClientEvents.fromRawEvents(1, challengeInfo, nyloStage(), [
        nyloSpawn(1, 10, 10),
        nyloUpdate(2, 11, 10),
        nyloDeath(3, 12, 10),
      ]);

      expect(deathCount(client)).toBe(1);
      expect(
        client.getTickState(3)?.getEventsByType(ProtoEvent.Type.NPC_DEATH)
          .length,
      ).toBe(1);
      expect(client.getCorrections()).toEqual([]);
      expect(client.hasAnomaly(ClientAnomaly.GAME_CORRECTION_APPLIED)).toBe(
        false,
      );
    });

    it('does not correct stages other than Nylocas', () => {
      const client = ClientEvents.fromRawEvents(
        1,
        challengeInfo,
        nyloStage(Stage.TOB_MAIDEN),
        [
          nyloSpawn(1, 10, 10, Stage.TOB_MAIDEN),
          nyloDeath(2, 10, 10, Stage.TOB_MAIDEN),
          nyloSpawn(3, 10, 10, Stage.TOB_MAIDEN),
          nyloDeath(4, 10, 10, Stage.TOB_MAIDEN),
        ],
      );

      expect(deathCount(client)).toBe(2);
      expect(client.getCorrections()).toEqual([]);
      expect(client.hasAnomaly(ClientAnomaly.GAME_CORRECTION_APPLIED)).toBe(
        false,
      );
    });
  });
});

import {
  ChallengeMode,
  ChallengeType,
  Maze,
  NpcId,
  Stage,
  StageStatus,
} from '@blert/common';
import {
  Event as ProtoEvent,
  StageMap,
} from '@blert/common/generated/event_pb';

import { ClientEvents } from '../client-events';
import { ChallengeInfo, MergeContext, RegisteredClient } from '../context';
import {
  mergeStageData,
  NylocasDerivedEvents,
  VerzikDerivedEvents,
} from '../derivation';
import { MergeMapping } from '../tick-mapping';
import { TickStateArray } from '../tick-state';
import { protoCoords } from '../world';

import {
  createNpcSpawnEvent,
  createNpcUpdateEvent,
  createPlayerUpdateEvent,
  createTickState,
} from './fixtures';

type ProtoStage = StageMap[keyof StageMap];

function buildTimeline(
  ticks: { tick: number; events?: ProtoEvent[] }[],
  totalTicks: number,
): TickStateArray {
  const eventsByTick = new Map<number, ProtoEvent[]>();
  for (const { tick, events = [] } of ticks) {
    const existing = eventsByTick.get(tick) ?? [];
    eventsByTick.set(tick, [...existing, ...events]);
  }
  const result: TickStateArray = new Array<null>(totalTicks).fill(null);
  for (const [tick, events] of eventsByTick) {
    result[tick] = createTickState(tick, [], events);
  }
  return result;
}

describe('NylocasDerivedEvents', () => {
  function createNyloWaveSpawnEvent(
    tick: number,
    wave: number,
    options: { nylosAlive?: number; roomCap?: number } = {},
  ): ProtoEvent {
    const event = new ProtoEvent();
    event.setType(ProtoEvent.Type.TOB_NYLO_WAVE_SPAWN);
    event.setTick(tick);
    event.setStage(Stage.TOB_NYLOCAS as ProtoStage);
    const nyloWave = new ProtoEvent.NyloWave();
    nyloWave.setWave(wave);
    nyloWave.setNylosAlive(options.nylosAlive ?? 3);
    nyloWave.setRoomCap(options.roomCap ?? 12);
    event.setNyloWave(nyloWave);
    return event;
  }

  function nyloUpdate(tick: number, roomId: number): ProtoEvent {
    return createNpcUpdateEvent({
      tick,
      roomId,
      npcId: NpcId.NYLOCAS_ISCHYROS_SMALL_REGULAR,
      x: 0,
      y: 0,
      hitpointsCurrent: 8,
      stage: Stage.TOB_NYLOCAS,
    });
  }

  function vasiliasSpawn(
    tick: number,
    dropping: boolean = true,
    x: number = 0,
    y: number = 0,
  ): ProtoEvent {
    return createNpcSpawnEvent({
      tick,
      roomId: 999,
      npcId: dropping
        ? NpcId.NYLOCAS_VASILIAS_DROPPING_REGULAR
        : NpcId.NYLOCAS_VASILIAS_MELEE_REGULAR,
      x,
      y,
      hitpointsCurrent: 100,
      stage: Stage.TOB_NYLOCAS,
    });
  }

  function tickEventsByTick(
    ticks: TickStateArray,
    type: ProtoEvent.TypeMap[keyof ProtoEvent.TypeMap],
  ): number[] {
    const result: number[] = [];
    ticks.forEach((tick, idx) => {
      if (tick === null) {
        return;
      }
      if (tick.getEventsByType(type).length > 0) {
        result.push(idx);
      }
    });
    return result;
  }

  it('emits stalls every 4 ticks after the natural stall, until next wave', () => {
    // Wave 1's natural stall is 4. Wave 2 spawns at tick 14, before what
    // would be the 4th stall.
    const ticks = buildTimeline(
      [
        { tick: 0, events: [createNyloWaveSpawnEvent(0, 1)] },
        { tick: 14, events: [createNyloWaveSpawnEvent(14, 2)] },
      ],
      20,
    );

    new NylocasDerivedEvents(ChallengeMode.TOB_REGULAR).derive(ticks);

    expect(
      tickEventsByTick(ticks, ProtoEvent.Type.TOB_NYLO_WAVE_STALL),
    ).toEqual([4, 8, 12, 18]);
  });

  it('stops emitting stalls once wave 31 spawns', () => {
    const ticks = buildTimeline(
      [
        { tick: 0, events: [createNyloWaveSpawnEvent(0, 30)] },
        {
          tick: 4,
          events: [createNyloWaveSpawnEvent(4, 31), nyloUpdate(4, 1)],
        },
        { tick: 5, events: [nyloUpdate(5, 1)] },
        { tick: 6, events: [nyloUpdate(6, 1)] },
        { tick: 7, events: [nyloUpdate(7, 1)] },
        { tick: 8, events: [nyloUpdate(8, 1)] },
        { tick: 9, events: [nyloUpdate(9, 1)] },
        { tick: 10, events: [nyloUpdate(10, 1)] },
        { tick: 11, events: [nyloUpdate(11, 1)] },
        { tick: 12, events: [nyloUpdate(12, 1)] },
        { tick: 13, events: [nyloUpdate(13, 1)] },
        { tick: 14, events: [nyloUpdate(14, 1)] },
        { tick: 15, events: [nyloUpdate(15, 1)] },
        { tick: 16, events: [nyloUpdate(16, 1)] },
      ],
      20,
    );

    new NylocasDerivedEvents(ChallengeMode.TOB_REGULAR).derive(ticks);

    expect(
      tickEventsByTick(ticks, ProtoEvent.Type.TOB_NYLO_WAVE_STALL),
    ).toEqual([]);
  });

  it('emits cleanup_end on the first empty-npcs tick after wave 31', () => {
    const ticks = buildTimeline(
      [
        {
          tick: 0,
          events: [createNyloWaveSpawnEvent(0, 31), nyloUpdate(0, 1)],
        },
        { tick: 1, events: [nyloUpdate(1, 1)] },
        { tick: 2, events: [nyloUpdate(2, 1)] },
        { tick: 3, events: [] },
        { tick: 4, events: [] },
      ],
      8,
    );

    new NylocasDerivedEvents(ChallengeMode.TOB_REGULAR).derive(ticks);

    expect(
      tickEventsByTick(ticks, ProtoEvent.Type.TOB_NYLO_CLEANUP_END),
    ).toEqual([3]);
  });

  it('does not re-emit cleanup_end while npcs stays empty', () => {
    const ticks = buildTimeline(
      [
        {
          tick: 0,
          events: [createNyloWaveSpawnEvent(0, 31), nyloUpdate(0, 1)],
        },
        { tick: 1, events: [nyloUpdate(1, 1)] },
        { tick: 2, events: [] },
        { tick: 3, events: [] },
        { tick: 4, events: [] },
      ],
      8,
    );

    new NylocasDerivedEvents(ChallengeMode.TOB_REGULAR).derive(ticks);

    expect(
      tickEventsByTick(ticks, ProtoEvent.Type.TOB_NYLO_CLEANUP_END),
    ).toEqual([2]);
  });

  it('does not emit cleanup_end without seeing wave 31', () => {
    const ticks = buildTimeline(
      [
        { tick: 0, events: [createNyloWaveSpawnEvent(0, 1), nyloUpdate(0, 1)] },
        // Ticks 1-7 are present but empty; should not fire cleanup_end.
      ],
      8,
    );

    new NylocasDerivedEvents(ChallengeMode.TOB_REGULAR).derive(ticks);

    expect(
      tickEventsByTick(ticks, ProtoEvent.Type.TOB_NYLO_CLEANUP_END),
    ).toEqual([]);
  });

  it('emits boss_spawn on the first tick the boss is present', () => {
    const ticks = buildTimeline(
      [
        { tick: 0, events: [createNyloWaveSpawnEvent(0, 31)] },
        { tick: 5, events: [vasiliasSpawn(5, true)] },
      ],
      10,
    );

    new NylocasDerivedEvents(ChallengeMode.TOB_REGULAR).derive(ticks);

    expect(
      tickEventsByTick(ticks, ProtoEvent.Type.TOB_NYLO_BOSS_SPAWN),
    ).toEqual([5]);
  });

  it('detects boss_spawn on a non-dropping vasilias', () => {
    const ticks = buildTimeline(
      [
        { tick: 0, events: [createNyloWaveSpawnEvent(0, 31)] },
        // Client missed dropping form; sees melee form directly.
        { tick: 5, events: [vasiliasSpawn(5, false)] },
      ],
      10,
    );

    new NylocasDerivedEvents(ChallengeMode.TOB_REGULAR).derive(ticks);

    expect(
      tickEventsByTick(ticks, ProtoEvent.Type.TOB_NYLO_BOSS_SPAWN),
    ).toEqual([5]);
  });

  it('emits boss_spawn on first sight when client joined late', () => {
    // First recorded tick already has the boss.
    const ticks = buildTimeline([{ tick: 0, events: [vasiliasSpawn(0)] }], 5);

    new NylocasDerivedEvents(ChallengeMode.TOB_REGULAR).derive(ticks);

    expect(
      tickEventsByTick(ticks, ProtoEvent.Type.TOB_NYLO_BOSS_SPAWN),
    ).toEqual([0]);
    expect(
      tickEventsByTick(ticks, ProtoEvent.Type.TOB_NYLO_CLEANUP_END),
    ).toEqual([]);
    expect(
      tickEventsByTick(ticks, ProtoEvent.Type.TOB_NYLO_WAVE_STALL),
    ).toEqual([]);
  });

  it('populates fields on stall events', () => {
    const ticks = buildTimeline(
      [
        {
          tick: 0,
          events: [
            createNyloWaveSpawnEvent(0, 1, { roomCap: 12 }),
            nyloUpdate(0, 1),
            nyloUpdate(0, 2),
            nyloUpdate(0, 3),
          ],
        },
        {
          tick: 4,
          events: [nyloUpdate(4, 1), nyloUpdate(4, 2)],
        },
      ],
      6,
    );

    new NylocasDerivedEvents(ChallengeMode.TOB_REGULAR).derive(ticks);

    const stalls = ticks[4]!.getEventsByType(
      ProtoEvent.Type.TOB_NYLO_WAVE_STALL,
    );
    expect(stalls).toHaveLength(1);
    const wave = stalls[0].getNyloWave()!;
    expect(wave.getWave()).toBe(1);
    expect(wave.getNylosAlive()).toBe(2);
    expect(wave.getRoomCap()).toBe(12);
  });

  it('populates coords on boss_spawn events', () => {
    const ticks = buildTimeline(
      [
        { tick: 0, events: [createNyloWaveSpawnEvent(0, 31)] },
        { tick: 5, events: [vasiliasSpawn(5, true, 3299, 4248)] },
      ],
      10,
    );

    new NylocasDerivedEvents(ChallengeMode.TOB_REGULAR).derive(ticks);

    const bossEvents = ticks[5]!.getEventsByType(
      ProtoEvent.Type.TOB_NYLO_BOSS_SPAWN,
    );
    expect(bossEvents).toHaveLength(1);
    expect(bossEvents[0].getXCoord()).toBe(3299);
    expect(bossEvents[0].getYCoord()).toBe(4248);
  });

  it('synthesizes a tick state when a stall lands on a null tick', () => {
    const ticks: TickStateArray = [
      createTickState(0, [], [createNyloWaveSpawnEvent(0, 1)]),
      null,
      null,
      null,
      null, // tick 4: stall would fire here, but the tick is null
      null,
      null,
      null,
    ];

    new NylocasDerivedEvents(ChallengeMode.TOB_REGULAR).derive(ticks);

    expect(ticks[4]).not.toBeNull();
    expect(
      ticks[4]!.getEventsByType(ProtoEvent.Type.TOB_NYLO_WAVE_STALL),
    ).toHaveLength(1);
    expect(
      ticks[4]!
        .getEventsByType(ProtoEvent.Type.TOB_NYLO_WAVE_STALL)[0]
        .getTick(),
    ).toBe(4);
  });
});

describe('VerzikDerivedEvents', () => {
  it('emits TOB_VERZIK_REDS_SPAWN on the tick of the first red crab spawn', () => {
    const ticks = buildTimeline(
      [
        {
          tick: 5,
          events: [
            createNpcSpawnEvent({
              tick: 5,
              roomId: 1,
              npcId: NpcId.VERZIK_MATOMENOS_REGULAR,
              x: 0,
              y: 0,
              hitpointsCurrent: 100,
              stage: Stage.TOB_VERZIK,
            }),
          ],
        },
      ],
      10,
    );

    new VerzikDerivedEvents().derive(ticks);

    const events = ticks[5]!.getEventsByType(
      ProtoEvent.Type.TOB_VERZIK_REDS_SPAWN,
    );
    expect(events).toHaveLength(1);
    expect(events[0].getTick()).toBe(5);
    expect(events[0].getStage()).toBe(Stage.TOB_VERZIK);
  });

  it('emits only on the first reds spawn even if more spawn later', () => {
    const ticks = buildTimeline(
      [
        {
          tick: 5,
          events: [
            createNpcSpawnEvent({
              tick: 5,
              roomId: 1,
              npcId: NpcId.VERZIK_MATOMENOS_REGULAR,
              x: 0,
              y: 0,
              hitpointsCurrent: 100,
              stage: Stage.TOB_VERZIK,
            }),
          ],
        },
        {
          tick: 8,
          events: [
            createNpcSpawnEvent({
              tick: 8,
              roomId: 2,
              npcId: NpcId.VERZIK_MATOMENOS_REGULAR,
              x: 1,
              y: 1,
              hitpointsCurrent: 100,
              stage: Stage.TOB_VERZIK,
            }),
          ],
        },
      ],
      10,
    );

    new VerzikDerivedEvents().derive(ticks);

    expect(
      ticks[5]!.getEventsByType(ProtoEvent.Type.TOB_VERZIK_REDS_SPAWN),
    ).toHaveLength(1);
    expect(
      ticks[8]!.getEventsByType(ProtoEvent.Type.TOB_VERZIK_REDS_SPAWN),
    ).toHaveLength(0);
  });

  it('emits nothing when no red crabs spawn', () => {
    const ticks = buildTimeline(
      [
        {
          tick: 3,
          events: [
            createNpcSpawnEvent({
              tick: 3,
              roomId: 1,
              npcId: NpcId.VERZIK_ATHANATOS_REGULAR,
              x: 0,
              y: 0,
              hitpointsCurrent: 100,
              stage: Stage.TOB_VERZIK,
            }),
          ],
        },
      ],
      10,
    );

    new VerzikDerivedEvents().derive(ticks);

    for (const tick of ticks) {
      if (tick === null) {
        continue;
      }
      expect(
        tick.getEventsByType(ProtoEvent.Type.TOB_VERZIK_REDS_SPAWN),
      ).toHaveLength(0);
    }
  });
});

describe('mergeStageData', () => {
  describe('sote pivots', () => {
    function createSotePivotEvent(
      tick: number,
      maze: Maze,
      options: {
        overworld?: { x: number; y: number }[];
        underworld?: { x: number; y: number }[];
      },
    ): ProtoEvent {
      const event = new ProtoEvent();
      event.setType(ProtoEvent.Type.TOB_SOTE_MAZE_PATH);
      event.setTick(tick);
      event.setStage(Stage.TOB_SOTETSEG as ProtoStage);
      const soteMaze = new ProtoEvent.SoteMaze();
      soteMaze.setMaze(
        maze as ProtoEvent.SoteMaze.MazeMap[keyof ProtoEvent.SoteMaze.MazeMap],
      );
      if (options.overworld !== undefined) {
        soteMaze.setOverworldPivotsList(options.overworld.map(protoCoords));
      }
      if (options.underworld !== undefined) {
        soteMaze.setUnderworldPivotsList(options.underworld.map(protoCoords));
      }
      event.setSoteMaze(soteMaze);
      return event;
    }

    function createSoteMazeEndEvent(tick: number, maze: Maze): ProtoEvent {
      const event = new ProtoEvent();
      event.setType(ProtoEvent.Type.TOB_SOTE_MAZE_END);
      event.setTick(tick);
      event.setStage(Stage.TOB_SOTETSEG as ProtoStage);
      const soteMaze = new ProtoEvent.SoteMaze();
      soteMaze.setMaze(
        maze as ProtoEvent.SoteMaze.MazeMap[keyof ProtoEvent.SoteMaze.MazeMap],
      );
      event.setSoteMaze(soteMaze);
      return event;
    }

    const SOTE_TEST_CHALLENGE: ChallengeInfo = {
      uuid: 'sote-test',
      type: ChallengeType.TOB,
      mode: ChallengeMode.TOB_REGULAR,
      party: ['player1'],
    };

    function createSoteClient(
      clientId: number,
      primaryPlayer: string,
      pivotEvents: ProtoEvent[],
    ): ClientEvents {
      const events: ProtoEvent[] = [
        createPlayerUpdateEvent({
          tick: 0,
          name: primaryPlayer,
        }),
        ...pivotEvents,
      ];
      const lastTick = events.reduce((max, e) => Math.max(max, e.getTick()), 0);
      return ClientEvents.fromRawEvents(
        clientId,
        { ...SOTE_TEST_CHALLENGE, party: [primaryPlayer] },
        {
          stage: Stage.TOB_SOTETSEG,
          status: StageStatus.COMPLETED,
          accurate: false,
          recordedTicks: lastTick,
          serverTicks: null,
        },
        events,
      );
    }

    function soteCtx(
      clients: Map<number, RegisteredClient>,
      stage: Stage = Stage.TOB_SOTETSEG,
    ): MergeContext {
      const ids = [...clients.keys()];
      return {
        challenge: SOTE_TEST_CHALLENGE,
        stage,
        clients,
        mapping: new MergeMapping(ids[0] ?? 0),
        tracer: undefined,
      };
    }
    it('emits a consolidated event at the maze-end tick with unioned pivots', () => {
      const clientA = createSoteClient(1, 'player1', [
        createSotePivotEvent(8, Maze.MAZE_66, {
          underworld: [
            { x: 100, y: 0 },
            { x: 101, y: 2 },
          ],
        }),
      ]);
      const clientB = createSoteClient(2, 'player2', [
        createSotePivotEvent(8, Maze.MAZE_66, {
          underworld: [
            { x: 102, y: 4 },
            { x: 103, y: 6 },
          ],
        }),
      ]);

      const ticks: TickStateArray = new Array<null>(15).fill(null);
      ticks[10] = createTickState(
        10,
        [],
        [createSoteMazeEndEvent(10, Maze.MAZE_66)],
      );

      const ctx = soteCtx(
        new Map<number, RegisteredClient>([
          [1, { client: clientA }],
          [2, { client: clientB }],
        ]),
      );

      mergeStageData(ctx, ticks);

      const events = ticks[10].getEventsByType(
        ProtoEvent.Type.TOB_SOTE_MAZE_PATH,
      );
      expect(events).toHaveLength(1);
      expect(events[0].getTick()).toBe(10);
      expect(events[0].getStage()).toBe(Stage.TOB_SOTETSEG);
      const soteMaze = events[0].getSoteMaze()!;
      expect(soteMaze.getMaze()).toBe(Maze.MAZE_66);

      const underworld = soteMaze
        .getUnderworldPivotsList()
        .map((c) => ({ x: c.getX(), y: c.getY() }));
      expect(underworld).toEqual([
        { x: 100, y: 0 },
        { x: 101, y: 2 },
        { x: 102, y: 4 },
        { x: 103, y: 6 },
      ]);
    });

    it('sorts pivots by y in the consolidated event', () => {
      const clientA = createSoteClient(1, 'player1', [
        createSotePivotEvent(8, Maze.MAZE_33, {
          underworld: [
            { x: 50, y: 6 },
            { x: 51, y: 0 },
          ],
        }),
      ]);
      const clientB = createSoteClient(2, 'player2', [
        createSotePivotEvent(8, Maze.MAZE_33, {
          underworld: [
            { x: 52, y: 4 },
            { x: 53, y: 2 },
          ],
        }),
      ]);

      const ticks: TickStateArray = new Array<null>(15).fill(null);
      ticks[10] = createTickState(
        10,
        [],
        [createSoteMazeEndEvent(10, Maze.MAZE_33)],
      );

      mergeStageData(
        soteCtx(
          new Map<number, RegisteredClient>([
            [1, { client: clientA }],
            [2, { client: clientB }],
          ]),
        ),
        ticks,
      );

      const yValues = ticks[10]
        .getEventsByType(ProtoEvent.Type.TOB_SOTE_MAZE_PATH)[0]
        .getSoteMaze()!
        .getUnderworldPivotsList()
        .map((c) => c.getY());
      expect(yValues).toEqual([0, 2, 4, 6]);
    });

    it('dedupes exact-match coords across clients', () => {
      const clientA = createSoteClient(1, 'player1', [
        createSotePivotEvent(8, Maze.MAZE_66, {
          underworld: [
            { x: 100, y: 0 },
            { x: 101, y: 2 },
          ],
        }),
      ]);
      const clientB = createSoteClient(2, 'player2', [
        createSotePivotEvent(8, Maze.MAZE_66, {
          underworld: [
            { x: 100, y: 0 }, // duplicate of client A's first
            { x: 102, y: 4 },
          ],
        }),
      ]);

      const ticks: TickStateArray = new Array<null>(15).fill(null);
      ticks[10] = createTickState(
        10,
        [],
        [createSoteMazeEndEvent(10, Maze.MAZE_66)],
      );

      mergeStageData(
        soteCtx(
          new Map<number, RegisteredClient>([
            [1, { client: clientA }],
            [2, { client: clientB }],
          ]),
        ),
        ticks,
      );

      const underworld = ticks[10]
        .getEventsByType(ProtoEvent.Type.TOB_SOTE_MAZE_PATH)[0]
        .getSoteMaze()!
        .getUnderworldPivotsList();
      expect(underworld).toHaveLength(3);
    });

    it('emits one event per maze', () => {
      const clientA = createSoteClient(1, 'player1', [
        createSotePivotEvent(8, Maze.MAZE_66, {
          underworld: [{ x: 100, y: 0 }],
        }),
        createSotePivotEvent(20, Maze.MAZE_33, {
          underworld: [{ x: 200, y: 0 }],
        }),
      ]);

      const ticks: TickStateArray = new Array<null>(30).fill(null);
      ticks[10] = createTickState(
        10,
        [],
        [createSoteMazeEndEvent(10, Maze.MAZE_66)],
      );
      ticks[25] = createTickState(
        25,
        [],
        [createSoteMazeEndEvent(25, Maze.MAZE_33)],
      );

      mergeStageData(
        soteCtx(new Map<number, RegisteredClient>([[1, { client: clientA }]])),
        ticks,
      );

      const maze1 = ticks[10].getEventsByType(
        ProtoEvent.Type.TOB_SOTE_MAZE_PATH,
      );
      const maze2 = ticks[25].getEventsByType(
        ProtoEvent.Type.TOB_SOTE_MAZE_PATH,
      );
      expect(maze1).toHaveLength(1);
      expect(maze1[0].getSoteMaze()!.getMaze()).toBe(Maze.MAZE_66);
      expect(maze2).toHaveLength(1);
      expect(maze2[0].getSoteMaze()!.getMaze()).toBe(Maze.MAZE_33);
    });

    it('is a no-op for non-Sotetseg stages', () => {
      const ticks: TickStateArray = new Array<null>(5).fill(null);
      mergeStageData(soteCtx(new Map(), Stage.TOB_VERZIK), ticks);
      for (const tick of ticks) {
        expect(tick).toBeNull();
      }
    });

    it('does not emit when no pivot data was observed', () => {
      const clientA = createSoteClient(1, 'player1', []);

      const ticks: TickStateArray = new Array<null>(15).fill(null);
      ticks[10] = createTickState(
        10,
        [],
        [createSoteMazeEndEvent(10, Maze.MAZE_66)],
      );

      mergeStageData(
        soteCtx(new Map<number, RegisteredClient>([[1, { client: clientA }]])),
        ticks,
      );

      expect(
        ticks[10].getEventsByType(ProtoEvent.Type.TOB_SOTE_MAZE_PATH),
      ).toHaveLength(0);
    });

    it('does not emit when there is no maze-end tick for the maze', () => {
      const clientA = createSoteClient(1, 'player1', [
        createSotePivotEvent(8, Maze.MAZE_66, {
          underworld: [{ x: 100, y: 0 }],
        }),
      ]);

      const ticks: TickStateArray = new Array<null>(15).fill(null);

      mergeStageData(
        soteCtx(new Map<number, RegisteredClient>([[1, { client: clientA }]])),
        ticks,
      );

      for (const tick of ticks) {
        if (tick === null) {
          continue;
        }
        expect(
          tick.getEventsByType(ProtoEvent.Type.TOB_SOTE_MAZE_PATH),
        ).toHaveLength(0);
      }
    });
  });
});

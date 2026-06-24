import { NpcAttack, PlayerAttack, Stage } from '@blert/common';
import { Event as ProtoEvent } from '@blert/common/generated/event_pb';

import { MergeContext } from '../context';
import {
  MergeConsistencyChecker,
  MergeConsistencyIssue,
} from '../merge-consistency';
import { TickStateArray } from '../tick-state';

import {
  buildTickTimeline,
  createEvent,
  createMergeContext,
  createNpcAttackEvent,
  createNpcDeathEvent,
  createNpcSpawnEvent,
  createNpcUpdateEvent,
  createPlayerDeathEvent,
  createPlayerState,
  createTickState,
} from './fixtures';

function runChecker(
  ticks: TickStateArray,
  overrides?: Partial<MergeContext>,
): MergeConsistencyIssue[] {
  return new MergeConsistencyChecker(createMergeContext(overrides)).check(
    ticks,
  );
}

type VerzikPhase = ProtoEvent.VerzikPhaseMap[keyof ProtoEvent.VerzikPhaseMap];
type XarpusPhase = ProtoEvent.XarpusPhaseMap[keyof ProtoEvent.XarpusPhaseMap];
type Maze = ProtoEvent.SoteMaze.MazeMap[keyof ProtoEvent.SoteMaze.MazeMap];

function createVerzikPhaseEvent(tick: number, phase: VerzikPhase): ProtoEvent {
  const event = createEvent(ProtoEvent.Type.TOB_VERZIK_PHASE, tick);
  event.setVerzikPhase(phase);
  return event;
}

function createXarpusPhaseEvent(tick: number, phase: XarpusPhase): ProtoEvent {
  const event = createEvent(ProtoEvent.Type.TOB_XARPUS_PHASE, tick);
  event.setXarpusPhase(phase);
  return event;
}

function createNyloWaveSpawnEvent(tick: number, wave: number): ProtoEvent {
  const event = createEvent(ProtoEvent.Type.TOB_NYLO_WAVE_SPAWN, tick);
  const nyloWave = new ProtoEvent.NyloWave();
  nyloWave.setWave(wave);
  nyloWave.setNylosAlive(4);
  nyloWave.setRoomCap(12);
  event.setNyloWave(nyloWave);
  return event;
}

function createSoteMazeEvent(
  type:
    | typeof ProtoEvent.Type.TOB_SOTE_MAZE_PROC
    | typeof ProtoEvent.Type.TOB_SOTE_MAZE_END,
  tick: number,
  maze: Maze,
): ProtoEvent {
  const event = createEvent(type, tick);
  const soteMaze = new ProtoEvent.SoteMaze();
  soteMaze.setMaze(maze);
  event.setSoteMaze(soteMaze);
  return event;
}

const NPC_ID = 8360;
const ROOM_ID_A = 1001;
const ROOM_ID_B = 1002;

describe('MergeConsistencyChecker', () => {
  describe('actor lifecycles', () => {
    it('reports no issues for a well-formed timeline', () => {
      const ticks = buildTickTimeline(10, {
        0: [
          createNpcSpawnEvent({
            tick: 0,
            roomId: ROOM_ID_A,
            npcId: NPC_ID,
            x: 0,
            y: 0,
            hitpointsCurrent: 100,
          }),
        ],
        5: [createPlayerDeathEvent({ tick: 5, name: 'player1' })],
        8: [createNpcDeathEvent({ tick: 8, roomId: ROOM_ID_A, npcId: NPC_ID })],
      });

      expect(runChecker(ticks)).toEqual([]);
    });

    it('reports a duplicate PLAYER_DEATH for the same player on different ticks', () => {
      const ticks = buildTickTimeline(10, {
        3: [createPlayerDeathEvent({ tick: 3, name: 'player1' })],
        7: [createPlayerDeathEvent({ tick: 7, name: 'player1' })],
      });

      expect(runChecker(ticks)).toEqual([
        {
          kind: 'DUPLICATE_PLAYER_DEATH',
          player: 'player1',
          ticks: [3, 7],
        },
      ]);
    });

    it('reports a duplicate PLAYER_DEATH for two deaths on the same tick', () => {
      const ticks = buildTickTimeline(5, {
        2: [
          createPlayerDeathEvent({ tick: 2, name: 'player1' }),
          createPlayerDeathEvent({ tick: 2, name: 'player1' }),
        ],
      });

      expect(runChecker(ticks)).toEqual([
        {
          kind: 'DUPLICATE_PLAYER_DEATH',
          player: 'player1',
          ticks: [2, 2],
        },
      ]);
    });

    it('does not conflate deaths from different players', () => {
      const ticks = buildTickTimeline(10, {
        3: [createPlayerDeathEvent({ tick: 3, name: 'player1' })],
        5: [createPlayerDeathEvent({ tick: 5, name: 'player2' })],
        7: [createPlayerDeathEvent({ tick: 7, name: 'player1' })],
      });

      const issues = runChecker(ticks);
      expect(issues).toEqual([
        {
          kind: 'DUPLICATE_PLAYER_DEATH',
          player: 'player1',
          ticks: [3, 7],
        },
      ]);
    });

    it('reports a duplicate NPC_SPAWN keyed by roomId', () => {
      const ticks = buildTickTimeline(10, {
        0: [
          createNpcSpawnEvent({
            tick: 0,
            roomId: ROOM_ID_A,
            npcId: NPC_ID,
            x: 0,
            y: 0,
            hitpointsCurrent: 100,
          }),
        ],
        4: [
          createNpcSpawnEvent({
            tick: 4,
            roomId: ROOM_ID_A,
            npcId: NPC_ID,
            x: 0,
            y: 0,
            hitpointsCurrent: 100,
          }),
        ],
      });

      expect(runChecker(ticks)).toEqual([
        {
          kind: 'DUPLICATE_NPC_SPAWN',
          roomId: ROOM_ID_A,
          occurrences: [
            { tick: 0, npcId: NPC_ID },
            { tick: 4, npcId: NPC_ID },
          ],
        },
      ]);
    });

    it('captures differing npc IDs in duplicate spawn occurrences', () => {
      const ticks = buildTickTimeline(10, {
        0: [
          createNpcSpawnEvent({
            tick: 0,
            roomId: ROOM_ID_A,
            npcId: 100,
            x: 0,
            y: 0,
            hitpointsCurrent: 100,
          }),
        ],
        4: [
          createNpcSpawnEvent({
            tick: 4,
            roomId: ROOM_ID_A,
            npcId: 200,
            x: 0,
            y: 0,
            hitpointsCurrent: 100,
          }),
        ],
      });

      const issues = runChecker(ticks);
      expect(issues).toEqual([
        {
          kind: 'DUPLICATE_NPC_SPAWN',
          roomId: ROOM_ID_A,
          occurrences: [
            { tick: 0, npcId: 100 },
            { tick: 4, npcId: 200 },
          ],
        },
      ]);
    });

    it('reports a duplicate NPC_DEATH keyed by roomId', () => {
      const ticks = buildTickTimeline(10, {
        0: [
          createNpcSpawnEvent({
            tick: 0,
            roomId: ROOM_ID_A,
            npcId: NPC_ID,
            x: 0,
            y: 0,
            hitpointsCurrent: 100,
          }),
        ],
        5: [createNpcDeathEvent({ tick: 5, roomId: ROOM_ID_A, npcId: NPC_ID })],
        8: [createNpcDeathEvent({ tick: 8, roomId: ROOM_ID_A, npcId: NPC_ID })],
      });

      expect(runChecker(ticks)).toEqual([
        {
          kind: 'DUPLICATE_NPC_DEATH',
          roomId: ROOM_ID_A,
          occurrences: [
            { tick: 5, npcId: NPC_ID },
            { tick: 8, npcId: NPC_ID },
          ],
        },
      ]);
    });

    it('does not conflate spawn/death across roomIds', () => {
      const ticks = buildTickTimeline(10, {
        0: [
          createNpcSpawnEvent({
            tick: 0,
            roomId: ROOM_ID_A,
            npcId: 100,
            x: 0,
            y: 0,
            hitpointsCurrent: 100,
          }),
          createNpcSpawnEvent({
            tick: 0,
            roomId: ROOM_ID_B,
            npcId: 200,
            x: 0,
            y: 0,
            hitpointsCurrent: 100,
          }),
        ],
        5: [createNpcDeathEvent({ tick: 5, roomId: ROOM_ID_A, npcId: 100 })],
        8: [createNpcDeathEvent({ tick: 8, roomId: ROOM_ID_B, npcId: 200 })],
      });

      expect(runChecker(ticks)).toEqual([]);
    });

    it('reports DEATH_BEFORE_SPAWN when a spawn appears after the death', () => {
      const ticks = buildTickTimeline(10, {
        3: [createNpcDeathEvent({ tick: 3, roomId: ROOM_ID_A, npcId: NPC_ID })],
        6: [
          createNpcSpawnEvent({
            tick: 6,
            roomId: ROOM_ID_A,
            npcId: NPC_ID,
            x: 0,
            y: 0,
            hitpointsCurrent: 100,
          }),
        ],
      });

      expect(runChecker(ticks)).toEqual([
        {
          kind: 'DEATH_BEFORE_SPAWN',
          roomId: ROOM_ID_A,
          deathTick: 3,
          spawnTick: 6,
        },
      ]);
    });

    it('reports DEATH_BEFORE_SPAWN when no spawn exists at all', () => {
      const ticks = buildTickTimeline(10, {
        4: [createNpcDeathEvent({ tick: 4, roomId: ROOM_ID_A, npcId: NPC_ID })],
      });

      expect(runChecker(ticks)).toEqual([
        {
          kind: 'DEATH_BEFORE_SPAWN',
          roomId: ROOM_ID_A,
          deathTick: 4,
          spawnTick: null,
        },
      ]);
    });

    it('reports DEATH_BEFORE_SPAWN when spawn and death share a tick', () => {
      const ticks = buildTickTimeline(10, {
        3: [
          createNpcSpawnEvent({
            tick: 3,
            roomId: ROOM_ID_A,
            npcId: NPC_ID,
            x: 0,
            y: 0,
            hitpointsCurrent: 100,
          }),
          createNpcDeathEvent({ tick: 3, roomId: ROOM_ID_A, npcId: NPC_ID }),
        ],
      });

      expect(runChecker(ticks)).toEqual([
        {
          kind: 'DEATH_BEFORE_SPAWN',
          roomId: ROOM_ID_A,
          deathTick: 3,
          spawnTick: 3,
        },
      ]);
    });

    it('skips null ticks in the timeline', () => {
      const ticks: TickStateArray = [
        createTickState(
          0,
          [],
          [
            createNpcSpawnEvent({
              tick: 0,
              roomId: ROOM_ID_A,
              npcId: NPC_ID,
              x: 0,
              y: 0,
              hitpointsCurrent: 100,
            }),
          ],
        ),
        null,
        null,
        createTickState(
          3,
          [],
          [createNpcDeathEvent({ tick: 3, roomId: ROOM_ID_A, npcId: NPC_ID })],
        ),
      ];

      expect(runChecker(ticks)).toEqual([]);
    });

    it('emits both duplicate-spawn and DEATH_BEFORE_SPAWN when both apply', () => {
      const ticks = buildTickTimeline(10, {
        2: [createNpcDeathEvent({ tick: 2, roomId: ROOM_ID_A, npcId: NPC_ID })],
        5: [
          createNpcSpawnEvent({
            tick: 5,
            roomId: ROOM_ID_A,
            npcId: NPC_ID,
            x: 0,
            y: 0,
            hitpointsCurrent: 100,
          }),
        ],
        8: [
          createNpcSpawnEvent({
            tick: 8,
            roomId: ROOM_ID_A,
            npcId: NPC_ID,
            x: 0,
            y: 0,
            hitpointsCurrent: 100,
          }),
        ],
      });

      const issues = runChecker(ticks);
      expect(issues).toEqual(
        expect.arrayContaining([
          {
            kind: 'DUPLICATE_NPC_SPAWN',
            roomId: ROOM_ID_A,
            occurrences: [
              { tick: 5, npcId: NPC_ID },
              { tick: 8, npcId: NPC_ID },
            ],
          },
          {
            kind: 'DEATH_BEFORE_SPAWN',
            roomId: ROOM_ID_A,
            deathTick: 2,
            spawnTick: 5,
          },
        ]),
      );
      expect(issues).toHaveLength(2);
    });
  });

  describe('weapon cooldowns', () => {
    function playerWithAttack(attackType: PlayerAttack) {
      return createPlayerState({
        username: 'player1',
        clientId: 1,
        attack: {
          type: attackType,
          weaponId: 0,
          target: null,
        },
      });
    }

    it('reports no issue when attacks respect the cooldown', () => {
      const ticks = buildTickTimeline(15, {}, (i) => {
        if (i === 0) {
          return [playerWithAttack(PlayerAttack.BGS_SPEC)];
        }
        if (i === 6) {
          return [playerWithAttack(PlayerAttack.BGS_SPEC)];
        }
        return [];
      });

      expect(runChecker(ticks)).toEqual([]);
    });

    it('reports a violation when attacks are too close together', () => {
      const ticks = buildTickTimeline(10, {}, (i) => {
        if (i === 0) {
          return [playerWithAttack(PlayerAttack.BGS_SPEC)];
        }
        if (i === 3) {
          return [playerWithAttack(PlayerAttack.SCYTHE)];
        }
        return [];
      });

      expect(runChecker(ticks)).toEqual([
        {
          kind: 'WEAPON_COOLDOWN_VIOLATION',
          player: 'player1',
          previous: { tick: 0, type: PlayerAttack.BGS_SPEC },
          current: { tick: 3, type: PlayerAttack.SCYTHE },
          cooldown: 6,
        },
      ]);
    });

    it('uses the previous attack type for the cooldown check, not the current', () => {
      const ticks = buildTickTimeline(15, {}, (i) => {
        if (i === 0) {
          return [playerWithAttack(PlayerAttack.SCYTHE)];
        }
        if (i === 5) {
          return [playerWithAttack(PlayerAttack.BGS_SPEC)];
        }
        return [];
      });

      expect(runChecker(ticks)).toEqual([]);
    });

    it('uses the previous attack type for the cooldown check, with a violation', () => {
      const ticks = buildTickTimeline(15, {}, (i) => {
        if (i === 0) {
          return [playerWithAttack(PlayerAttack.SCYTHE)];
        }
        if (i === 4) {
          return [playerWithAttack(PlayerAttack.BGS_SPEC)];
        }
        return [];
      });

      expect(runChecker(ticks)).toEqual([
        {
          kind: 'WEAPON_COOLDOWN_VIOLATION',
          player: 'player1',
          previous: { tick: 0, type: PlayerAttack.SCYTHE },
          current: { tick: 4, type: PlayerAttack.BGS_SPEC },
          cooldown: 5,
        },
      ]);
    });

    it('tracks cooldowns per player independently', () => {
      // player1: violation, player2: no violation.
      const p1 = createPlayerState({
        username: 'player1',
        clientId: 1,
        attack: { type: PlayerAttack.SCYTHE, weaponId: 0, target: null },
      });
      const p2 = createPlayerState({
        username: 'player2',
        clientId: 1,
        attack: { type: PlayerAttack.SCYTHE, weaponId: 0, target: null },
      });

      const ticks = buildTickTimeline(10, {}, (i) => {
        if (i === 0) {
          return [p1, p2];
        }
        if (i === 3) {
          return [p1];
        }
        return [];
      });

      expect(runChecker(ticks)).toEqual([
        {
          kind: 'WEAPON_COOLDOWN_VIOLATION',
          player: 'player1',
          previous: { tick: 0, type: PlayerAttack.SCYTHE },
          current: { tick: 3, type: PlayerAttack.SCYTHE },
          cooldown: 5,
        },
      ]);
    });

    it('does not flag isolated ticks where the player has no attack', () => {
      const ticks = buildTickTimeline(10, {}, (i) => {
        if (i === 0) {
          return [playerWithAttack(PlayerAttack.BGS_SPEC)];
        }
        if (i === 3) {
          return [createPlayerState({ username: 'player1', clientId: 1 })];
        }
        if (i === 6) {
          return [playerWithAttack(PlayerAttack.BGS_SPEC)];
        }
        return [];
      });

      expect(runChecker(ticks)).toEqual([]);
    });
  });

  describe('phase lifecycles', () => {
    it('reports a duplicate phase event keyed by stream identity', () => {
      const ticks = buildTickTimeline(10, {
        2: [createVerzikPhaseEvent(2, ProtoEvent.VerzikPhase.VERZIK_P1)],
        5: [createVerzikPhaseEvent(5, ProtoEvent.VerzikPhase.VERZIK_P1)],
      });

      expect(runChecker(ticks, { stage: Stage.TOB_VERZIK })).toEqual([
        {
          kind: 'DUPLICATE_STREAM_EVENT',
          eventType: ProtoEvent.Type.TOB_VERZIK_PHASE,
          identityKey: String(ProtoEvent.VerzikPhase.VERZIK_P1),
          ticks: [2, 5],
        },
      ]);
    });

    it('reports a duplicate nylo wave spawn', () => {
      const ticks = buildTickTimeline(10, {
        3: [createNyloWaveSpawnEvent(3, 5)],
        7: [createNyloWaveSpawnEvent(7, 5)],
      });

      expect(runChecker(ticks, { stage: Stage.TOB_NYLOCAS })).toContainEqual({
        kind: 'DUPLICATE_STREAM_EVENT',
        eventType: ProtoEvent.Type.TOB_NYLO_WAVE_SPAWN,
        identityKey: '5',
        ticks: [3, 7],
      });
    });

    it('reports a PHASE_OUT_OF_ORDER for Verzik P3 emitted before P2', () => {
      const ticks = buildTickTimeline(15, {
        2: [createVerzikPhaseEvent(2, ProtoEvent.VerzikPhase.VERZIK_P1)],
        5: [createVerzikPhaseEvent(5, ProtoEvent.VerzikPhase.VERZIK_P3)],
        10: [createVerzikPhaseEvent(10, ProtoEvent.VerzikPhase.VERZIK_P2)],
      });

      expect(runChecker(ticks, { stage: Stage.TOB_VERZIK })).toContainEqual({
        kind: 'PHASE_OUT_OF_ORDER',
        previous: {
          eventType: ProtoEvent.Type.TOB_VERZIK_PHASE,
          identityKey: String(ProtoEvent.VerzikPhase.VERZIK_P3),
          tick: 5,
        },
        current: {
          eventType: ProtoEvent.Type.TOB_VERZIK_PHASE,
          identityKey: String(ProtoEvent.VerzikPhase.VERZIK_P2),
          tick: 10,
        },
      });
    });

    it('reports a PHASE_OUT_OF_ORDER for Xarpus phases out of order', () => {
      const ticks = buildTickTimeline(15, {
        2: [createXarpusPhaseEvent(2, ProtoEvent.XarpusPhase.XARPUS_P2)],
        8: [createXarpusPhaseEvent(8, ProtoEvent.XarpusPhase.XARPUS_P1)],
      });

      expect(runChecker(ticks, { stage: Stage.TOB_XARPUS })).toContainEqual({
        kind: 'PHASE_OUT_OF_ORDER',
        previous: {
          eventType: ProtoEvent.Type.TOB_XARPUS_PHASE,
          identityKey: String(ProtoEvent.XarpusPhase.XARPUS_P2),
          tick: 2,
        },
        current: {
          eventType: ProtoEvent.Type.TOB_XARPUS_PHASE,
          identityKey: String(ProtoEvent.XarpusPhase.XARPUS_P1),
          tick: 8,
        },
      });
    });

    it('reports a PHASE_OUT_OF_ORDER for nylo waves out of order', () => {
      const ticks = buildTickTimeline(20, {
        3: [createNyloWaveSpawnEvent(3, 5)],
        10: [createNyloWaveSpawnEvent(10, 3)],
      });

      expect(runChecker(ticks, { stage: Stage.TOB_NYLOCAS })).toContainEqual({
        kind: 'PHASE_OUT_OF_ORDER',
        previous: {
          eventType: ProtoEvent.Type.TOB_NYLO_WAVE_SPAWN,
          identityKey: '5',
          tick: 3,
        },
        current: {
          eventType: ProtoEvent.Type.TOB_NYLO_WAVE_SPAWN,
          identityKey: '3',
          tick: 10,
        },
      });
    });

    it('catches Sote MAZE_PROC of next maze before MAZE_END of current', () => {
      const ticks = buildTickTimeline(15, {
        2: [
          createSoteMazeEvent(
            ProtoEvent.Type.TOB_SOTE_MAZE_PROC,
            2,
            ProtoEvent.SoteMaze.Maze.MAZE_66,
          ),
        ],
        8: [
          createSoteMazeEvent(
            ProtoEvent.Type.TOB_SOTE_MAZE_PROC,
            8,
            ProtoEvent.SoteMaze.Maze.MAZE_33,
          ),
        ],
        10: [
          createSoteMazeEvent(
            ProtoEvent.Type.TOB_SOTE_MAZE_END,
            10,
            ProtoEvent.SoteMaze.Maze.MAZE_66,
          ),
        ],
      });

      expect(runChecker(ticks, { stage: Stage.TOB_SOTETSEG })).toContainEqual({
        kind: 'PHASE_OUT_OF_ORDER',
        previous: {
          eventType: ProtoEvent.Type.TOB_SOTE_MAZE_PROC,
          identityKey: String(ProtoEvent.SoteMaze.Maze.MAZE_33),
          tick: 8,
        },
        current: {
          eventType: ProtoEvent.Type.TOB_SOTE_MAZE_END,
          identityKey: String(ProtoEvent.SoteMaze.Maze.MAZE_66),
          tick: 10,
        },
      });
    });

    it('does not emit ordering issues for a stage without a rule', () => {
      const ticks = buildTickTimeline(10, {
        2: [createVerzikPhaseEvent(2, ProtoEvent.VerzikPhase.VERZIK_P3)],
        5: [createVerzikPhaseEvent(5, ProtoEvent.VerzikPhase.VERZIK_P1)],
      });

      // TOB_BLOAT has no ordering rules.
      const issues = runChecker(ticks, { stage: Stage.TOB_BLOAT });
      expect(issues.filter((i) => i.kind === 'PHASE_OUT_OF_ORDER')).toEqual([]);
    });

    it('does not double-count actor lifecycle events as phase duplicates', () => {
      const ticks = buildTickTimeline(10, {
        0: [
          createNpcSpawnEvent({
            tick: 0,
            roomId: ROOM_ID_A,
            npcId: NPC_ID,
            x: 0,
            y: 0,
            hitpointsCurrent: 100,
          }),
        ],
        4: [
          createNpcSpawnEvent({
            tick: 4,
            roomId: ROOM_ID_A,
            npcId: NPC_ID,
            x: 0,
            y: 0,
            hitpointsCurrent: 100,
          }),
        ],
      });

      // Duplicate NPC spawns are emitted by actor lifecycle, not duplicated by
      // the phase check.
      const issues = runChecker(ticks);
      expect(issues.filter((i) => i.kind === 'DUPLICATE_STREAM_EVENT')).toEqual(
        [],
      );
    });
  });

  describe('attack target presence', () => {
    it('emits no issue when a player attack targets an NPC present on the tick', () => {
      const ticks: TickStateArray = [
        createTickState(
          0,
          [
            createPlayerState({
              username: 'player1',
              clientId: 1,
              attack: {
                type: PlayerAttack.SCYTHE,
                weaponId: 0,
                target: ROOM_ID_A,
              },
            }),
          ],
          [
            createNpcSpawnEvent({
              tick: 0,
              roomId: ROOM_ID_A,
              npcId: NPC_ID,
              x: 0,
              y: 0,
              hitpointsCurrent: 100,
            }),
          ],
        ),
      ];

      expect(
        runChecker(ticks).filter((i) => i.kind === 'ATTACK_TARGET_MISSING'),
      ).toEqual([]);
    });

    it('emits ATTACK_TARGET_MISSING when a player attack targets a missing NPC', () => {
      const ticks: TickStateArray = [
        createTickState(0, [
          createPlayerState({
            username: 'player1',
            clientId: 1,
            attack: {
              type: PlayerAttack.SCYTHE,
              weaponId: 0,
              target: ROOM_ID_A,
            },
          }),
        ]),
      ];

      expect(runChecker(ticks)).toContainEqual({
        kind: 'ATTACK_TARGET_MISSING',
        tick: 0,
        attackerKind: 'player',
        attackerId: 'player1',
        targetKind: 'npc',
        targetId: String(ROOM_ID_A),
      });
    });

    it('emits no issue when an NPC attack targets a player present on the tick', () => {
      const ticks: TickStateArray = [
        createTickState(
          0,
          [createPlayerState({ username: 'player1', clientId: 1 })],
          [
            createNpcUpdateEvent({
              tick: 0,
              roomId: ROOM_ID_A,
              npcId: NPC_ID,
              x: 0,
              y: 0,
              hitpointsCurrent: 100,
            }),
            createNpcAttackEvent({
              tick: 0,
              roomId: ROOM_ID_A,
              npcId: NPC_ID,
              attackType: NpcAttack.TOB_VERZIK_P3_AUTO,
              target: 'player1',
            }),
          ],
        ),
      ];

      expect(
        runChecker(ticks).filter((i) => i.kind === 'ATTACK_TARGET_MISSING'),
      ).toEqual([]);
    });

    it('emits ATTACK_TARGET_MISSING when an NPC attack targets a missing player', () => {
      const ticks: TickStateArray = [
        createTickState(
          0,
          [createPlayerState({ username: 'player1', clientId: 1 })],
          [
            createNpcUpdateEvent({
              tick: 0,
              roomId: ROOM_ID_A,
              npcId: NPC_ID,
              x: 0,
              y: 0,
              hitpointsCurrent: 100,
            }),
            createNpcAttackEvent({
              tick: 0,
              roomId: ROOM_ID_A,
              npcId: NPC_ID,
              attackType: NpcAttack.TOB_VERZIK_P3_AUTO,
              target: 'player2',
            }),
          ],
        ),
      ];

      expect(runChecker(ticks)).toContainEqual({
        kind: 'ATTACK_TARGET_MISSING',
        tick: 0,
        attackerKind: 'npc',
        attackerId: String(ROOM_ID_A),
        targetKind: 'player',
        targetId: 'player2',
      });
    });

    it('ignores when an NPC targets a dead player', () => {
      const ticks: TickStateArray = [
        createTickState(
          0,
          [createPlayerState({ username: 'player1', clientId: 1 })],
          [
            createPlayerDeathEvent({
              tick: 0,
              name: 'player1',
            }),
            createNpcUpdateEvent({
              tick: 0,
              roomId: ROOM_ID_A,
              npcId: NPC_ID,
              x: 0,
              y: 0,
              hitpointsCurrent: 100,
            }),
          ],
        ),
        createTickState(
          1,
          [],
          [
            createNpcUpdateEvent({
              tick: 1,
              roomId: ROOM_ID_A,
              npcId: NPC_ID,
              x: 0,
              y: 0,
              hitpointsCurrent: 100,
            }),
            createNpcAttackEvent({
              tick: 1,
              roomId: ROOM_ID_A,
              npcId: NPC_ID,
              attackType: NpcAttack.TOB_VERZIK_P3_AUTO,
              target: 'player1',
            }),
          ],
        ),
      ];

      expect(runChecker(ticks)).toEqual([]);
    });

    it('emits no issue when an attack has a null target', () => {
      const ticks: TickStateArray = [
        createTickState(
          0,
          [createPlayerState({ username: 'player1', clientId: 1 })],
          [
            createNpcUpdateEvent({
              tick: 0,
              roomId: ROOM_ID_A,
              npcId: NPC_ID,
              x: 0,
              y: 0,
              hitpointsCurrent: 100,
            }),
            createNpcAttackEvent({
              tick: 0,
              roomId: ROOM_ID_A,
              npcId: NPC_ID,
              attackType: NpcAttack.TOB_VERZIK_P3_AUTO,
            }),
          ],
        ),
      ];

      expect(
        runChecker(ticks).filter((i) => i.kind === 'ATTACK_TARGET_MISSING'),
      ).toEqual([]);
    });
  });

  describe('mutex event types', () => {
    function bloatDown(tick: number): ProtoEvent {
      return createEvent(ProtoEvent.Type.TOB_BLOAT_DOWN, tick);
    }

    function bloatUp(tick: number): ProtoEvent {
      return createEvent(ProtoEvent.Type.TOB_BLOAT_UP, tick);
    }

    it('emits no issue when down and up appear on different ticks', () => {
      const ticks = buildTickTimeline(10, {
        2: [bloatDown(2)],
        7: [bloatUp(7)],
      });

      expect(runChecker(ticks, { stage: Stage.TOB_BLOAT })).toEqual([]);
    });

    it('emits EXCLUSIVE_EVENT_VIOLATION when down and up co-occur on a tick', () => {
      const ticks = buildTickTimeline(5, {
        2: [bloatDown(2), bloatUp(2)],
      });

      expect(runChecker(ticks, { stage: Stage.TOB_BLOAT })).toContainEqual({
        kind: 'EXCLUSIVE_EVENT_VIOLATION',
        exclusiveTypes: [
          ProtoEvent.Type.TOB_BLOAT_DOWN,
          ProtoEvent.Type.TOB_BLOAT_UP,
        ],
        tick: 2,
      });
    });

    it('does not fire on stages without a mutex rule', () => {
      const ticks = buildTickTimeline(5, {
        2: [bloatDown(2), bloatUp(2)],
      });

      expect(
        runChecker(ticks, { stage: Stage.TOB_VERZIK }).filter(
          (i) => i.kind === 'EXCLUSIVE_EVENT_VIOLATION',
        ),
      ).toEqual([]);
    });

    it('emits no issue when only one of the two events is present', () => {
      const ticks = buildTickTimeline(5, {
        2: [bloatDown(2)],
      });

      expect(runChecker(ticks, { stage: Stage.TOB_BLOAT })).toEqual([]);
    });
  });

  describe('orchestration', () => {
    it('returns no issues for an empty timeline', () => {
      expect(runChecker([])).toEqual([]);
    });

    it('returns no issues for a timeline of only null ticks', () => {
      const ticks: TickStateArray = [null, null, null];
      expect(runChecker(ticks)).toEqual([]);
    });

    it('returns issues from multiple invariants in a single run', () => {
      // Construct a timeline that violates two invariants at once:
      // - duplicate for player1
      // - duplicate Verzik phase
      const ticks = buildTickTimeline(15, {
        2: [createPlayerDeathEvent({ tick: 2, name: 'player1' })],
        5: [createVerzikPhaseEvent(5, ProtoEvent.VerzikPhase.VERZIK_P2)],
        8: [createPlayerDeathEvent({ tick: 8, name: 'player1' })],
        10: [createVerzikPhaseEvent(10, ProtoEvent.VerzikPhase.VERZIK_P2)],
      });

      const issues = runChecker(ticks, { stage: Stage.TOB_VERZIK });
      expect(issues).toContainEqual({
        kind: 'DUPLICATE_PLAYER_DEATH',
        player: 'player1',
        ticks: [2, 8],
      });
      expect(issues).toContainEqual({
        kind: 'DUPLICATE_STREAM_EVENT',
        eventType: ProtoEvent.Type.TOB_VERZIK_PHASE,
        identityKey: String(ProtoEvent.VerzikPhase.VERZIK_P2),
        ticks: [5, 10],
      });
    });

    it('resets issues between successive check() calls', () => {
      const checker = new MergeConsistencyChecker(createMergeContext());

      const dirty = buildTickTimeline(5, {
        2: [createPlayerDeathEvent({ tick: 2, name: 'player1' })],
        4: [createPlayerDeathEvent({ tick: 4, name: 'player1' })],
      });
      expect(checker.check(dirty)).toHaveLength(1);

      // A clean timeline run immediately after must not leak issues from the
      // previous run.
      expect(checker.check(buildTickTimeline(5, {}))).toEqual([]);
    });
  });
});

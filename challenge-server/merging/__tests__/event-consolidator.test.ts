import {
  ChallengeType,
  DataSource,
  NpcAttack,
  PlayerAttack,
  Stage,
  StageStatus,
} from '@blert/common';
import { Event as ProtoEvent } from '@blert/common/generated/event_pb';

import { ClientEvents } from '../client-events';
import { MergeContext, RegisteredClient } from '../context';
import { EventConsolidator } from '../event-consolidator';
import { MergeMapping, TickMapping } from '../tick-mapping';
import { TickStateArray } from '../tick-state';

import {
  createEvent,
  createNpcAttackEvent,
  createNpcDeathEvent,
  createNpcUpdateEvent,
  createPlayerAttackEvent,
  createPlayerDeathEvent,
  createPlayerState,
  createPlayerUpdateEvent,
  createTickState,
  createVerzikAttackStyleEvent,
} from './fixtures';

const BASE_CLIENT_ID = 1;
const TARGET_CLIENT_ID = 2;

/**
 * Creates a minimal ClientEvents for registering in the merge context.
 * The client will have a single PRIMARY player used as its primary player.
 */
function createClient(
  clientId: number,
  primaryPlayer: string,
  numTicks: number,
): ClientEvents {
  const events: ProtoEvent[] = [];
  for (let i = 0; i < numTicks; i++) {
    events.push(
      createPlayerUpdateEvent({
        tick: i,
        name: primaryPlayer,
        source: DataSource.PRIMARY,
      }),
    );
  }
  return ClientEvents.fromRawEvents(
    clientId,
    { uuid: 'test', type: ChallengeType.TOB, party: [primaryPlayer] },
    {
      stage: Stage.TOB_VERZIK,
      status: StageStatus.COMPLETED,
      accurate: true,
      recordedTicks: numTicks - 1,
      serverTicks: { count: numTicks - 1, precise: true },
    },
    events,
  );
}

/**
 * Creates a MergeContext with identity mappings begun for a single
 * consolidation step.
 */
function testCtx(
  baseTickCount: number,
  targetTickCount: number,
  clients?: Map<number, RegisteredClient>,
): MergeContext {
  const mapping = new MergeMapping(BASE_CLIENT_ID);
  mapping.begin(
    TARGET_CLIENT_ID,
    TickMapping.identity(baseTickCount),
    TickMapping.identity(targetTickCount),
    baseTickCount,
  );
  return { clients: clients ?? new Map(), mapping, tracer: undefined };
}

/**
 * Builds a simple timeline of ticks with player updates and optional extra
 * events per tick. Each tick has a player at position (tick, 0).
 */
function buildTimeline(
  numTicks: number,
  player: string,
  source: DataSource,
  extraEvents?: Record<number, ProtoEvent[]>,
): TickStateArray {
  const ticks: TickStateArray = [];
  for (let i = 0; i < numTicks; i++) {
    const events = [
      createPlayerUpdateEvent({ tick: i, name: player, source, x: i, y: 0 }),
      ...(extraEvents?.[i] ?? []),
    ];
    ticks.push(
      createTickState(
        i,
        [createPlayerState({ username: player, source, x: i, y: 0 })],
        events,
      ),
    );
  }
  return ticks;
}

function getEventTypes(ticks: TickStateArray, tick: number): number[] {
  return (
    ticks[tick]
      ?.getEvents()
      .map((e) => e.getType())
      .sort() ?? []
  );
}

describe('EventConsolidator', () => {
  describe('identity consolidation', () => {
    it('merges tick-state events and extracts stream events', () => {
      const base = buildTimeline(5, 'player1', DataSource.SECONDARY);
      const target = buildTimeline(5, 'player1', DataSource.PRIMARY, {
        2: [createPlayerDeathEvent({ tick: 2, name: 'player1' })],
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      // Player update should be overridden with PRIMARY on all ticks.
      for (let i = 0; i < 5; i++) {
        const state = result.ticks[i]?.getPlayerState('player1');
        expect(state?.source).toBe(DataSource.PRIMARY);
      }

      const tick2Types = getEventTypes(result.ticks, 2);
      expect(tick2Types).toContain(ProtoEvent.Type.PLAYER_DEATH);

      expect(result.qualityFlags).toHaveLength(0);
    });

    it('fills gaps in the base from the target', () => {
      const base: TickStateArray = [
        createTickState(0, [createPlayerState({ username: 'player1', x: 0 })]),
        null,
        createTickState(2, [createPlayerState({ username: 'player1', x: 2 })]),
      ];
      const target: TickStateArray = [
        createTickState(0, [createPlayerState({ username: 'player1', x: 0 })]),
        createTickState(1, [createPlayerState({ username: 'player1', x: 1 })]),
        createTickState(2, [createPlayerState({ username: 'player1', x: 2 })]),
      ];

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      expect(result.ticks[1]).not.toBeNull();
      expect(result.ticks[1]?.getPlayerState('player1')?.x).toBe(1);

      expect(result.qualityFlags).toHaveLength(0);
    });

    it('keeps graphics events from both sides in the merged tick', () => {
      const splats = (tick: number) =>
        createEvent(ProtoEvent.Type.TOB_MAIDEN_BLOOD_SPLATS, tick);

      const base = buildTimeline(5, 'player1', DataSource.SECONDARY, {
        2: [splats(2)],
      });
      const target = buildTimeline(5, 'player1', DataSource.PRIMARY, {
        2: [splats(2)],
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      const splatEvents = result.ticks[2]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.TOB_MAIDEN_BLOOD_SPLATS);
      expect(splatEvents).toHaveLength(2);
    });
  });

  describe('stream dedup', () => {
    it('deduplicates deaths seen on the same tick by both clients', () => {
      const death = (tick: number) =>
        createPlayerDeathEvent({ tick, name: 'player1' });

      const base = buildTimeline(5, 'player1', DataSource.SECONDARY, {
        3: [death(3)],
      });
      const target = buildTimeline(5, 'player1', DataSource.PRIMARY, {
        3: [death(3)],
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      // Should have exactly one PLAYER_DEATH at tick 3, not two.
      const deathEvents = result.ticks[3]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.PLAYER_DEATH);
      expect(deathEvents).toHaveLength(1);

      expect(result.qualityFlags).toHaveLength(0);
    });

    it('deduplicates deaths seen on different ticks within the temporal window', () => {
      const base = buildTimeline(10, 'player1', DataSource.SECONDARY, {
        4: [createPlayerDeathEvent({ tick: 4, name: 'player1' })],
      });
      const target = buildTimeline(10, 'player1', DataSource.PRIMARY, {
        6: [createPlayerDeathEvent({ tick: 6, name: 'player1' })],
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      // The earliest tick should win, placing the death event at 4
      // and nothing at 6.
      const deathAt4 = result.ticks[4]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.PLAYER_DEATH);
      expect(deathAt4).toHaveLength(1);

      const deathAt6 = result.ticks[6]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.PLAYER_DEATH);
      expect(deathAt6).toHaveLength(0);

      expect(result.qualityFlags).toHaveLength(0);
    });

    it('treats deaths outside the temporal window as distinct', () => {
      const base = buildTimeline(15, 'player1', DataSource.SECONDARY, {
        2: [createPlayerDeathEvent({ tick: 2, name: 'player1' })],
      });
      const target = buildTimeline(15, 'player1', DataSource.PRIMARY, {
        10: [createPlayerDeathEvent({ tick: 10, name: 'player1' })],
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      // Both deaths should be present at their respective ticks.
      const deathAt2 = result.ticks[2]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.PLAYER_DEATH);
      expect(deathAt2).toHaveLength(1);

      const deathAt10 = result.ticks[10]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.PLAYER_DEATH);
      expect(deathAt10).toHaveLength(1);

      expect(result.qualityFlags).toHaveLength(0);
    });

    it('deduplicates NPC deaths by room ID', () => {
      const npcDeath = (tick: number) =>
        createNpcDeathEvent({ tick, roomId: 1, npcId: 100 });

      const base = buildTimeline(10, 'player1', DataSource.SECONDARY, {
        5: [npcDeath(5)],
      });
      const target = buildTimeline(10, 'player1', DataSource.PRIMARY, {
        5: [npcDeath(5)],
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      const deaths = result.ticks[5]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.NPC_DEATH);
      expect(deaths).toHaveLength(1);

      expect(result.qualityFlags).toHaveLength(0);
    });

    it('does not deduplicate NPC deaths with different room IDs', () => {
      const base = buildTimeline(10, 'player1', DataSource.SECONDARY, {
        5: [createNpcDeathEvent({ tick: 5, roomId: 1, npcId: 100 })],
      });
      const target = buildTimeline(10, 'player1', DataSource.PRIMARY, {
        5: [createNpcDeathEvent({ tick: 5, roomId: 2, npcId: 101 })],
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      const deaths = result.ticks[5]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.NPC_DEATH);
      expect(deaths).toHaveLength(2);

      expect(result.qualityFlags).toHaveLength(0);
    });

    it('deduplicates unique events regardless of tick distance', () => {
      const phase = (tick: number) => {
        const e = createEvent(ProtoEvent.Type.TOB_XARPUS_PHASE, tick);
        e.setXarpusPhase(1);
        return e;
      };

      const base = buildTimeline(15, 'player1', DataSource.SECONDARY, {
        3: [phase(3)],
      });
      const target = buildTimeline(15, 'player1', DataSource.PRIMARY, {
        12: [phase(12)],
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      // Unique events are paired regardless of distance, with earliest winning.
      const phaseAt3 = result.ticks[3]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.TOB_XARPUS_PHASE);
      expect(phaseAt3).toHaveLength(1);

      const phaseAt12 = result.ticks[12]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.TOB_XARPUS_PHASE);
      expect(phaseAt12).toHaveLength(0);

      expect(result.qualityFlags).toHaveLength(0);
    });

    it('handles events only present in the base', () => {
      const base = buildTimeline(10, 'player1', DataSource.SECONDARY, {
        4: [createPlayerDeathEvent({ tick: 4, name: 'player1' })],
      });
      const target = buildTimeline(10, 'player1', DataSource.PRIMARY);

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      const deaths = result.ticks[4]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.PLAYER_DEATH);
      expect(deaths).toHaveLength(1);

      expect(result.qualityFlags).toHaveLength(0);
    });

    it('handles events only present in the target', () => {
      const base = buildTimeline(10, 'player1', DataSource.SECONDARY);
      const target = buildTimeline(10, 'player1', DataSource.PRIMARY, {
        7: [createPlayerDeathEvent({ tick: 7, name: 'player1' })],
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      const deaths = result.ticks[7]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.PLAYER_DEATH);
      expect(deaths).toHaveLength(1);

      expect(result.qualityFlags).toHaveLength(0);
    });
  });

  describe('quality flags', () => {
    it('emits no quality flags for a clean merge', () => {
      const base = buildTimeline(10, 'player1', DataSource.SECONDARY, {
        5: [createPlayerDeathEvent({ tick: 5, name: 'player1' })],
      });
      const target = buildTimeline(10, 'player1', DataSource.PRIMARY, {
        5: [createPlayerDeathEvent({ tick: 5, name: 'player1' })],
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      expect(result.qualityFlags).toHaveLength(0);
    });

    it('flags a large temporal gap between paired stream events', () => {
      const base = buildTimeline(10, 'player1', DataSource.SECONDARY, {
        1: [createPlayerDeathEvent({ tick: 1, name: 'player1' })],
      });
      const target = buildTimeline(10, 'player1', DataSource.PRIMARY, {
        4: [createPlayerDeathEvent({ tick: 4, name: 'player1' })],
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
        { largeGapThreshold: 2 },
      );
      const result = consolidator.consolidate();

      const gapFlags = result.qualityFlags.filter(
        (f) => f.kind === 'LARGE_TEMPORAL_GAP',
      );
      expect(gapFlags).toHaveLength(1);
      expect(gapFlags[0]).toMatchObject({
        kind: 'LARGE_TEMPORAL_GAP',
        eventType: ProtoEvent.Type.PLAYER_DEATH,
        tickGap: 3,
        baseTick: 1,
        targetTick: 4,
      });
    });

    it('does not flag a gap below the threshold', () => {
      const base = buildTimeline(10, 'player1', DataSource.SECONDARY, {
        3: [createPlayerDeathEvent({ tick: 3, name: 'player1' })],
      });
      const target = buildTimeline(10, 'player1', DataSource.PRIMARY, {
        4: [createPlayerDeathEvent({ tick: 4, name: 'player1' })],
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
        { largeGapThreshold: 2 },
      );
      const result = consolidator.consolidate();

      expect(result.qualityFlags).toHaveLength(0);
    });
  });

  describe('attack-mapped events', () => {
    function buildVerzikTimeline(
      numTicks: number,
      player: string,
      source: DataSource,
      attackTick: number,
      attackStyleEvents?: Record<
        number,
        { npcAttackTick: number; style: number }
      >,
    ): TickStateArray {
      const extra: Record<number, ProtoEvent[]> = {
        [attackTick]: [
          createNpcAttackEvent({
            tick: attackTick,
            roomId: 1,
            npcId: 8374,
            attackType: NpcAttack.TOB_VERZIK_P3_AUTO,
            target: player,
          }),
        ],
      };

      if (attackStyleEvents !== undefined) {
        for (const [tick, { npcAttackTick, style }] of Object.entries(
          attackStyleEvents,
        )) {
          const t = Number(tick);
          extra[t] = [
            ...(extra[t] ?? []),
            createVerzikAttackStyleEvent({ tick: t, npcAttackTick, style }),
          ];
        }
      }

      return buildTimeline(numTicks, player, source, extra);
    }

    it('resolves a single attack style candidate', () => {
      const base = buildVerzikTimeline(15, 'player1', DataSource.SECONDARY, 5, {
        6: { npcAttackTick: 5, style: 0 },
      });
      const target = buildTimeline(15, 'player1', DataSource.PRIMARY);

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      // The attack style event should be inserted the tick after the attack.
      const tick6Events = result.ticks[6]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.TOB_VERZIK_ATTACK_STYLE);
      expect(tick6Events).toHaveLength(1);
      expect(tick6Events![0].getVerzikAttackStyle()?.getStyle()).toBe(0);
    });

    it('resolves agreeing candidates as RESOLVED, not conflict', () => {
      const base = buildVerzikTimeline(15, 'player1', DataSource.SECONDARY, 5, {
        6: { npcAttackTick: 5, style: 1 },
      });
      const target = buildVerzikTimeline(15, 'player1', DataSource.PRIMARY, 5, {
        6: { npcAttackTick: 5, style: 1 },
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      // Should have exactly one deduplicated attack style event.
      const tick6Events = result.ticks[6]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.TOB_VERZIK_ATTACK_STYLE);
      expect(tick6Events).toHaveLength(1);

      expect(result.qualityFlags).toHaveLength(0);
    });

    it('resolves disagreeing candidates by NPC proximity', () => {
      // Verzik P3 at (10, 10). player1 (base primary) is far at (0, 0),
      // player2 (target primary) is close at (9, 10).
      const VERZIK_P3_ID = 8374;
      const verzikNpcUpdate = (tick: number) =>
        createNpcUpdateEvent({
          tick,
          roomId: 1,
          npcId: VERZIK_P3_ID,
          x: 10,
          y: 10,
          hitpointsCurrent: 100,
          stage: Stage.TOB_VERZIK,
        });

      const base: TickStateArray = [];
      const target: TickStateArray = [];

      for (let i = 0; i < 15; i++) {
        const extraBase: ProtoEvent[] = [verzikNpcUpdate(i)];
        const extraTarget: ProtoEvent[] = [verzikNpcUpdate(i)];

        if (i === 5) {
          const npcAttack = createNpcAttackEvent({
            tick: 5,
            roomId: 1,
            npcId: VERZIK_P3_ID,
            attackType: NpcAttack.TOB_VERZIK_P3_AUTO,
            target: 'player1',
            x: 10,
            y: 10,
            stage: Stage.TOB_VERZIK,
          });
          extraBase.push(npcAttack);
          extraTarget.push(npcAttack.clone());
        }
        if (i === 6) {
          extraBase.push(
            createVerzikAttackStyleEvent({
              tick: 6,
              npcAttackTick: 5,
              style: 1,
            }),
          );
          extraTarget.push(
            createVerzikAttackStyleEvent({
              tick: 6,
              npcAttackTick: 5,
              style: 2,
            }),
          );
        }

        base.push(
          createTickState(
            i,
            [
              createPlayerState({ username: 'player1', x: 0, y: 0 }),
              createPlayerState({ username: 'player2', x: 9, y: 10 }),
            ],
            [
              createPlayerUpdateEvent({
                tick: i,
                name: 'player1',
                source: DataSource.PRIMARY,
                x: 0,
                y: 0,
                stage: Stage.TOB_VERZIK,
              }),
              createPlayerUpdateEvent({
                tick: i,
                name: 'player2',
                source: DataSource.SECONDARY,
                x: 9,
                y: 10,
                stage: Stage.TOB_VERZIK,
              }),
              ...extraBase,
            ],
            BASE_CLIENT_ID,
          ),
        );

        target.push(
          createTickState(
            i,
            [
              createPlayerState({ username: 'player1', x: 0, y: 0 }),
              createPlayerState({ username: 'player2', x: 9, y: 10 }),
            ],
            [
              createPlayerUpdateEvent({
                tick: i,
                name: 'player1',
                source: DataSource.SECONDARY,
                x: 0,
                y: 0,
                stage: Stage.TOB_VERZIK,
              }),
              createPlayerUpdateEvent({
                tick: i,
                name: 'player2',
                source: DataSource.PRIMARY,
                x: 9,
                y: 10,
                stage: Stage.TOB_VERZIK,
              }),
              ...extraTarget,
            ],
            TARGET_CLIENT_ID,
          ),
        );
      }

      const clients = new Map<number, RegisteredClient>([
        [
          BASE_CLIENT_ID,
          { client: createClient(BASE_CLIENT_ID, 'player1', 15) },
        ],
        [
          TARGET_CLIENT_ID,
          { client: createClient(TARGET_CLIENT_ID, 'player2', 15) },
        ],
      ]);

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length, clients),
      );
      const result = consolidator.consolidate();

      // Style from the target should win.
      const tick6Events = result.ticks[6]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.TOB_VERZIK_ATTACK_STYLE);
      expect(tick6Events).toHaveLength(1);
      expect(tick6Events![0].getVerzikAttackStyle()?.getStyle()).toBe(2);

      expect(result.qualityFlags).toHaveLength(0);
    });

    it('falls back to base when proximity cannot be determined', () => {
      const base = buildVerzikTimeline(15, 'player1', DataSource.SECONDARY, 5, {
        6: { npcAttackTick: 5, style: 1 },
      });
      const target = buildVerzikTimeline(15, 'player1', DataSource.PRIMARY, 5, {
        6: { npcAttackTick: 5, style: 2 },
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      const tick6Events = result.ticks[6]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.TOB_VERZIK_ATTACK_STYLE);
      expect(tick6Events).toHaveLength(1);
      expect(tick6Events![0].getVerzikAttackStyle()?.getStyle()).toBe(1);

      expect(result.qualityFlags).toHaveLength(0);
    });

    it('discards attack style events when no matching attack exists', () => {
      const base = buildTimeline(15, 'player1', DataSource.SECONDARY, {
        6: [
          createVerzikAttackStyleEvent({
            tick: 6,
            npcAttackTick: 5,
            style: 0,
          }),
        ],
      });
      const target = buildTimeline(15, 'player1', DataSource.PRIMARY);

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      // No attack style event should be inserted.
      const tick6Events = result.ticks[6]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.TOB_VERZIK_ATTACK_STYLE);
      expect(tick6Events).toHaveLength(0);
    });
  });

  describe('projectile-ambiguous player attacks', () => {
    it('resolves ambiguous attacks by player proximity to the attacker', () => {
      // attacker attacks with ZCB at tick 5. player1 (base primary, far from
      // attacker) sees ZCB_AUTO. player2 (target primary, close to attacker)
      // sees ZCB_SPEC. The target's observation should win.
      const numTicks = 10;

      const makeTimeline = (
        source: DataSource,
        clientId: number,
        attackType: PlayerAttack,
      ): TickStateArray => {
        const ticks: TickStateArray = [];
        for (let i = 0; i < numTicks; i++) {
          const events: ProtoEvent[] = [
            createPlayerUpdateEvent({
              tick: i,
              name: 'player1',
              source:
                clientId === BASE_CLIENT_ID
                  ? DataSource.PRIMARY
                  : DataSource.SECONDARY,
              x: 0,
              y: 0,
            }),
            createPlayerUpdateEvent({
              tick: i,
              name: 'player2',
              source:
                clientId === TARGET_CLIENT_ID
                  ? DataSource.PRIMARY
                  : DataSource.SECONDARY,
              x: 10,
              y: 10,
            }),
            createPlayerUpdateEvent({
              tick: i,
              name: 'attacker',
              source: DataSource.SECONDARY,
              x: 9,
              y: 10,
            }),
          ];

          if (i === 5) {
            events.push(
              createPlayerAttackEvent({
                tick: 5,
                name: 'attacker',
                attackType,
                targetRoomId: 1,
              }),
            );
          }

          ticks.push(
            createTickState(
              i,
              [
                createPlayerState({ username: 'player1', x: 0, y: 0 }),
                createPlayerState({ username: 'player2', x: 10, y: 10 }),
                createPlayerState({
                  username: 'attacker',
                  x: 9,
                  y: 10,
                  attack:
                    i === 5
                      ? { type: attackType, weaponId: 0, target: 1 }
                      : null,
                }),
              ],
              events,
              clientId,
            ),
          );
        }
        return ticks;
      };

      const base = makeTimeline(
        DataSource.SECONDARY,
        BASE_CLIENT_ID,
        PlayerAttack.ZCB_AUTO,
      );
      const target = makeTimeline(
        DataSource.SECONDARY,
        TARGET_CLIENT_ID,
        PlayerAttack.ZCB_SPEC,
      );

      const clients = new Map<number, RegisteredClient>([
        [
          BASE_CLIENT_ID,
          { client: createClient(BASE_CLIENT_ID, 'player1', numTicks) },
        ],
        [
          TARGET_CLIENT_ID,
          { client: createClient(TARGET_CLIENT_ID, 'player2', numTicks) },
        ],
      ]);

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length, clients),
      );
      const result = consolidator.consolidate();

      const tick5Attacks = result.ticks[5]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.PLAYER_ATTACK);
      expect(tick5Attacks).toHaveLength(1);
      // player2 is closer to attacker so the target's ZCB_SPEC should win.
      expect(tick5Attacks![0].getPlayerAttack()?.getType()).toBe(
        PlayerAttack.ZCB_SPEC,
      );
    });

    it('prefers the client whose primary player is the attacker', () => {
      // player1 (base primary) attacks with ZCB_SPEC. player2 sees player1
      // attacking with ZCB_AUTO.
      const numTicks = 10;

      const makeTimeline = (
        clientId: number,
        attackType: PlayerAttack,
      ): TickStateArray => {
        const ticks: TickStateArray = [];
        for (let i = 0; i < numTicks; i++) {
          const events: ProtoEvent[] = [
            createPlayerUpdateEvent({
              tick: i,
              name: 'player1',
              source:
                clientId === BASE_CLIENT_ID
                  ? DataSource.PRIMARY
                  : DataSource.SECONDARY,
              x: 5,
              y: 5,
            }),
            createPlayerUpdateEvent({
              tick: i,
              name: 'player2',
              source:
                clientId === TARGET_CLIENT_ID
                  ? DataSource.PRIMARY
                  : DataSource.SECONDARY,
              x: 20,
              y: 20,
            }),
          ];

          if (i === 5) {
            events.push(
              createPlayerAttackEvent({
                tick: 5,
                name: 'player1',
                attackType,
                targetRoomId: 1,
              }),
            );
          }

          ticks.push(
            createTickState(
              i,
              [
                createPlayerState({
                  username: 'player1',
                  x: 5,
                  y: 5,
                  attack:
                    i === 5
                      ? { type: attackType, weaponId: 0, target: 1 }
                      : null,
                }),
                createPlayerState({ username: 'player2', x: 20, y: 20 }),
              ],
              events,
              clientId,
            ),
          );
        }
        return ticks;
      };

      const base = makeTimeline(BASE_CLIENT_ID, PlayerAttack.ZCB_SPEC);
      const target = makeTimeline(TARGET_CLIENT_ID, PlayerAttack.ZCB_AUTO);

      const clients = new Map<number, RegisteredClient>([
        [
          BASE_CLIENT_ID,
          { client: createClient(BASE_CLIENT_ID, 'player1', numTicks) },
        ],
        [
          TARGET_CLIENT_ID,
          { client: createClient(TARGET_CLIENT_ID, 'player2', numTicks) },
        ],
      ]);

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length, clients),
      );
      const result = consolidator.consolidate();

      const tick5Attacks = result.ticks[5]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.PLAYER_ATTACK);
      expect(tick5Attacks).toHaveLength(1);
      expect(tick5Attacks![0].getPlayerAttack()?.getType()).toBe(
        PlayerAttack.ZCB_SPEC,
      );
    });

    it('does not resolve when only one client reports the attack', () => {
      // Only the base reports a ZCB_AUTO attack.
      const numTicks = 10;
      const base: TickStateArray = [];
      const target: TickStateArray = [];

      for (let i = 0; i < numTicks; i++) {
        const baseEvents: ProtoEvent[] = [
          createPlayerUpdateEvent({
            tick: i,
            name: 'player1',
            source: DataSource.PRIMARY,
            x: 0,
            y: 0,
          }),
          createPlayerUpdateEvent({
            tick: i,
            name: 'player2',
            source: DataSource.SECONDARY,
            x: 10,
            y: 10,
          }),
        ];
        const targetEvents: ProtoEvent[] = [
          createPlayerUpdateEvent({
            tick: i,
            name: 'player1',
            source: DataSource.SECONDARY,
            x: 0,
            y: 0,
          }),
          createPlayerUpdateEvent({
            tick: i,
            name: 'player2',
            source: DataSource.PRIMARY,
            x: 10,
            y: 10,
          }),
        ];

        if (i === 5) {
          baseEvents.push(
            createPlayerAttackEvent({
              tick: 5,
              name: 'player1',
              attackType: PlayerAttack.ZCB_AUTO,
              targetRoomId: 1,
            }),
          );
        }

        base.push(
          createTickState(
            i,
            [
              createPlayerState({
                username: 'player1',
                x: 0,
                y: 0,
                attack:
                  i === 5
                    ? {
                        type: PlayerAttack.ZCB_AUTO,
                        weaponId: 0,
                        target: 1,
                      }
                    : null,
              }),
              createPlayerState({ username: 'player2', x: 10, y: 10 }),
            ],
            baseEvents,
            BASE_CLIENT_ID,
          ),
        );

        target.push(
          createTickState(
            i,
            [
              createPlayerState({ username: 'player1', x: 0, y: 0 }),
              createPlayerState({ username: 'player2', x: 10, y: 10 }),
            ],
            targetEvents,
            TARGET_CLIENT_ID,
          ),
        );
      }

      const clients = new Map<number, RegisteredClient>([
        [
          BASE_CLIENT_ID,
          { client: createClient(BASE_CLIENT_ID, 'player1', numTicks) },
        ],
        [
          TARGET_CLIENT_ID,
          { client: createClient(TARGET_CLIENT_ID, 'player2', numTicks) },
        ],
      ]);

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length, clients),
      );
      const result = consolidator.consolidate();

      const tick5Attacks = result.ticks[5]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.PLAYER_ATTACK);
      expect(tick5Attacks).toHaveLength(1);
      expect(tick5Attacks![0].getPlayerAttack()?.getType()).toBe(
        PlayerAttack.ZCB_AUTO,
      );
    });

    it('does not resolve when both clients report the same attack type', () => {
      const numTicks = 10;

      const makeTimeline = (clientId: number): TickStateArray => {
        const ticks: TickStateArray = [];
        for (let i = 0; i < numTicks; i++) {
          const events: ProtoEvent[] = [
            createPlayerUpdateEvent({
              tick: i,
              name: 'player1',
              source:
                clientId === BASE_CLIENT_ID
                  ? DataSource.PRIMARY
                  : DataSource.SECONDARY,
              x: 0,
              y: 0,
            }),
            createPlayerUpdateEvent({
              tick: i,
              name: 'player2',
              source:
                clientId === TARGET_CLIENT_ID
                  ? DataSource.PRIMARY
                  : DataSource.SECONDARY,
              x: 10,
              y: 10,
            }),
            createPlayerUpdateEvent({
              tick: i,
              name: 'attacker',
              source: DataSource.SECONDARY,
              x: 9,
              y: 10,
            }),
          ];

          if (i === 5) {
            events.push(
              createPlayerAttackEvent({
                tick: 5,
                name: 'attacker',
                attackType: PlayerAttack.ZCB_AUTO,
                targetRoomId: 1,
              }),
            );
          }

          ticks.push(
            createTickState(
              i,
              [
                createPlayerState({ username: 'player1', x: 0, y: 0 }),
                createPlayerState({ username: 'player2', x: 10, y: 10 }),
                createPlayerState({
                  username: 'attacker',
                  x: 9,
                  y: 10,
                  attack:
                    i === 5
                      ? {
                          type: PlayerAttack.ZCB_AUTO,
                          weaponId: 0,
                          target: 1,
                        }
                      : null,
                }),
              ],
              events,
              clientId,
            ),
          );
        }
        return ticks;
      };

      const base = makeTimeline(BASE_CLIENT_ID);
      const target = makeTimeline(TARGET_CLIENT_ID);

      const clients = new Map<number, RegisteredClient>([
        [
          BASE_CLIENT_ID,
          { client: createClient(BASE_CLIENT_ID, 'player1', numTicks) },
        ],
        [
          TARGET_CLIENT_ID,
          { client: createClient(TARGET_CLIENT_ID, 'player2', numTicks) },
        ],
      ]);

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length, clients),
      );
      const result = consolidator.consolidate();

      const tick5Attacks = result.ticks[5]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.PLAYER_ATTACK);
      expect(tick5Attacks).toHaveLength(1);
      expect(tick5Attacks![0].getPlayerAttack()?.getType()).toBe(
        PlayerAttack.ZCB_AUTO,
      );
    });
  });
});

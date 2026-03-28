import { DataSource, NpcAttack } from '@blert/common';
import { Event as ProtoEvent } from '@blert/common/generated/event_pb';

import { MergeContext } from '../context';
import { EventConsolidator } from '../event-consolidator';
import { MergeMapping, TickMapping } from '../tick-mapping';
import { TickStateArray } from '../tick-state';

import {
  createEvent,
  createNpcAttackEvent,
  createNpcDeathEvent,
  createPlayerDeathEvent,
  createPlayerState,
  createPlayerUpdateEvent,
  createTickState,
  createVerzikAttackStyleEvent,
} from './fixtures';

const BASE_CLIENT_ID = 1;
const TARGET_CLIENT_ID = 2;

/**
 * Creates a MergeContext with identity mappings begun for a single
 * consolidation step.
 */
function testCtx(baseTickCount: number, targetTickCount: number): MergeContext {
  const mapping = new MergeMapping(BASE_CLIENT_ID);
  mapping.begin(
    TARGET_CLIENT_ID,
    TickMapping.identity(baseTickCount),
    TickMapping.identity(targetTickCount),
    baseTickCount,
  );
  return { clients: new Map(), mapping, tracer: undefined };
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

    it('resolves disagreeing candidates as CONFLICT_RESOLVED for expected conflicts', () => {
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

      // Should still have exactly one event, with the base preferred.
      // TODO(frolv): Update this test when proper resolution is implemented.
      const tick6Events = result.ticks[6]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.TOB_VERZIK_ATTACK_STYLE);
      expect(tick6Events).toHaveLength(1);

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
});

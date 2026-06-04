import {
  DataSource,
  NpcAttack,
  PlayerAttack,
  PlayerSpell,
  Stage,
  StageStatus,
} from '@blert/common';
import { Event as ProtoEvent } from '@blert/common/generated/event_pb';

import { Alignment, AlignmentAction } from '../alignment';
import { ClientEvents } from '../client-events';
import { MergeClientStatus, MergeContext, RegisteredClient } from '../context';
import { EventConsolidator } from '../event-consolidator';
import { TickMapping } from '../tick-mapping';
import { TickStateArray } from '../tick-state';

import {
  TEST_CHALLENGE,
  createEvent,
  createMergeContext,
  createNpcAttackEvent,
  createNpcDeathEvent,
  createNpcUpdateEvent,
  createPlayerAttackEvent,
  createPlayerDeathEvent,
  createPlayerState,
  createPlayerUpdateEvent,
  createTickState,
  createVerzikAttackStyleEvent,
  createVerzikBounceEvent,
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
    { ...TEST_CHALLENGE, party: [primaryPlayer] },
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
  stage: Stage = Stage.TOB_VERZIK,
): MergeContext {
  const ctx = createMergeContext({ stage, clients });
  ctx.mapping.begin(TARGET_CLIENT_ID, {
    base: TickMapping.identity(baseTickCount),
    target: TickMapping.identity(targetTickCount),
    mergedTickCount: baseTickCount,
  });
  if (clients !== undefined) {
    ctx.challenge = {
      ...ctx.challenge,
      party: Array.from(clients.values()).map(
        (c) => c.client.getPrimaryPlayer()!,
      ),
    };
  }
  return ctx;
}

/**
 * Builds a simple timeline of ticks with player updates and optional extra
 * events per tick. Each tick has a player at position (tick, 0).
 */
function buildTimeline(
  clientId: number,
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
        [createPlayerState({ username: player, clientId, source, x: i, y: 0 })],
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
      const base = buildTimeline(
        BASE_CLIENT_ID,
        5,
        'player1',
        DataSource.SECONDARY,
      );
      const target = buildTimeline(
        TARGET_CLIENT_ID,
        5,
        'player1',
        DataSource.PRIMARY,
        {
          2: [createPlayerDeathEvent({ tick: 2, name: 'player1' })],
        },
      );

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
      expect(result.counters).toEqual({
        playerAttacks: 0,
        playerSpells: 0,
        npcAttacks: 0,
        streamEventPairs: 0,
        attackMappedEvents: 0,
      });
    });

    it('fills gaps in the base from the target', () => {
      const base: TickStateArray = [
        createTickState(0, [
          createPlayerState({
            username: 'player1',
            clientId: BASE_CLIENT_ID,
            x: 0,
          }),
        ]),
        null,
        createTickState(2, [
          createPlayerState({
            username: 'player1',
            clientId: BASE_CLIENT_ID,
            x: 2,
          }),
        ]),
      ];
      const target: TickStateArray = [
        createTickState(0, [
          createPlayerState({
            username: 'player1',
            clientId: TARGET_CLIENT_ID,
            x: 0,
          }),
        ]),
        createTickState(1, [
          createPlayerState({
            username: 'player1',
            clientId: TARGET_CLIENT_ID,
            x: 1,
          }),
        ]),
        createTickState(2, [
          createPlayerState({
            username: 'player1',
            clientId: TARGET_CLIENT_ID,
            x: 2,
          }),
        ]),
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

    it('preserves NPC state through the post-reconciliation rebuild', () => {
      // The consolidator's `remapToMergedSpace` reconstructs each merged
      // tick's `TickState` after reconciliation. Verify that the NPC state
      // tracked on the input ticks survives that rebuild.
      const npcEvent = (tick: number, hp: number) =>
        createNpcUpdateEvent({
          tick,
          roomId: 1,
          npcId: 8360,
          x: 50,
          y: 50,
          hitpointsCurrent: hp,
          hitpointsBase: 3000,
        });

      const base = buildTimeline(
        BASE_CLIENT_ID,
        3,
        'player1',
        DataSource.PRIMARY,
        {
          0: [npcEvent(0, 100)],
          1: [npcEvent(1, 95)],
          2: [npcEvent(2, 90)],
        },
      );
      const target = buildTimeline(
        TARGET_CLIENT_ID,
        3,
        'player1',
        DataSource.PRIMARY,
        {
          0: [npcEvent(0, 100)],
          1: [npcEvent(1, 95)],
          2: [npcEvent(2, 90)],
        },
      );

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      for (let i = 0; i < 3; i++) {
        const npc = result.ticks[i]?.getNpcs().get(1);
        expect(npc).toBeDefined();
        expect(npc!.id).toBe(8360);
        expect(npc!.hitpoints.getCurrent()).toBe(100 - i * 5);
      }
    });
  });

  it('populates leading or trailing ticks from the target', () => {
    // base:   _,_,0,1,2,3,4,5
    // target: 0,1,2,3,_,_,_,_
    const base = buildTimeline(
      BASE_CLIENT_ID,
      6,
      'player1',
      DataSource.SECONDARY,
      { 5: [createPlayerDeathEvent({ tick: 5, name: 'player1' })] },
    );
    const target = buildTimeline(
      TARGET_CLIENT_ID,
      4,
      'player1',
      DataSource.PRIMARY,
    );

    const alignments: Alignment[] = [
      [
        {
          action: AlignmentAction.MERGE,
          baseIndex: 0,
          targetIndex: 2,
          score: 1,
        },
        {
          action: AlignmentAction.MERGE,
          baseIndex: 1,
          targetIndex: 3,
          score: 1,
        },
      ],
    ];
    const ctx = createMergeContext({ stage: Stage.TOB_VERZIK });
    ctx.mapping.begin(
      TARGET_CLIENT_ID,
      TickMapping.fromAlignment(6, 4, alignments),
    );

    const result = new EventConsolidator(base, target, ctx).consolidate();

    expect(result.ticks).toHaveLength(8);

    for (let i = 0; i < result.ticks.length; i++) {
      expect(result.ticks[i]).not.toBeNull();
      const state = result.ticks[i]?.getPlayerState('player1');
      expect(state).toBeDefined();
      if (i < target.length) {
        expect(state?.source).toBe(DataSource.PRIMARY);
      } else {
        expect(state?.source).toBe(DataSource.SECONDARY);
      }
    }
    expect(getEventTypes(result.ticks, 7)).toContain(
      ProtoEvent.Type.PLAYER_DEATH,
    );
  });

  describe('stream dedup', () => {
    it('deduplicates deaths seen on the same tick by both clients', () => {
      const death = (tick: number) =>
        createPlayerDeathEvent({ tick, name: 'player1' });

      const base = buildTimeline(
        BASE_CLIENT_ID,
        5,
        'player1',
        DataSource.SECONDARY,
        {
          3: [death(3)],
        },
      );
      const target = buildTimeline(
        TARGET_CLIENT_ID,
        5,
        'player1',
        DataSource.PRIMARY,
        {
          3: [death(3)],
        },
      );

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
      expect(result.counters.streamEventPairs).toBe(1);
    });

    it('deduplicates deaths seen on different ticks within the temporal window', () => {
      const base = buildTimeline(
        BASE_CLIENT_ID,
        10,
        'player1',
        DataSource.SECONDARY,
        {
          4: [createPlayerDeathEvent({ tick: 4, name: 'player1' })],
        },
      );
      const target = buildTimeline(
        TARGET_CLIENT_ID,
        10,
        'player1',
        DataSource.PRIMARY,
        {
          6: [createPlayerDeathEvent({ tick: 6, name: 'player1' })],
        },
      );

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
      const base = buildTimeline(
        BASE_CLIENT_ID,
        20,
        'player1',
        DataSource.SECONDARY,
        {
          2: [createPlayerDeathEvent({ tick: 2, name: 'player1' })],
        },
      );
      const target = buildTimeline(
        TARGET_CLIENT_ID,
        20,
        'player1',
        DataSource.PRIMARY,
        {
          15: [createPlayerDeathEvent({ tick: 15, name: 'player1' })],
        },
      );

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      // PLAYER_DEATH has a window of 8; gap of 13 puts the two deaths well
      // outside it, so both are kept as distinct events.
      const deathAt2 = result.ticks[2]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.PLAYER_DEATH);
      expect(deathAt2).toHaveLength(1);

      const deathAt15 = result.ticks[15]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.PLAYER_DEATH);
      expect(deathAt15).toHaveLength(1);

      expect(result.qualityFlags).toHaveLength(0);
    });

    it('deduplicates NPC deaths by room ID', () => {
      const npcDeath = (tick: number) =>
        createNpcDeathEvent({ tick, roomId: 1, npcId: 100 });

      const base = buildTimeline(
        BASE_CLIENT_ID,
        10,
        'player1',
        DataSource.SECONDARY,
        {
          5: [npcDeath(5)],
        },
      );
      const target = buildTimeline(
        TARGET_CLIENT_ID,
        10,
        'player1',
        DataSource.PRIMARY,
        {
          5: [npcDeath(5)],
        },
      );

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
      const base = buildTimeline(
        BASE_CLIENT_ID,
        10,
        'player1',
        DataSource.SECONDARY,
        {
          5: [createNpcDeathEvent({ tick: 5, roomId: 1, npcId: 100 })],
        },
      );
      const target = buildTimeline(
        TARGET_CLIENT_ID,
        10,
        'player1',
        DataSource.PRIMARY,
        {
          5: [createNpcDeathEvent({ tick: 5, roomId: 2, npcId: 101 })],
        },
      );

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

      const base = buildTimeline(
        BASE_CLIENT_ID,
        15,
        'player1',
        DataSource.SECONDARY,
        {
          3: [phase(3)],
        },
      );
      const target = buildTimeline(
        TARGET_CLIENT_ID,
        15,
        'player1',
        DataSource.PRIMARY,
        {
          12: [phase(12)],
        },
      );

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
      const base = buildTimeline(
        BASE_CLIENT_ID,
        10,
        'player1',
        DataSource.SECONDARY,
        {
          4: [createPlayerDeathEvent({ tick: 4, name: 'player1' })],
        },
      );
      const target = buildTimeline(
        TARGET_CLIENT_ID,
        10,
        'player1',
        DataSource.PRIMARY,
      );

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
      const base = buildTimeline(
        BASE_CLIENT_ID,
        10,
        'player1',
        DataSource.SECONDARY,
      );
      const target = buildTimeline(
        TARGET_CLIENT_ID,
        10,
        'player1',
        DataSource.PRIMARY,
        {
          7: [createPlayerDeathEvent({ tick: 7, name: 'player1' })],
        },
      );

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
      const base = buildTimeline(
        BASE_CLIENT_ID,
        10,
        'player1',
        DataSource.SECONDARY,
        {
          5: [createPlayerDeathEvent({ tick: 5, name: 'player1' })],
        },
      );
      const target = buildTimeline(
        TARGET_CLIENT_ID,
        10,
        'player1',
        DataSource.PRIMARY,
        {
          5: [createPlayerDeathEvent({ tick: 5, name: 'player1' })],
        },
      );

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      expect(result.qualityFlags).toHaveLength(0);
    });

    it('flags a large temporal gap between paired stream events', () => {
      const base = buildTimeline(
        BASE_CLIENT_ID,
        15,
        'player1',
        DataSource.SECONDARY,
        {
          1: [createPlayerDeathEvent({ tick: 1, name: 'player1' })],
        },
      );
      const target = buildTimeline(
        TARGET_CLIENT_ID,
        15,
        'player1',
        DataSource.PRIMARY,
        {
          7: [createPlayerDeathEvent({ tick: 7, name: 'player1' })],
        },
      );

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      const gapFlags = result.qualityFlags.filter(
        (f) => f.kind === 'LARGE_TEMPORAL_GAP',
      );
      expect(gapFlags).toHaveLength(1);
      expect(gapFlags[0]).toMatchObject({
        kind: 'LARGE_TEMPORAL_GAP',
        eventType: ProtoEvent.Type.PLAYER_DEATH,
        tickGap: 6,
        baseTick: 1,
        targetTick: 7,
      });
    });

    it('does not flag a gap below the threshold', () => {
      const base = buildTimeline(
        BASE_CLIENT_ID,
        10,
        'player1',
        DataSource.SECONDARY,
        {
          3: [createPlayerDeathEvent({ tick: 3, name: 'player1' })],
        },
      );
      const target = buildTimeline(
        TARGET_CLIENT_ID,
        10,
        'player1',
        DataSource.PRIMARY,
        {
          4: [createPlayerDeathEvent({ tick: 4, name: 'player1' })],
        },
      );

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      expect(result.qualityFlags).toHaveLength(0);
    });
  });

  describe('attack-mapped events', () => {
    function buildVerzikTimeline(
      clientId: number,
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

      for (let i = 0; i < numTicks; i++) {
        extra[i] = [
          ...(extra[i] ?? []),
          createNpcUpdateEvent({
            tick: i,
            roomId: 1,
            npcId: 8374,
            x: 10,
            y: 10,
            hitpointsCurrent: 100,
            stage: Stage.TOB_VERZIK,
          }),
        ];
      }

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

      return buildTimeline(clientId, numTicks, player, source, extra);
    }

    it('resolves a single attack style candidate', () => {
      const base = buildVerzikTimeline(
        BASE_CLIENT_ID,
        15,
        'player1',
        DataSource.SECONDARY,
        5,
        {
          6: { npcAttackTick: 5, style: 0 },
        },
      );
      const target = buildTimeline(
        TARGET_CLIENT_ID,
        15,
        'player1',
        DataSource.PRIMARY,
      );

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
      expect(result.counters.attackMappedEvents).toBe(1);
    });

    it('sets a relocated attack-mapped event tick to its merged tick', () => {
      const base = buildVerzikTimeline(
        BASE_CLIENT_ID,
        15,
        'player1',
        DataSource.SECONDARY,
        5,
        {
          7: { npcAttackTick: 5, style: 0 },
        },
      );
      const target = buildTimeline(
        TARGET_CLIENT_ID,
        15,
        'player1',
        DataSource.PRIMARY,
      );

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();

      const tick6Events = result.ticks[6]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.TOB_VERZIK_ATTACK_STYLE);
      const tick7Events = result.ticks[7]
        ?.getEvents()
        .filter((e) => e.getType() === ProtoEvent.Type.TOB_VERZIK_ATTACK_STYLE);

      expect(tick6Events).toHaveLength(1);
      expect(tick6Events![0].getTick()).toBe(6);
      expect(tick6Events![0].getVerzikAttackStyle()?.getNpcAttackTick()).toBe(
        5,
      );
      expect(tick7Events).toHaveLength(0);
    });

    it('resolves agreeing candidates as RESOLVED, not conflict', () => {
      const base = buildVerzikTimeline(
        BASE_CLIENT_ID,
        15,
        'player1',
        DataSource.SECONDARY,
        5,
        {
          6: { npcAttackTick: 5, style: 1 },
        },
      );
      const target = buildVerzikTimeline(
        TARGET_CLIENT_ID,
        15,
        'player1',
        DataSource.PRIMARY,
        5,
        {
          6: { npcAttackTick: 5, style: 1 },
        },
      );

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
              createPlayerState({
                username: 'player1',
                clientId: BASE_CLIENT_ID,
                x: 0,
                y: 0,
              }),
              createPlayerState({
                username: 'player2',
                clientId: BASE_CLIENT_ID,
                x: 9,
                y: 10,
              }),
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
              createPlayerState({
                username: 'player1',
                clientId: TARGET_CLIENT_ID,
                x: 0,
                y: 0,
              }),
              createPlayerState({
                username: 'player2',
                clientId: TARGET_CLIENT_ID,
                x: 9,
                y: 10,
              }),
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
          {
            client: createClient(BASE_CLIENT_ID, 'player1', 15),
            status: MergeClientStatus.UNMERGED,
          },
        ],
        [
          TARGET_CLIENT_ID,
          {
            client: createClient(TARGET_CLIENT_ID, 'player2', 15),
            status: MergeClientStatus.UNMERGED,
          },
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
      const base = buildVerzikTimeline(
        BASE_CLIENT_ID,
        15,
        'player1',
        DataSource.SECONDARY,
        5,
        {
          6: { npcAttackTick: 5, style: 1 },
        },
      );
      const target = buildVerzikTimeline(
        TARGET_CLIENT_ID,
        15,
        'player1',
        DataSource.PRIMARY,
        5,
        {
          6: { npcAttackTick: 5, style: 2 },
        },
      );

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
      const base = buildTimeline(
        BASE_CLIENT_ID,
        15,
        'player1',
        DataSource.SECONDARY,
        {
          6: [
            createVerzikAttackStyleEvent({
              tick: 6,
              npcAttackTick: 5,
              style: 0,
            }),
          ],
        },
      );
      const target = buildTimeline(
        TARGET_CLIENT_ID,
        15,
        'player1',
        DataSource.PRIMARY,
      );

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

      expect(result.qualityFlags).toEqual([
        {
          kind: 'ATTACK_MAPPED_NOT_FOUND',
          eventType: ProtoEvent.Type.TOB_VERZIK_ATTACK_STYLE,
          source: 'base',
          clientTick: 6,
          referencedTick: 5,
        },
      ]);
    });

    describe('verzik bounce events', () => {
      const VERZIK_P2_ID = 8372;

      function buildVerzikP2Timeline(
        clientId: number,
        numTicks: number,
        player: string,
        source: DataSource,
        attackTick: number,
        attackType: NpcAttack,
        bounceEvents?: Record<
          number,
          { npcAttackTick: number; bouncedPlayer?: string }
        >,
      ): TickStateArray {
        const extra: Record<number, ProtoEvent[]> = {
          [attackTick]: [
            createNpcAttackEvent({
              tick: attackTick,
              roomId: 1,
              npcId: VERZIK_P2_ID,
              attackType,
              x: 10,
              y: 10,
              stage: Stage.TOB_VERZIK,
            }),
          ],
        };

        for (let i = 0; i < numTicks; i++) {
          extra[i] = [
            ...(extra[i] ?? []),
            createNpcUpdateEvent({
              tick: i,
              roomId: 1,
              npcId: VERZIK_P2_ID,
              x: 10,
              y: 10,
              hitpointsCurrent: 100,
              stage: Stage.TOB_VERZIK,
            }),
          ];
        }

        if (bounceEvents !== undefined) {
          for (const [tick, opts] of Object.entries(bounceEvents)) {
            const t = Number(tick);
            extra[t] = [
              ...(extra[t] ?? []),
              createVerzikBounceEvent({
                tick: t,
                npcAttackTick: opts.npcAttackTick,
                bouncedPlayer: opts.bouncedPlayer,
              }),
            ];
          }
        }

        return buildTimeline(clientId, numTicks, player, source, extra);
      }

      it('resolves a legacy bounce chance event with an npcAttackTick of -1', () => {
        const base = buildVerzikP2Timeline(
          BASE_CLIENT_ID,
          15,
          'player1',
          DataSource.SECONDARY,
          5,
          NpcAttack.TOB_VERZIK_P2_BOUNCE,
          { 5: { npcAttackTick: -1 } },
        );
        const target = buildTimeline(
          TARGET_CLIENT_ID,
          15,
          'player1',
          DataSource.PRIMARY,
        );

        const consolidator = new EventConsolidator(
          base,
          target,
          testCtx(base.length, target.length),
        );
        const result = consolidator.consolidate();

        // The event should be resolved at attackTick + 1 = 6, and the legacy
        // -1 npcAttackTick rewritten to the merged attack tick (5).
        const tick5Bounces = result.ticks[5]
          ?.getEvents()
          .filter((e) => e.getType() === ProtoEvent.Type.TOB_VERZIK_BOUNCE);
        const tick6Bounces = result.ticks[6]
          ?.getEvents()
          .filter((e) => e.getType() === ProtoEvent.Type.TOB_VERZIK_BOUNCE);
        expect(tick5Bounces).toHaveLength(0);
        expect(tick6Bounces).toHaveLength(1);
        expect(tick6Bounces![0].getVerzikBounce()?.getNpcAttackTick()).toBe(5);
        expect(tick6Bounces![0].getVerzikBounce()?.hasBouncedPlayer()).toBe(
          false,
        );
      });

      it('resolves an untargeted bounce against any Verzik P2 attack on the tick', () => {
        const base = buildVerzikP2Timeline(
          BASE_CLIENT_ID,
          15,
          'player1',
          DataSource.SECONDARY,
          5,
          NpcAttack.TOB_VERZIK_P2_MAGE,
          { 5: { npcAttackTick: -1 } },
        );
        const target = buildTimeline(
          TARGET_CLIENT_ID,
          15,
          'player1',
          DataSource.PRIMARY,
        );

        const consolidator = new EventConsolidator(
          base,
          target,
          testCtx(base.length, target.length),
        );
        const result = consolidator.consolidate();

        const tick6Bounces = result.ticks[6]
          ?.getEvents()
          .filter((e) => e.getType() === ProtoEvent.Type.TOB_VERZIK_BOUNCE);
        expect(tick6Bounces).toHaveLength(1);
      });

      it('resolves a targeted bounce against a bounce attack', () => {
        const base = buildVerzikP2Timeline(
          BASE_CLIENT_ID,
          15,
          'player1',
          DataSource.SECONDARY,
          5,
          NpcAttack.TOB_VERZIK_P2_BOUNCE,
          { 6: { npcAttackTick: 5, bouncedPlayer: 'player1' } },
        );
        const target = buildTimeline(
          TARGET_CLIENT_ID,
          15,
          'player1',
          DataSource.PRIMARY,
        );

        const consolidator = new EventConsolidator(
          base,
          target,
          testCtx(base.length, target.length),
        );
        const result = consolidator.consolidate();

        const tick6Bounces = result.ticks[6]
          ?.getEvents()
          .filter((e) => e.getType() === ProtoEvent.Type.TOB_VERZIK_BOUNCE);
        expect(tick6Bounces).toHaveLength(1);
        expect(tick6Bounces![0].getVerzikBounce()?.getBouncedPlayer()).toBe(
          'player1',
        );
        expect(tick6Bounces![0].getVerzikBounce()?.getNpcAttackTick()).toBe(5);
      });

      it('discards a targeted bounce when the attack is not a bounce attack', () => {
        const base = buildVerzikP2Timeline(
          BASE_CLIENT_ID,
          15,
          'player1',
          DataSource.SECONDARY,
          5,
          NpcAttack.TOB_VERZIK_P2_MAGE,
          { 6: { npcAttackTick: 5, bouncedPlayer: 'player1' } },
        );
        const target = buildTimeline(
          TARGET_CLIENT_ID,
          15,
          'player1',
          DataSource.PRIMARY,
        );

        const consolidator = new EventConsolidator(
          base,
          target,
          testCtx(base.length, target.length),
        );
        const result = consolidator.consolidate();

        const bounces = result.ticks
          .flatMap((t) => t?.getEvents() ?? [])
          .filter((e) => e.getType() === ProtoEvent.Type.TOB_VERZIK_BOUNCE);
        expect(bounces).toHaveLength(0);
      });

      it('discards a bounce when no Verzik P2 NPC exists on the referenced tick', () => {
        const base = buildTimeline(
          BASE_CLIENT_ID,
          15,
          'player1',
          DataSource.SECONDARY,
          {
            5: [createVerzikBounceEvent({ tick: 5, npcAttackTick: -1 })],
          },
        );
        const target = buildTimeline(
          TARGET_CLIENT_ID,
          15,
          'player1',
          DataSource.PRIMARY,
        );

        const consolidator = new EventConsolidator(
          base,
          target,
          testCtx(base.length, target.length),
        );
        const result = consolidator.consolidate();

        const bounces = result.ticks
          .flatMap((t) => t?.getEvents() ?? [])
          .filter((e) => e.getType() === ProtoEvent.Type.TOB_VERZIK_BOUNCE);
        expect(bounces).toHaveLength(0);
      });
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
                createPlayerState({
                  username: 'player1',
                  clientId,
                  x: 0,
                  y: 0,
                }),
                createPlayerState({
                  username: 'player2',
                  clientId,
                  x: 10,
                  y: 10,
                }),
                createPlayerState({
                  username: 'attacker',
                  clientId,
                  x: 9,
                  y: 10,
                  attack:
                    i === 5
                      ? {
                          type: attackType,
                          weaponId: 26374,
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
          {
            client: createClient(BASE_CLIENT_ID, 'player1', numTicks),
            status: MergeClientStatus.UNMERGED,
          },
        ],
        [
          TARGET_CLIENT_ID,
          {
            client: createClient(TARGET_CLIENT_ID, 'player2', numTicks),
            status: MergeClientStatus.UNMERGED,
          },
        ],
      ]);

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length, clients),
      );
      const result = consolidator.consolidate();

      const tick5Attack =
        result.ticks[5]?.getPlayerState('attacker')?.attack ?? null;
      expect(tick5Attack).not.toBeNull();
      // player2 is closer to attacker so the target's ZCB_SPEC should win.
      expect(tick5Attack?.type).toBe(PlayerAttack.ZCB_SPEC);
    });

    it('prefers the client whose primary player is the attacker', () => {
      // player2 (target primary) attacks with ZCB_SPEC. player1 sees player2
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
                name: 'player2',
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
                  clientId,
                  x: 20,
                  y: 20,
                }),
                createPlayerState({
                  username: 'player2',
                  clientId,
                  x: 5,
                  y: 5,
                  attack:
                    i === 5
                      ? {
                          type: attackType,
                          weaponId: 26374,
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

      const base = makeTimeline(BASE_CLIENT_ID, PlayerAttack.ZCB_AUTO);
      const target = makeTimeline(TARGET_CLIENT_ID, PlayerAttack.ZCB_SPEC);

      const clients = new Map<number, RegisteredClient>([
        [
          BASE_CLIENT_ID,
          {
            client: createClient(BASE_CLIENT_ID, 'player1', numTicks),
            status: MergeClientStatus.UNMERGED,
          },
        ],
        [
          TARGET_CLIENT_ID,
          {
            client: createClient(TARGET_CLIENT_ID, 'player2', numTicks),
            status: MergeClientStatus.UNMERGED,
          },
        ],
      ]);

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length, clients),
      );
      const result = consolidator.consolidate();

      const tick5Attack =
        result.ticks[5]?.getPlayerState('player2')?.attack ?? null;
      expect(tick5Attack).not.toBeNull();
      expect(tick5Attack?.type).toBe(PlayerAttack.ZCB_SPEC);
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
                clientId: BASE_CLIENT_ID,
                x: 0,
                y: 0,
                attack:
                  i === 5
                    ? {
                        type: PlayerAttack.ZCB_AUTO,
                        weaponId: 26374,
                        target: 1,
                      }
                    : null,
              }),
              createPlayerState({
                username: 'player2',
                clientId: BASE_CLIENT_ID,
                x: 10,
                y: 10,
              }),
            ],
            baseEvents,
            BASE_CLIENT_ID,
          ),
        );

        target.push(
          createTickState(
            i,
            [
              createPlayerState({
                username: 'player1',
                clientId: TARGET_CLIENT_ID,
                x: 0,
                y: 0,
              }),
              createPlayerState({
                username: 'player2',
                clientId: TARGET_CLIENT_ID,
                x: 10,
                y: 10,
              }),
            ],
            targetEvents,
            TARGET_CLIENT_ID,
          ),
        );
      }

      const clients = new Map<number, RegisteredClient>([
        [
          BASE_CLIENT_ID,
          {
            client: createClient(BASE_CLIENT_ID, 'player1', numTicks),
            status: MergeClientStatus.UNMERGED,
          },
        ],
        [
          TARGET_CLIENT_ID,
          {
            client: createClient(TARGET_CLIENT_ID, 'player2', numTicks),
            status: MergeClientStatus.UNMERGED,
          },
        ],
      ]);

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length, clients),
      );
      const result = consolidator.consolidate();

      const tick5Attack =
        result.ticks[5]?.getPlayerState('player1')?.attack ?? null;
      expect(tick5Attack).not.toBeNull();
      expect(tick5Attack?.type).toBe(PlayerAttack.ZCB_AUTO);
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
                createPlayerState({
                  username: 'player1',
                  clientId,
                  x: 0,
                  y: 0,
                }),
                createPlayerState({
                  username: 'player2',
                  clientId,
                  x: 10,
                  y: 10,
                }),
                createPlayerState({
                  username: 'attacker',
                  clientId,
                  x: 9,
                  y: 10,
                  attack:
                    i === 5
                      ? {
                          type: PlayerAttack.ZCB_AUTO,
                          weaponId: 26374,
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
          {
            client: createClient(BASE_CLIENT_ID, 'player1', numTicks),
            status: MergeClientStatus.UNMERGED,
          },
        ],
        [
          TARGET_CLIENT_ID,
          {
            client: createClient(TARGET_CLIENT_ID, 'player2', numTicks),
            status: MergeClientStatus.UNMERGED,
          },
        ],
      ]);

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length, clients),
      );
      const result = consolidator.consolidate();

      const tick5Attack =
        result.ticks[5]?.getPlayerState('attacker')?.attack ?? null;
      expect(tick5Attack).not.toBeNull();
      expect(tick5Attack?.type).toBe(PlayerAttack.ZCB_AUTO);
    });
  });

  describe('player attack target merging', () => {
    function attackEvent(
      tick: number,
      name: string,
      attackType: PlayerAttack,
      targetRoomId?: number,
    ): ProtoEvent {
      return createPlayerAttackEvent({
        tick,
        name,
        attackType,
        targetRoomId,
      });
    }

    function singleTickWithAttack(
      tick: number,
      clientId: number,
      source: DataSource,
      attackType: PlayerAttack | null,
      targetRoomId?: number,
    ): TickStateArray {
      const events: ProtoEvent[] = [
        createPlayerUpdateEvent({ tick, name: 'p1', source }),
      ];
      if (attackType !== null) {
        events.push(attackEvent(tick, 'p1', attackType, targetRoomId));
      }
      return [
        createTickState(
          tick,
          [
            createPlayerState({
              username: 'p1',
              clientId,
              source,
              attack:
                attackType !== null
                  ? {
                      type: attackType,
                      weaponId: 0,
                      target: targetRoomId ?? null,
                    }
                  : null,
            }),
          ],
          events,
          clientId,
        ),
      ];
    }

    it('emits no flag when both clients agree on the target', () => {
      const base = singleTickWithAttack(
        0,
        BASE_CLIENT_ID,
        DataSource.SECONDARY,
        PlayerAttack.PUNCH,
        8370,
      );
      const target = singleTickWithAttack(
        0,
        TARGET_CLIENT_ID,
        DataSource.SECONDARY,
        PlayerAttack.PUNCH,
        8370,
      );

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();
      expect(result.qualityFlags).toEqual([]);
      expect(result.counters.playerAttacks).toBe(1);
    });

    it("fills in target info from other when base's target is null", () => {
      const base = singleTickWithAttack(
        0,
        BASE_CLIENT_ID,
        DataSource.SECONDARY,
        PlayerAttack.PUNCH,
      );
      const target = singleTickWithAttack(
        0,
        TARGET_CLIENT_ID,
        DataSource.SECONDARY,
        PlayerAttack.PUNCH,
        8370,
      );

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();
      expect(result.qualityFlags).toEqual([]);
      expect(result.ticks[0]?.getPlayerState('p1')?.attack?.target).toEqual({
        id: 8370,
        roomId: 8370,
        sourceClientId: TARGET_CLIENT_ID,
      });
    });

    it('keeps base target and emits no flag when other has no target', () => {
      const base = singleTickWithAttack(
        0,
        BASE_CLIENT_ID,
        DataSource.SECONDARY,
        PlayerAttack.PUNCH,
        8370,
      );
      const target = singleTickWithAttack(
        0,
        TARGET_CLIENT_ID,
        DataSource.SECONDARY,
        PlayerAttack.PUNCH,
      );

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();
      expect(result.qualityFlags).toEqual([]);
      expect(
        result.ticks[0]?.getPlayerState('p1')?.attack?.target?.roomId,
      ).toBe(8370);
    });

    it('emits ATTACK_TARGET_MISMATCH on disagreeing roomIds', () => {
      const base = singleTickWithAttack(
        0,
        BASE_CLIENT_ID,
        DataSource.SECONDARY,
        PlayerAttack.PUNCH,
        8370,
      );
      const target = singleTickWithAttack(
        0,
        TARGET_CLIENT_ID,
        DataSource.SECONDARY,
        PlayerAttack.PUNCH,
        8371,
      );

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();
      expect(result.qualityFlags).toEqual([
        {
          kind: 'ATTACK_TARGET_MISMATCH',
          tick: 0,
          player: 'p1',
          keptRoomId: 8370,
          discardedRoomId: 8371,
          keptSourceClientId: BASE_CLIENT_ID,
          discardedSourceClientId: TARGET_CLIENT_ID,
        },
      ]);
      // Base wins; its target is preserved.
      expect(
        result.ticks[0]?.getPlayerState('p1')?.attack?.target?.roomId,
      ).toBe(8370);
    });

    it('fills attack from target when base has no attack on the same tick', () => {
      const base = singleTickWithAttack(
        0,
        BASE_CLIENT_ID,
        DataSource.SECONDARY,
        null,
      );
      const target = singleTickWithAttack(
        0,
        TARGET_CLIENT_ID,
        DataSource.SECONDARY,
        PlayerAttack.SCYTHE,
        8370,
      );

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();
      expect(result.qualityFlags).toEqual([]);
      const attack = result.ticks[0]?.getPlayerState('p1')?.attack;
      expect(attack?.type).toBe(PlayerAttack.SCYTHE);
      expect(attack?.sourceClientId).toBe(TARGET_CLIENT_ID);
    });
  });

  describe('attack type mismatch', () => {
    function singleTick(
      tick: number,
      clientId: number,
      attackType: PlayerAttack,
    ): TickStateArray {
      return [
        createTickState(
          tick,
          [
            createPlayerState({
              username: 'p1',
              clientId,
              attack: {
                type: attackType,
                weaponId: 0,
                target: 8370,
              },
            }),
          ],
          [
            createPlayerUpdateEvent({
              tick,
              name: 'p1',
              source: DataSource.SECONDARY,
            }),
            createPlayerAttackEvent({
              tick,
              name: 'p1',
              attackType,
              targetRoomId: 8370,
            }),
          ],
          clientId,
        ),
      ];
    }

    it('emits ATTACK_TYPE_MISMATCH for non-projectile-ambiguous type difference', () => {
      const base = singleTick(0, BASE_CLIENT_ID, PlayerAttack.SCYTHE);
      const target = singleTick(0, TARGET_CLIENT_ID, PlayerAttack.PUNCH);

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();
      expect(result.qualityFlags).toEqual([
        {
          kind: 'ATTACK_TYPE_MISMATCH',
          tick: 0,
          player: 'p1',
          keptType: PlayerAttack.SCYTHE,
          discardedType: PlayerAttack.PUNCH,
          keptSourceClientId: BASE_CLIENT_ID,
          discardedSourceClientId: TARGET_CLIENT_ID,
        },
      ]);
      // Base attack is preserved.
      expect(result.ticks[0]?.getPlayerState('p1')?.attack?.type).toBe(
        PlayerAttack.SCYTHE,
      );
    });

    it('does not emit ATTACK_TYPE_MISMATCH for projectile-ambiguous types', () => {
      const base = singleTick(0, BASE_CLIENT_ID, PlayerAttack.ZCB_AUTO);
      const target = singleTick(0, TARGET_CLIENT_ID, PlayerAttack.ZCB_SPEC);

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();
      expect(
        result.qualityFlags.filter((f) => f.kind === 'ATTACK_TYPE_MISMATCH'),
      ).toEqual([]);
    });
  });

  describe('player spell merging', () => {
    function singleSpellTick(
      tick: number,
      clientId: number,
      spell: {
        type: PlayerSpell;
        target?: string | number | null;
      } | null,
    ): TickStateArray {
      return [
        createTickState(
          tick,
          [
            createPlayerState({
              username: 'p1',
              clientId,
              spell: spell ?? null,
            }),
          ],
          [
            createPlayerUpdateEvent({
              tick,
              name: 'p1',
              source: DataSource.SECONDARY,
            }),
          ],
          clientId,
        ),
      ];
    }

    it('emits no flag when both clients agree on a targeted spell', () => {
      const base = singleSpellTick(0, BASE_CLIENT_ID, {
        type: PlayerSpell.HEAL_OTHER,
        target: 'player2',
      });
      const target = singleSpellTick(0, TARGET_CLIENT_ID, {
        type: PlayerSpell.HEAL_OTHER,
        target: 'player2',
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();
      expect(result.qualityFlags).toEqual([]);
      expect(result.counters.playerSpells).toBe(1);
    });

    it("fills in spell target from other when base's target is null", () => {
      const base = singleSpellTick(0, BASE_CLIENT_ID, {
        type: PlayerSpell.HEAL_OTHER,
        target: null,
      });
      const target = singleSpellTick(0, TARGET_CLIENT_ID, {
        type: PlayerSpell.HEAL_OTHER,
        target: 'player2',
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();
      expect(result.qualityFlags).toEqual([]);
      const merged = result.ticks[0]?.getPlayerState('p1')?.spell;
      expect(merged?.target?.kind).toBe('player');
      if (merged?.target?.kind === 'player') {
        expect(merged.target.name).toBe('player2');
      }
    });

    it('keeps untargeted spells unchanged when neither side has a target', () => {
      const base = singleSpellTick(0, BASE_CLIENT_ID, {
        type: PlayerSpell.SPELLBOOK_SWAP,
      });
      const target = singleSpellTick(0, TARGET_CLIENT_ID, {
        type: PlayerSpell.SPELLBOOK_SWAP,
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();
      expect(result.qualityFlags).toEqual([]);
      expect(result.ticks[0]?.getPlayerState('p1')?.spell?.target).toBeNull();
    });

    it('clears a spurious target on a base-side untargeted spell', () => {
      const base = singleSpellTick(0, BASE_CLIENT_ID, {
        type: PlayerSpell.SPELLBOOK_SWAP,
        target: 'player2',
      });
      const target = singleSpellTick(0, TARGET_CLIENT_ID, {
        type: PlayerSpell.SPELLBOOK_SWAP,
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();
      expect(result.ticks[0]?.getPlayerState('p1')?.spell?.target).toBeNull();
    });

    it('does not adopt a spurious target from an untargeted spell', () => {
      const base = singleSpellTick(0, BASE_CLIENT_ID, {
        type: PlayerSpell.SPELLBOOK_SWAP,
      });
      const target = singleSpellTick(0, TARGET_CLIENT_ID, {
        type: PlayerSpell.SPELLBOOK_SWAP,
        target: 'player2',
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();
      expect(result.ticks[0]?.getPlayerState('p1')?.spell?.target).toBeNull();
    });

    it('emits SPELL_TARGET_MISMATCH on disagreeing player targets', () => {
      const base = singleSpellTick(0, BASE_CLIENT_ID, {
        type: PlayerSpell.HEAL_OTHER,
        target: 'player2',
      });
      const target = singleSpellTick(0, TARGET_CLIENT_ID, {
        type: PlayerSpell.HEAL_OTHER,
        target: 'player3',
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();
      expect(result.qualityFlags).toEqual([
        {
          kind: 'SPELL_TARGET_MISMATCH',
          tick: 0,
          player: 'p1',
          keptTargetKind: 'player',
          keptTargetId: 'player2',
          discardedTargetKind: 'player',
          discardedTargetId: 'player3',
          keptSourceClientId: BASE_CLIENT_ID,
          discardedSourceClientId: TARGET_CLIENT_ID,
        },
      ]);
    });

    it('emits SPELL_TYPE_MISMATCH on different spell types', () => {
      const base = singleSpellTick(0, BASE_CLIENT_ID, {
        type: PlayerSpell.HEAL_OTHER,
        target: 'player2',
      });
      const target = singleSpellTick(0, TARGET_CLIENT_ID, {
        type: PlayerSpell.VENGEANCE_OTHER,
        target: 'player2',
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();
      expect(result.qualityFlags).toEqual([
        {
          kind: 'SPELL_TYPE_MISMATCH',
          tick: 0,
          player: 'p1',
          keptType: PlayerSpell.HEAL_OTHER,
          discardedType: PlayerSpell.VENGEANCE_OTHER,
          keptSourceClientId: BASE_CLIENT_ID,
          discardedSourceClientId: TARGET_CLIENT_ID,
        },
      ]);
      // Base spell is preserved.
      expect(result.ticks[0]?.getPlayerState('p1')?.spell?.type).toBe(
        PlayerSpell.HEAL_OTHER,
      );
    });

    it('fills spell from target when base has no spell on the same tick', () => {
      const base = singleSpellTick(0, BASE_CLIENT_ID, null);
      const target = singleSpellTick(0, TARGET_CLIENT_ID, {
        type: PlayerSpell.HEAL_OTHER,
        target: 'player2',
      });

      const consolidator = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      );
      const result = consolidator.consolidate();
      expect(result.qualityFlags).toEqual([]);
      expect(result.ticks[0]?.getPlayerState('p1')?.spell?.type).toBe(
        PlayerSpell.HEAL_OTHER,
      );
    });
  });

  describe('npc attack merging', () => {
    function singleTickWithNpcAttack(
      tick: number,
      clientId: number,
      attackType: NpcAttack | null,
      target?: string,
      npcId: number = 8360,
      npcCoords: { x: number; y: number } = { x: 50, y: 50 },
      primaryPlayer: { name: string; x: number; y: number } = {
        name: 'p1',
        x: 0,
        y: 0,
      },
    ): TickStateArray {
      const events: ProtoEvent[] = [
        createPlayerUpdateEvent({
          tick,
          name: primaryPlayer.name,
          source: DataSource.PRIMARY,
          x: primaryPlayer.x,
          y: primaryPlayer.y,
        }),
        createNpcUpdateEvent({
          tick,
          roomId: 1,
          npcId,
          x: npcCoords.x,
          y: npcCoords.y,
          hitpointsCurrent: 500,
        }),
      ];
      if (attackType !== null) {
        events.push(
          createNpcAttackEvent({
            tick,
            roomId: 1,
            npcId,
            attackType,
            target,
          }),
        );
      }
      return [
        createTickState(
          tick,
          [
            createPlayerState({
              username: primaryPlayer.name,
              clientId,
              source: DataSource.PRIMARY,
              x: primaryPlayer.x,
              y: primaryPlayer.y,
            }),
          ],
          events,
          clientId,
        ),
      ];
    }

    it('emits no flag when both clients agree on the attack and target', () => {
      const base = singleTickWithNpcAttack(
        0,
        BASE_CLIENT_ID,
        NpcAttack.TOB_MAIDEN_AUTO,
        'p1',
      );
      const target = singleTickWithNpcAttack(
        0,
        TARGET_CLIENT_ID,
        NpcAttack.TOB_MAIDEN_AUTO,
        'p1',
      );

      const result = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      ).consolidate();

      expect(result.qualityFlags).toEqual([]);
      const attack = result.ticks[0]?.getNpcs().get(1)?.attack;
      expect(attack?.type).toBe(NpcAttack.TOB_MAIDEN_AUTO);
      expect(attack?.target).toBe('p1');
      expect(result.counters.npcAttacks).toBe(1);
    });

    it("fills the attack from target when base's NPC has none", () => {
      const base = singleTickWithNpcAttack(0, BASE_CLIENT_ID, null);
      const target = singleTickWithNpcAttack(
        0,
        TARGET_CLIENT_ID,
        NpcAttack.TOB_MAIDEN_AUTO,
        'p1',
      );

      const result = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      ).consolidate();

      expect(result.qualityFlags).toEqual([]);
      const attack = result.ticks[0]?.getNpcs().get(1)?.attack;
      expect(attack?.type).toBe(NpcAttack.TOB_MAIDEN_AUTO);
      expect(attack?.target).toBe('p1');
      expect(attack?.sourceClientId).toBe(TARGET_CLIENT_ID);
    });

    it("fills target on the kept attack when base's target is null", () => {
      const base = singleTickWithNpcAttack(
        0,
        BASE_CLIENT_ID,
        NpcAttack.TOB_MAIDEN_AUTO,
      );
      const target = singleTickWithNpcAttack(
        0,
        TARGET_CLIENT_ID,
        NpcAttack.TOB_MAIDEN_AUTO,
        'p1',
      );

      const result = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      ).consolidate();

      expect(result.qualityFlags).toEqual([]);
      const attack = result.ticks[0]?.getNpcs().get(1)?.attack;
      expect(attack?.target).toBe('p1');
    });

    it('emits NPC_ATTACK_TARGET_MISMATCH when clients disagree on target', () => {
      const base = singleTickWithNpcAttack(
        0,
        BASE_CLIENT_ID,
        NpcAttack.TOB_MAIDEN_AUTO,
        'p1',
      );
      const target = singleTickWithNpcAttack(
        0,
        TARGET_CLIENT_ID,
        NpcAttack.TOB_MAIDEN_AUTO,
        'p2',
      );

      const result = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      ).consolidate();

      expect(result.qualityFlags).toHaveLength(1);
      expect(result.qualityFlags[0]).toMatchObject({
        kind: 'NPC_ATTACK_TARGET_MISMATCH',
        roomId: 1,
        npcId: 8360,
        keptTarget: 'p1',
        discardedTarget: 'p2',
      });
      // Base's target is kept on the merged attack.
      expect(result.ticks[0]?.getNpcs().get(1)?.attack?.target).toBe('p1');
    });

    it('emits NPC_ATTACK_TYPE_MISMATCH on non-ambiguous type disagreement', () => {
      const base = singleTickWithNpcAttack(
        0,
        BASE_CLIENT_ID,
        NpcAttack.TOB_MAIDEN_AUTO,
        'p1',
      );
      const target = singleTickWithNpcAttack(
        0,
        TARGET_CLIENT_ID,
        NpcAttack.TOB_MAIDEN_BLOOD_THROW,
        'p1',
      );

      const result = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length),
      ).consolidate();

      expect(result.qualityFlags).toHaveLength(1);
      expect(result.qualityFlags[0]).toMatchObject({
        kind: 'NPC_ATTACK_TYPE_MISMATCH',
        roomId: 1,
        npcId: 8360,
        keptType: NpcAttack.TOB_MAIDEN_AUTO,
        discardedType: NpcAttack.TOB_MAIDEN_BLOOD_THROW,
      });
      expect(result.ticks[0]?.getNpcs().get(1)?.attack?.type).toBe(
        NpcAttack.TOB_MAIDEN_AUTO,
      );
    });

    it('resolves projectile-ambiguous types by primary-player proximity', () => {
      const base = singleTickWithNpcAttack(
        0,
        BASE_CLIENT_ID,
        NpcAttack.TOB_SOTE_BALL,
        'p1',
        8388,
        { x: 50, y: 50 },
        { name: 'p1', x: 0, y: 0 },
      );
      const target = singleTickWithNpcAttack(
        0,
        TARGET_CLIENT_ID,
        NpcAttack.TOB_SOTE_DEATH_BALL,
        'p1',
        8388,
        { x: 50, y: 50 },
        { name: 'p2', x: 49, y: 50 },
      );

      const clients = new Map<number, RegisteredClient>([
        [
          BASE_CLIENT_ID,
          {
            client: createClient(BASE_CLIENT_ID, 'p1', base.length),
            status: MergeClientStatus.UNMERGED,
          },
        ],
        [
          TARGET_CLIENT_ID,
          {
            client: createClient(TARGET_CLIENT_ID, 'p2', target.length),
            status: MergeClientStatus.UNMERGED,
          },
        ],
      ]);

      const result = new EventConsolidator(
        base,
        target,
        testCtx(base.length, target.length, clients),
      ).consolidate();

      expect(result.qualityFlags).toEqual([]);
      expect(result.ticks[0]?.getNpcs().get(1)?.attack?.type).toBe(
        NpcAttack.TOB_SOTE_DEATH_BALL,
      );
    });
  });
});

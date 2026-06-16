import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  DataSource,
  EventType,
  PlayerAttack,
  SkillLevel,
  Stage,
  StageStatus,
} from '@blert/common';
import {
  Event as ProtoEvent,
  StageMap,
} from '@blert/common/generated/event_pb';

import { ReferenceSelectionMethod } from '../classification';
import { ClientEvents } from '../client-events';
import { MergeClientStatus } from '../context';
import { EventConsolidator } from '../event-consolidator';
import {
  buildTickTimeline,
  createMaidenBloodSplatsEvent,
  createPlayerAttackEvent,
  createPlayerDeathEvent,
} from './fixtures';
import { MergeConsistencyIssue, RejectionReason } from '../merge-consistency';
import {
  MergedEvents,
  Merger,
  MergeClientClassification,
  MergeOptions,
} from '../merge';
import { MergeAlertType } from '../quality';
import { MergeTracer } from '../trace';

type Proto<T> = T[keyof T];

type TestEventInput = {
  type?: EventType;
  tick?: number;
  xCoord?: number;
  yCoord?: number;
  stage: Stage;
  player?: {
    name: string;
    source: DataSource;
    offCooldownTick?: number;
    prayerSet?: number;
    attack?: number;
    strength?: number;
    defence?: number;
    magic?: number;
    ranged?: number;
    hitpoints?: number;
    prayer?: number;
  };
  npc?: {
    roomId: number;
    id: number;
    hitpoints: number;
    hitpointsBase: number;
  };
};

function createEvent(event: TestEventInput): ProtoEvent {
  const evt = new ProtoEvent();
  evt.setType(event.type as Proto<ProtoEvent.TypeMap>);
  evt.setTick(event.tick ?? 0);
  evt.setXCoord(event.xCoord ?? 0);
  evt.setYCoord(event.yCoord ?? 0);
  evt.setStage(event.stage as Proto<StageMap>);

  if (event.player) {
    const player = new ProtoEvent.Player();
    player.setName(event.player.name);
    player.setDataSource(
      event.player.source as Proto<ProtoEvent.Player.DataSourceMap>,
    );
    player.setOffCooldownTick(event.player.offCooldownTick ?? 0);
    player.setActivePrayers(event.player.prayerSet ?? 0);
    if (event.player.attack) {
      player.setAttack(event.player.attack);
    }
    if (event.player.strength) {
      player.setStrength(event.player.strength);
    }
    if (event.player.defence) {
      player.setDefence(event.player.defence);
    }
    if (event.player.magic) {
      player.setMagic(event.player.magic);
    }
    if (event.player.ranged) {
      player.setRanged(event.player.ranged);
    }
    if (event.player.hitpoints) {
      player.setHitpoints(event.player.hitpoints);
    }
    if (event.player.prayer) {
      player.setPrayer(event.player.prayer);
    }
    evt.setPlayer(player);
  }

  if (event.npc) {
    const npc = new ProtoEvent.Npc();
    npc.setRoomId(event.npc.roomId);
    npc.setId(event.npc.id);
    npc.setHitpoints(
      new SkillLevel(event.npc.hitpoints, event.npc.hitpointsBase).toRaw(),
    );
    evt.setNpc(npc);
  }

  return evt;
}

const BOSS_HP_BASE = 100;

/**
 * Generates player update events and an NPC_UPDATE event for each tick.
 *
 * Players move 1 tile per tick (within the consistency check's 2-tile max).
 * The NPC has tick-specific hitpoints (decreasing by 5 each tick) so the
 * similarity scorer can unambiguously match corresponding ticks.
 *
 * @param realTickOffset When set, local tick `t` uses the positions and NPC
 *   HP that would appear at real tick `t + realTickOffset`. This simulates
 *   a client that joined late and missed the first `realTickOffset` ticks.
 */
function generateTickEvents(
  numTicks: number,
  opts?: {
    startTick?: number;
    primaryPlayer?: string;
    realTickOffset?: number;
    playerY?: number;
  },
): ProtoEvent[] {
  const startTick = opts?.startTick ?? 0;
  const primary = opts?.primaryPlayer ?? 'player1';
  const realTickOffset = opts?.realTickOffset ?? 0;
  const playerY = opts?.playerY ?? 0;
  const events: ProtoEvent[] = [];

  for (let t = 0; t < numTicks; t++) {
    const tick = startTick + t;
    const realTick = tick + realTickOffset;
    // Players move 1 tile per tick; player2 is offset 3 tiles to the right.
    const p1x = realTick;
    const p2x = realTick + 3;

    events.push(
      createEvent({
        type: EventType.PLAYER_UPDATE,
        tick,
        xCoord: p1x,
        yCoord: playerY,
        stage: Stage.TOB_MAIDEN,
        player: {
          name: 'player1',
          source:
            primary === 'player1' ? DataSource.PRIMARY : DataSource.SECONDARY,
          offCooldownTick: 0,
          prayerSet: 0,
          attack: new SkillLevel(118, 99).toRaw(),
          strength: new SkillLevel(118, 99).toRaw(),
          defence: new SkillLevel(118, 99).toRaw(),
        },
      }),
    );
    events.push(
      createEvent({
        type: EventType.PLAYER_UPDATE,
        tick,
        xCoord: p2x,
        yCoord: playerY,
        stage: Stage.TOB_MAIDEN,
        player: {
          name: 'player2',
          source:
            primary === 'player2' ? DataSource.PRIMARY : DataSource.SECONDARY,
          offCooldownTick: 0,
          prayerSet: 0,
          attack: new SkillLevel(118, 99).toRaw(),
          strength: new SkillLevel(118, 99).toRaw(),
          defence: new SkillLevel(118, 99).toRaw(),
        },
      }),
    );

    // NPC_UPDATE with tick-specific HP so the scorer has a strong signal.
    const hp = Math.max(BOSS_HP_BASE - realTick * 5, 1);
    events.push(
      createEvent({
        type: EventType.NPC_UPDATE,
        tick,
        xCoord: 50,
        yCoord: 50,
        stage: Stage.TOB_MAIDEN,
        npc: {
          roomId: 1,
          id: 8360,
          hitpoints: hp,
          hitpointsBase: BOSS_HP_BASE,
        },
      }),
    );
  }

  return events;
}

const SCYTHE_COOLDOWN = 5;
const SCYTHE_WEAPON_ID = 22325;

const client1Events = [
  createEvent({
    type: EventType.PLAYER_UPDATE,
    tick: 0,
    stage: Stage.TOB_MAIDEN,
    player: {
      name: 'player1',
      source: DataSource.PRIMARY,
      offCooldownTick: 0,
      prayerSet: 0,
      attack: new SkillLevel(118, 99).toRaw(),
      strength: new SkillLevel(118, 99).toRaw(),
      defence: new SkillLevel(118, 99).toRaw(),
    },
  }),
  createEvent({
    type: EventType.PLAYER_UPDATE,
    tick: 0,
    stage: Stage.TOB_MAIDEN,
    player: {
      name: 'player2',
      source: DataSource.SECONDARY,
      offCooldownTick: 0,
      prayerSet: 0,
    },
  }),
  createEvent({
    type: EventType.PLAYER_UPDATE,
    tick: 1,
    stage: Stage.TOB_MAIDEN,
    player: {
      name: 'player1',
      source: DataSource.PRIMARY,
      offCooldownTick: SCYTHE_COOLDOWN + 1,
      prayerSet: 0,
      attack: new SkillLevel(118, 99).toRaw(),
      strength: new SkillLevel(118, 99).toRaw(),
      defence: new SkillLevel(118, 99).toRaw(),
    },
  }),
  createEvent({
    type: EventType.PLAYER_UPDATE,
    tick: 1,
    stage: Stage.TOB_MAIDEN,
    player: {
      name: 'player2',
      source: DataSource.SECONDARY,
      offCooldownTick: 0,
      prayerSet: 0,
    },
  }),
  createPlayerAttackEvent({
    tick: 1,
    name: 'player1',
    attackType: PlayerAttack.SCYTHE,
    weaponId: SCYTHE_WEAPON_ID,
    stage: Stage.TOB_MAIDEN,
  }),
];

const fakeChallenge = {
  id: 99,
  uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeffffff',
  type: ChallengeType.TOB,
  mode: ChallengeMode.TOB_REGULAR,
  status: ChallengeStatus.WIPED,
  stage: Stage.TOB_SOTETSEG,
  party: ['player1', 'player2'],
};

describe('Merger', () => {
  it('fails when there are no clients to merge', () => {
    const merger = new Merger(fakeChallenge, Stage.TOB_MAIDEN, []);
    expect(merger.merge()).toBeNull();
  });

  it("uses a single inaccurate client's events directly", () => {
    const client1 = ClientEvents.fromRawEvents(
      1,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.WIPED,
        accurate: false,
        recordedTicks: 0,
        serverTicks: null,
      },
      client1Events,
    );
    const merger = new Merger(fakeChallenge, Stage.TOB_MAIDEN, [client1]);
    const result = merger.merge();

    expect(result).not.toBeNull();
    expect(result!.clients).toHaveLength(1);
    expect(result!.clients[0]).toMatchObject({
      id: client1.getId(),
      status: MergeClientStatus.MERGED,
      classification: MergeClientClassification.REFERENCE,
    });
    expect(result!.mergedCount).toBe(1);
    expect(result!.unmergedCount).toBe(0);
    expect(result!.skippedCount).toBe(0);
    expect(result!.alerts).toEqual([]);

    const events = result!.events;
    expect(events.accurateUntil()).toBe(0);
    expect(events.queryableUntil()).toBe(0);
    expect(events.fullyAccurate()).toBe(false);
    expect(events.fullyQueryable()).toBe(false);
    expect(events.getMissingTickCount()).toBe(0);
    const allEvents = Array.from(events);
    expect(allEvents.length).toBe(client1Events.length);

    expect(allEvents.map((e) => e.toObject())).toEqual(
      client1Events.map((e) => e.toObject()),
    );
  });

  it("uses a single accurate client's events directly", () => {
    const client1 = ClientEvents.fromRawEvents(
      1,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.COMPLETED,
        accurate: true,
        recordedTicks: 2,
        serverTicks: {
          count: 2,
          precise: true,
        },
      },
      client1Events,
    );
    const merger = new Merger(fakeChallenge, Stage.TOB_MAIDEN, [client1]);
    const result = merger.merge();

    expect(result).not.toBeNull();
    expect(result!.clients).toHaveLength(1);
    expect(result!.clients[0]).toMatchObject({
      id: client1.getId(),
      status: MergeClientStatus.MERGED,
      classification: MergeClientClassification.REFERENCE,
    });
    expect(result!.mergedCount).toBe(1);
    expect(result!.unmergedCount).toBe(0);
    expect(result!.skippedCount).toBe(0);
    expect(result!.alerts).toEqual([]);

    const events = result!.events;
    expect(events.accurateUntil()).toBe(3);
    expect(events.queryableUntil()).toBe(3);
    expect(events.fullyAccurate()).toBe(true);
    expect(events.fullyQueryable()).toBe(true);
    expect(events.hasPreciseServerTickCount()).toBe(true);
    expect(events.getMissingTickCount()).toBe(0);
    const allEvents = Array.from(events);
    expect(allEvents.length).toBe(client1Events.length);

    expect(allEvents.map((e) => e.toObject())).toEqual(
      client1Events.map((e) => e.toObject()),
    );
  });

  it('records an alert when multiple accurate tick modes exist', () => {
    const accurateClientA = ClientEvents.fromRawEvents(
      10,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.COMPLETED,
        accurate: true,
        recordedTicks: 2,
        serverTicks: { count: 2, precise: true },
      },
      client1Events,
    );

    const accurateClientB = ClientEvents.fromRawEvents(
      11,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.COMPLETED,
        accurate: true,
        recordedTicks: 3,
        serverTicks: { count: 3, precise: true },
      },
      client1Events,
    );

    const merger = new Merger(fakeChallenge, Stage.TOB_MAIDEN, [
      accurateClientA,
      accurateClientB,
    ]);
    const result = merger.merge();

    expect(result).not.toBeNull();
    expect(result!.alerts).toEqual([
      {
        type: MergeAlertType.MULTIPLE_ACCURATE_TICK_MODES,
        details: { tickCounts: [2, 3] },
      },
    ]);
    expect(result!.clients.map((c) => c.derivedAccurate)).toEqual([
      false,
      false,
    ]);
  });

  it('flags disagreeing server tick counts among non-accurate clients', () => {
    const clientA = ClientEvents.fromRawEvents(
      1,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.WIPED,
        accurate: false,
        recordedTicks: 1,
        serverTicks: { count: 1, precise: true },
      },
      client1Events,
    );
    const clientB = ClientEvents.fromRawEvents(
      2,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.WIPED,
        accurate: false,
        recordedTicks: 1,
        serverTicks: { count: 2, precise: true },
      },
      client1Events,
    );

    const result = new Merger(fakeChallenge, Stage.TOB_MAIDEN, [
      clientA,
      clientB,
    ]).merge();

    expect(result).not.toBeNull();
    expect(result!.alerts).toContainEqual({
      type: MergeAlertType.MULTIPLE_SERVER_TICK_COUNTS,
      details: {
        method: ReferenceSelectionMethod.PRECISE_SERVER,
        counts: [1, 2],
      },
    });
  });

  it('offsets ticks for an inaccurate client with a reported stage update', () => {
    const MISSING_TICKS = 8;

    const client1 = ClientEvents.fromRawEvents(
      1,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.WIPED,
        accurate: false,
        recordedTicks: 2,
        serverTicks: {
          count: 2 + MISSING_TICKS,
          precise: true,
        },
      },
      client1Events,
    );
    const merger = new Merger(fakeChallenge, Stage.TOB_MAIDEN, [client1]);
    const result = merger.merge();

    expect(result).not.toBeNull();
    expect(result!.clients).toHaveLength(1);
    expect(result!.clients[0]).toMatchObject({
      id: client1.getId(),
      status: MergeClientStatus.MERGED,
      classification: MergeClientClassification.REFERENCE,
    });
    expect(result!.mergedCount).toBe(1);
    expect(result!.unmergedCount).toBe(0);
    expect(result!.skippedCount).toBe(0);
    expect(result!.alerts).toEqual([
      {
        type: MergeAlertType.TIMELINE_OFFSET_APPLIED,
        details: { offset: MISSING_TICKS, referenceCount: 2 + MISSING_TICKS },
      },
    ]);

    const events = result!.events;
    expect(events.accurateUntil()).toBe(0);
    expect(events.queryableUntil()).toBe(0);
    expect(events.getMissingTickCount()).toBe(MISSING_TICKS);
    const allEvents = Array.from(events);
    expect(allEvents.length).toBe(client1Events.length);

    const attack = client1Events.find(
      (e) => e.getType() === EventType.PLAYER_ATTACK,
    )!;

    expect(allEvents.map((e) => e.toObject())).toEqual(
      client1Events.map((e) => {
        const obj = e.toObject();
        obj.tick += MISSING_TICKS;
        if (obj.type === EventType.PLAYER_UPDATE && obj.player) {
          if (obj.player.name === attack.getPlayer()?.getName()) {
            if (e.getTick() < attack.getTick()) {
              obj.player.offCooldownTick = 0;
            } else {
              obj.player.offCooldownTick += MISSING_TICKS;
            }
          } else {
            obj.player.offCooldownTick = 0;
          }
        }
        return obj;
      }),
    );
  });

  it('reports reference selection details in result', () => {
    const client1 = ClientEvents.fromRawEvents(
      1,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.COMPLETED,
        accurate: true,
        recordedTicks: 2,
        serverTicks: {
          count: 2,
          precise: true,
        },
      },
      client1Events,
    );

    const merger = new Merger(fakeChallenge, Stage.TOB_MAIDEN, [client1]);

    const result = merger.merge();
    expect(result).not.toBeNull();
    expect(result!.referenceSelection).toEqual({
      count: 2,
      method: ReferenceSelectionMethod.ACCURATE_MODAL,
      details: {
        accurateClientIds: [client1.getId()],
        accurateTickCounts: [[2, 1]],
      },
    });
  });

  const ALIGN_OPTIONS: MergeOptions = { alignMismatched: true };

  it('merges an inaccurate target into an accurate base via alignment', () => {
    const NUM_TICKS = 10;

    // Base: accurate client with ticks 0-9, player1 primary.
    const baseEvents = generateTickEvents(NUM_TICKS, {
      primaryPlayer: 'player1',
    });
    const base = ClientEvents.fromRawEvents(
      1,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.COMPLETED,
        accurate: true,
        recordedTicks: NUM_TICKS,
        serverTicks: { count: NUM_TICKS, precise: true },
      },
      baseEvents,
    );

    // Target: inaccurate client with the same tick data, player2 primary.
    const targetEvents = generateTickEvents(NUM_TICKS, {
      primaryPlayer: 'player2',
    });
    const target = ClientEvents.fromRawEvents(
      2,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.COMPLETED,
        accurate: false,
        recordedTicks: NUM_TICKS,
        serverTicks: null,
      },
      targetEvents,
    );

    const merger = new Merger(fakeChallenge, Stage.TOB_MAIDEN, [base, target]);
    const tracer = new MergeTracer();
    const result = merger.merge(tracer, ALIGN_OPTIONS);

    expect(result).not.toBeNull();
    expect(result!.mergedCount).toBe(2);
    expect(result!.unmergedCount).toBe(0);

    const targetClient = result!.clients.find((c) => c.id === 2);
    expect(targetClient).toBeDefined();
    expect(targetClient!.status).toBe(MergeClientStatus.MERGED);
    expect(targetClient!.classification).toBe(
      MergeClientClassification.MISMATCHED,
    );

    // The target was merged by alignment, not identity, with confidence
    // reflecting the alignment coverage, with matching content.
    const targetStep = tracer
      .toTrace()
      .mergeSteps.find((s) => s.clientId === 2);
    expect(targetStep!.confidence).not.toBeNull();
    const confidence = targetStep!.confidence!;
    expect(confidence.structural.identity).toBe(false);
    expect(confidence.structural.targetCoverage).toBeGreaterThan(0.8);
    expect(confidence.structural.targetCoverage).toBeLessThanOrEqual(1);
    expect(confidence.content.value).toBe(1);
    expect(confidence.overall).toBeGreaterThanOrEqual(0.8);
    expect(confidence.overall).toBeLessThanOrEqual(1);

    // After merge, player2 should have PRIMARY data contributed by the target.
    const events = result!.events;
    for (let tick = 0; tick < NUM_TICKS; tick++) {
      const tickEvents = events.eventsForTick(tick);
      const p2Update = tickEvents.find(
        (e) =>
          e.getType() === EventType.PLAYER_UPDATE &&
          e.getPlayer()?.getName() === 'player2',
      );
      expect(p2Update).toBeDefined();
      expect(p2Update!.getPlayer()!.getDataSource()).toBe(DataSource.PRIMARY);
    }
  });

  it('merges an inaccurate target with offset into an accurate base', () => {
    const BASE_TICKS = 15;
    const OFFSET = 3;
    const TARGET_TICKS = BASE_TICKS - OFFSET;

    // Base: accurate, ticks 0-14.
    const baseEvents = generateTickEvents(BASE_TICKS, {
      primaryPlayer: 'player1',
    });
    const base = ClientEvents.fromRawEvents(
      1,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.COMPLETED,
        accurate: true,
        recordedTicks: BASE_TICKS,
        serverTicks: { count: BASE_TICKS, precise: true },
      },
      baseEvents,
    );

    // Target: inaccurate, 12 ticks. Local ticks 0-11 correspond to real ticks
    // 3-14 (the target joined late, missing the first 3 ticks). Use positions
    // matching base ticks 3-14 so the aligner maps correctly.
    const targetEvents = generateTickEvents(TARGET_TICKS, {
      primaryPlayer: 'player2',
      realTickOffset: OFFSET,
    });

    const target = ClientEvents.fromRawEvents(
      2,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.COMPLETED,
        accurate: false,
        recordedTicks: TARGET_TICKS,
        serverTicks: null,
      },
      targetEvents,
    );

    const merger = new Merger(fakeChallenge, Stage.TOB_MAIDEN, [base, target]);
    const result = merger.merge(undefined, ALIGN_OPTIONS);

    expect(result).not.toBeNull();
    expect(result!.mergedCount).toBe(2);

    // Target events should land at base ticks 3-14 (the ticks where positions
    // match). Player2 should have PRIMARY data on those ticks.
    const events = result!.events;
    for (let tick = OFFSET; tick < BASE_TICKS; tick++) {
      const tickEvents = events.eventsForTick(tick);
      const p2Update = tickEvents.find(
        (e) =>
          e.getType() === EventType.PLAYER_UPDATE &&
          e.getPlayer()?.getName() === 'player2',
      );
      expect(p2Update).toBeDefined();
      expect(p2Update!.getPlayer()!.getDataSource()).toBe(DataSource.PRIMARY);
    }

    // Ticks 0-2 should still have the base's secondary data for player2.
    for (let tick = 0; tick < OFFSET; tick++) {
      const tickEvents = events.eventsForTick(tick);
      const p2Update = tickEvents.find(
        (e) =>
          e.getType() === EventType.PLAYER_UPDATE &&
          e.getPlayer()?.getName() === 'player2',
      );
      expect(p2Update).toBeDefined();
      expect(p2Update!.getPlayer()!.getDataSource()).toBe(DataSource.SECONDARY);
    }
  });

  it('inserts target ticks into the base timeline to fill gaps', () => {
    const NUM_TICKS = 15;
    const GAP_AT = 7;

    // Base (ID 1): 14 local ticks. Missed real tick 7, so local ticks 7-13
    // have data corresponding to real ticks 8-14. This simulates a client
    // that lagged and compressed out a tick.
    const baseEvents = [
      ...generateTickEvents(GAP_AT, { primaryPlayer: 'player1' }),
      ...generateTickEvents(NUM_TICKS - GAP_AT - 1, {
        startTick: GAP_AT,
        primaryPlayer: 'player1',
        realTickOffset: 1,
      }),
    ];
    const base = ClientEvents.fromRawEvents(
      1,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.COMPLETED,
        accurate: false,
        recordedTicks: NUM_TICKS - 1,
        serverTicks: null,
      },
      baseEvents,
    );

    // Target (ID 2): 14 local ticks with all real ticks 0-13.
    const targetEvents = generateTickEvents(NUM_TICKS - 1, {
      primaryPlayer: 'player2',
    });
    const target = ClientEvents.fromRawEvents(
      2,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.COMPLETED,
        accurate: false,
        recordedTicks: NUM_TICKS - 1,
        serverTicks: null,
      },
      targetEvents,
    );

    // Client 1 (gap) is selected as base (lower ID tiebreak). The alignment
    // should INSERT target tick 7 to fill the gap in the base timeline.
    const merger = new Merger(fakeChallenge, Stage.TOB_MAIDEN, [base, target]);
    const result = merger.merge(undefined, ALIGN_OPTIONS);

    expect(result).not.toBeNull();
    expect(result!.mergedCount).toBe(2);

    // Verify that the gap client (ID 1) was selected as base and the
    // full-data client (ID 2) is the mismatched target being aligned in.
    const baseClient = result!.clients.find((c) => c.id === 1);
    expect(baseClient).toBeDefined();
    expect(baseClient!.classification).toBe(
      MergeClientClassification.REFERENCE,
    );
    const targetClient = result!.clients.find((c) => c.id === 2);
    expect(targetClient).toBeDefined();
    expect(targetClient!.classification).toBe(
      MergeClientClassification.MISMATCHED,
    );
    expect(targetClient!.status).toBe(MergeClientStatus.MERGED);

    const events = result!.events;

    // The timeline should have grown by 1 due to the inserted tick.
    expect(events.getLastTick()).toBe(NUM_TICKS);

    // The inserted tick (new position 7) should have the target's data
    // for real tick 7. NPC HP at real tick 7 = 100 - 7*5 = 65.
    const insertedTickEvents = events.eventsForTick(GAP_AT);
    const npcUpdate = insertedTickEvents.find(
      (e) => e.getType() === EventType.NPC_UPDATE,
    );
    expect(npcUpdate).toBeDefined();
    expect(
      SkillLevel.fromRaw(npcUpdate!.getNpc()!.getHitpoints()).getCurrent(),
    ).toBe(BOSS_HP_BASE - GAP_AT * 5);

    // Player2 at the inserted tick should have PRIMARY data (from target).
    const p2Update = insertedTickEvents.find(
      (e) =>
        e.getType() === EventType.PLAYER_UPDATE &&
        e.getPlayer()?.getName() === 'player2',
    );
    expect(p2Update).toBeDefined();
    expect(p2Update!.getPlayer()!.getDataSource()).toBe(DataSource.PRIMARY);
  });

  it('does not merge mismatched clients when alignMismatched is not set', () => {
    const NUM_TICKS = 10;

    const baseEvents = generateTickEvents(NUM_TICKS, {
      primaryPlayer: 'player1',
    });
    const base = ClientEvents.fromRawEvents(
      1,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.COMPLETED,
        accurate: true,
        recordedTicks: NUM_TICKS,
        serverTicks: { count: NUM_TICKS, precise: true },
      },
      baseEvents,
    );

    const targetEvents = generateTickEvents(NUM_TICKS, {
      primaryPlayer: 'player2',
    });
    const target = ClientEvents.fromRawEvents(
      2,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.COMPLETED,
        accurate: false,
        recordedTicks: NUM_TICKS,
        serverTicks: null,
      },
      targetEvents,
    );

    // No options: default behavior.
    const merger = new Merger(fakeChallenge, Stage.TOB_MAIDEN, [base, target]);
    const result = merger.merge();

    expect(result).not.toBeNull();
    expect(result!.mergedCount).toBe(1);
    expect(result!.unmergedCount).toBe(1);

    const targetClient = result!.clients.find((c) => c.id === 2);
    expect(targetClient!.status).toBe(MergeClientStatus.UNMERGED);
  });

  it('leaves a client unmerged when alignment finds no overlapping region', () => {
    const NUM_TICKS = 12;

    const baseEvents = generateTickEvents(NUM_TICKS, {
      primaryPlayer: 'player1',
    });
    const base = ClientEvents.fromRawEvents(
      1,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.COMPLETED,
        accurate: true,
        recordedTicks: NUM_TICKS,
        serverTicks: { count: NUM_TICKS, precise: true },
      },
      baseEvents,
    );

    // The target's shared players sit at a different y coordinate.
    const targetEvents = generateTickEvents(NUM_TICKS, {
      primaryPlayer: 'player2',
      playerY: 100,
    });
    const target = ClientEvents.fromRawEvents(
      2,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.COMPLETED,
        accurate: false,
        recordedTicks: NUM_TICKS,
        serverTicks: null,
      },
      targetEvents,
    );

    const merger = new Merger(fakeChallenge, Stage.TOB_MAIDEN, [base, target]);
    const tracer = new MergeTracer();
    const result = merger.merge(tracer, ALIGN_OPTIONS);

    expect(result).not.toBeNull();
    // Only the base is merged.
    expect(result!.mergedCount).toBe(1);
    expect(result!.unmergedCount).toBe(1);

    const targetClient = result!.clients.find((c) => c.id === 2);
    expect(targetClient!.classification).toBe(
      MergeClientClassification.MISMATCHED,
    );
    expect(targetClient!.status).toBe(MergeClientStatus.UNMERGED);
    expect(targetClient!.mergeIssues).toEqual([]);

    const targetStep = tracer
      .toTrace()
      .mergeSteps.find((s) => s.clientId === 2);
    expect(targetStep!.status).toBe(MergeClientStatus.UNMERGED);
    expect(targetStep!.alignment!.alignments).toHaveLength(0);
    expect(targetStep!.confidence).toBeNull();

    // The base timeline is untouched.
    const events = result!.events;
    expect(events.getLastTick()).toBe(base.getFinalTick());
    for (let tick = 0; tick < NUM_TICKS; tick++) {
      const p2Update = events
        .eventsForTick(tick)
        .find(
          (e) =>
            e.getType() === EventType.PLAYER_UPDATE &&
            e.getPlayer()?.getName() === 'player2',
        );
      expect(p2Update).toBeDefined();
      expect(p2Update!.getPlayer()!.getDataSource()).toBe(DataSource.SECONDARY);
    }
  });

  describe('postprocessing', () => {
    it('preserves finalized tick events when correcting delayed Maiden spawn', () => {
      const playerUpdate = (tick: number) =>
        createEvent({
          type: EventType.PLAYER_UPDATE,
          tick,
          xCoord: tick,
          yCoord: 0,
          stage: Stage.TOB_MAIDEN,
          player: {
            name: 'player1',
            source: DataSource.PRIMARY,
            offCooldownTick: 0,
            prayerSet: 0,
          },
        });

      const client = ClientEvents.fromRawEvents(
        1,
        fakeChallenge,
        {
          stage: Stage.TOB_MAIDEN,
          status: StageStatus.COMPLETED,
          accurate: true,
          recordedTicks: 2,
          serverTicks: { count: 2, precise: true },
        },
        [
          playerUpdate(0),
          playerUpdate(1),
          playerUpdate(2),
          createEvent({
            type: EventType.NPC_SPAWN,
            tick: 2,
            xCoord: 50,
            yCoord: 50,
            stage: Stage.TOB_MAIDEN,
            npc: {
              roomId: 1,
              id: 8360,
              hitpoints: BOSS_HP_BASE,
              hitpointsBase: BOSS_HP_BASE,
            },
          }),
          createMaidenBloodSplatsEvent({
            tick: 2,
            coords: [{ x: 10, y: 20 }],
          }),
        ],
      );

      const merger = new Merger(fakeChallenge, Stage.TOB_MAIDEN, [client]);
      const result = merger.merge();

      expect(result).not.toBeNull();

      const tick0Events = result!.events.eventsForTick(0);
      expect(
        tick0Events.some(
          (e) =>
            e.getType() === EventType.NPC_SPAWN &&
            e.getNpc()?.getRoomId() === 1,
        ),
      ).toBe(true);

      const tick2Events = result!.events.eventsForTick(2);
      expect(
        tick2Events.some(
          (e) =>
            e.getType() === EventType.NPC_SPAWN &&
            e.getNpc()?.getRoomId() === 1,
        ),
      ).toBe(false);
      expect(
        tick2Events.some(
          (e) =>
            e.getType() === EventType.NPC_UPDATE &&
            e.getNpc()?.getRoomId() === 1,
        ),
      ).toBe(true);
      expect(
        tick2Events.some(
          (e) =>
            e.getType() === EventType.PLAYER_UPDATE &&
            e.getPlayer()?.getName() === 'player1',
        ),
      ).toBe(true);
      expect(
        tick2Events.some(
          (e) => e.getType() === EventType.TOB_MAIDEN_BLOOD_SPLATS,
        ),
      ).toBe(true);
    });
  });

  describe('post-merge consistency rejection', () => {
    let consolidateSpy: jest.SpyInstance;

    afterEach(() => {
      consolidateSpy?.mockRestore();
    });

    it('rolls back the step and surfaces issues when the checker flags a duplicate', () => {
      const NUM_TICKS = 6;
      const baseEvents = generateTickEvents(NUM_TICKS, {
        primaryPlayer: 'player1',
      });
      const base = ClientEvents.fromRawEvents(
        1,
        fakeChallenge,
        {
          stage: Stage.TOB_MAIDEN,
          status: StageStatus.COMPLETED,
          accurate: true,
          recordedTicks: NUM_TICKS,
          serverTicks: { count: NUM_TICKS, precise: true },
        },
        baseEvents,
      );

      const targetEvents = generateTickEvents(NUM_TICKS, {
        primaryPlayer: 'player1',
      });
      const target = ClientEvents.fromRawEvents(
        2,
        fakeChallenge,
        {
          stage: Stage.TOB_MAIDEN,
          status: StageStatus.COMPLETED,
          accurate: true,
          recordedTicks: NUM_TICKS,
          serverTicks: { count: NUM_TICKS, precise: true },
        },
        targetEvents,
      );

      const fabricatedTicks = buildTickTimeline(NUM_TICKS, {
        2: [createPlayerDeathEvent({ tick: 2, name: 'player1' })],
        5: [createPlayerDeathEvent({ tick: 5, name: 'player1' })],
      });
      consolidateSpy = jest
        .spyOn(EventConsolidator.prototype, 'consolidate')
        .mockReturnValue({
          ticks: fabricatedTicks,
          qualityFlags: [],
          counters: {
            playerAttacks: 0,
            playerSpells: 0,
            npcAttacks: 0,
            streamEventPairs: 0,
            attackMappedEvents: 0,
          },
        });

      const merger = new Merger(fakeChallenge, Stage.TOB_MAIDEN, [
        base,
        target,
      ]);
      const tracer = new MergeTracer();
      const result = merger.merge(tracer);

      expect(result).not.toBeNull();
      expect(result!.unmergedCount).toBe(1);

      const targetClient = result!.clients.find((c) => c.id === 2);
      expect(targetClient).toBeDefined();
      expect(targetClient!.status).toBe(MergeClientStatus.UNMERGED);
      expect(targetClient!.mergeIssues).toEqual<MergeConsistencyIssue[]>([
        {
          kind: 'DUPLICATE_PLAYER_DEATH',
          player: 'player1',
          ticks: [2, 5],
        },
      ]);

      // Rollback: the fabricated ticks (which contained the duplicate) do
      // not appear in the merged output.
      let deathCount = 0;
      for (let tick = 0; tick < NUM_TICKS; tick++) {
        deathCount += result!.events
          .eventsForTick(tick)
          .filter((e) => e.getType() === EventType.PLAYER_DEATH).length;
      }
      expect(deathCount).toBe(0);

      const trace = tracer.toTrace();
      const targetStep = trace.mergeSteps.find((s) => s.clientId === 2);
      expect(targetStep).toBeDefined();
      expect(targetStep!.rejection).toEqual({
        reason: RejectionReason.POST_MERGE_CONSISTENCY,
        issues: [
          {
            kind: 'DUPLICATE_PLAYER_DEATH',
            player: 'player1',
            ticks: [2, 5],
          },
        ],
      });
      expect(targetStep!.counters).toEqual({
        playerAttacks: 0,
        playerSpells: 0,
        npcAttacks: 0,
        streamEventPairs: 0,
        attackMappedEvents: 0,
      });

      // Both clients are accurate, so this is a full confidence identity merge.
      expect(targetStep!.confidence).toEqual({
        overall: 1,
        structural: {
          value: 1,
          identity: true,
          targetCoverage: 1,
          segments: [],
          worstSegmentIdx: null,
        },
        content: {
          value: 1,
          disagreementRate: 0,
          largeGapRate: 0,
          attackMappedFailureRate: 0,
        },
      });

      expect(result!.alerts).toContainEqual({
        type: MergeAlertType.POST_MERGE_CONSISTENCY_REJECTIONS,
        details: {
          rejectedClientIds: [2],
          totalIssues: 1,
        },
      });

      const rejectedClient = result!.clients.find((c) => c.id === 2)!;
      expect(rejectedClient.rejectionReason).toBe(
        RejectionReason.POST_MERGE_CONSISTENCY,
      );
    });
  });
});

describe('MergedEvents', () => {
  it('round-trips events and metadata through serialize/deserialize', () => {
    const client1 = ClientEvents.fromRawEvents(
      1,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.COMPLETED,
        accurate: true,
        recordedTicks: 2,
        serverTicks: { count: 2, precise: true },
      },
      client1Events,
    );
    const result = new Merger(fakeChallenge, Stage.TOB_MAIDEN, [
      client1,
    ]).merge();
    expect(result).not.toBeNull();
    const original = result!.events;

    const restored = MergedEvents.deserialize(original.serialize());

    expect(restored.getStatus()).toBe(original.getStatus());
    expect(restored.getLastTick()).toBe(original.getLastTick());
    expect(restored.getMissingTickCount()).toBe(original.getMissingTickCount());
    expect(restored.hasPreciseServerTickCount()).toBe(
      original.hasPreciseServerTickCount(),
    );
    expect(restored.accurateUntil()).toBe(original.accurateUntil());
    expect(restored.queryableUntil()).toBe(original.queryableUntil());
    expect(restored.fullyAccurate()).toBe(original.fullyAccurate());
    expect(restored.fullyQueryable()).toBe(original.fullyQueryable());

    expect(Array.from(restored).map((e) => e.toObject())).toEqual(
      Array.from(original).map((e) => e.toObject()),
    );

    for (let tick = 0; tick <= original.getLastTick(); tick++) {
      expect(restored.eventsForTick(tick).map((e) => e.toObject())).toEqual(
        original.eventsForTick(tick).map((e) => e.toObject()),
      );
    }
  });

  it('restricts accuracy and queryability to the given tick', () => {
    const client1 = ClientEvents.fromRawEvents(
      1,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.COMPLETED,
        accurate: true,
        recordedTicks: 2,
        serverTicks: {
          count: 2,
          precise: true,
        },
      },
      client1Events,
    );
    const merger = new Merger(fakeChallenge, Stage.TOB_MAIDEN, [client1]);
    const result = merger.merge();
    expect(result).not.toBeNull();

    const events = result!.events;
    expect(events.accurateUntil()).toBe(3);
    expect(events.queryableUntil()).toBe(3);
    expect(events.fullyAccurate()).toBe(true);
    expect(events.fullyQueryable()).toBe(true);

    events.restrictAccuracyTo(1);
    expect(events.accurateUntil()).toBe(1);
    expect(events.queryableUntil()).toBe(1);
    expect(events.fullyAccurate()).toBe(false);
    expect(events.fullyQueryable()).toBe(false);
  });
});

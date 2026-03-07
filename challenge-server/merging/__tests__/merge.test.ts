import {
  ChallengeStatus,
  ChallengeType,
  DataSource,
  EventType,
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
import {
  Merger,
  MergeAlertType,
  MergeClientClassification,
  MergeClientStatus,
  MergeOptions,
} from '../merge';

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
  },
): ProtoEvent[] {
  const startTick = opts?.startTick ?? 0;
  const primary = opts?.primaryPlayer ?? 'player1';
  const realTickOffset = opts?.realTickOffset ?? 0;
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
        yCoord: 0,
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
        yCoord: 0,
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
      offCooldownTick: 0,
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
];

const fakeChallenge = {
  id: 99,
  uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeffffff',
  type: ChallengeType.TOB,
  status: ChallengeStatus.WIPED,
  stage: Stage.TOB_SOTETSEG,
  party: ['player1', 'player2'],
};

describe('Merger', () => {
  it('fails when there are no clients to merge', () => {
    const merger = new Merger(Stage.TOB_MAIDEN, []);
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
    const merger = new Merger(Stage.TOB_MAIDEN, [client1]);
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
    expect(events.isAccurate()).toBe(false);
    expect(events.getMissingTickCount()).toBe(0);
    const allEvents = Array.from(events);
    expect(allEvents.length).toBe(4);

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
    const merger = new Merger(Stage.TOB_MAIDEN, [client1]);
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
    expect(events.isAccurate()).toBe(true);
    expect(events.hasPreciseServerTickCount()).toBe(true);
    expect(events.getMissingTickCount()).toBe(0);
    const allEvents = Array.from(events);
    expect(allEvents.length).toBe(4);

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

    const merger = new Merger(Stage.TOB_MAIDEN, [
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
    const merger = new Merger(Stage.TOB_MAIDEN, [client1]);
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
    expect(events.isAccurate()).toBe(false);
    expect(events.getMissingTickCount()).toBe(MISSING_TICKS);
    const allEvents = Array.from(events);
    expect(allEvents.length).toBe(4);

    expect(allEvents.map((e) => e.toObject())).toEqual(
      client1Events.map((e) => {
        const obj = e.toObject();
        obj.tick += MISSING_TICKS;
        if (obj.player) {
          obj.player.offCooldownTick += MISSING_TICKS;
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

    const merger = new Merger(Stage.TOB_MAIDEN, [client1]);

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

    const merger = new Merger(Stage.TOB_MAIDEN, [base, target]);
    const result = merger.merge(undefined, ALIGN_OPTIONS);

    expect(result).not.toBeNull();
    expect(result!.mergedCount).toBe(2);
    expect(result!.unmergedCount).toBe(0);

    const targetClient = result!.clients.find((c) => c.id === 2);
    expect(targetClient).toBeDefined();
    expect(targetClient!.status).toBe(MergeClientStatus.MERGED);
    expect(targetClient!.classification).toBe(
      MergeClientClassification.MISMATCHED,
    );

    // After merge, player2 should have PRIMARY data (contributed by target).
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

    const merger = new Merger(Stage.TOB_MAIDEN, [base, target]);
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
    const merger = new Merger(Stage.TOB_MAIDEN, [base, target]);
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

    // No options — default behavior.
    const merger = new Merger(Stage.TOB_MAIDEN, [base, target]);
    const result = merger.merge();

    expect(result).not.toBeNull();
    expect(result!.mergedCount).toBe(1);
    expect(result!.unmergedCount).toBe(1);

    const targetClient = result!.clients.find((c) => c.id === 2);
    expect(targetClient!.status).toBe(MergeClientStatus.UNMERGED);
  });
});

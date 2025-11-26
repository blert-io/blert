import {
  ChallengeStatus,
  ChallengeType,
  DataSource,
  EventType,
  MergedEvent,
  SkillLevel,
  Stage,
  StageStatus,
} from '@blert/common';
import {
  Event as ProtoEvent,
  StageMap,
} from '@blert/common/generated/event_pb';

import {
  Merger,
  classifyClients,
  MergeClientClassification,
  MergeClientStatus,
} from '../merge';
import { ClientEvents } from '../client-events';

type Proto<T> = T[keyof T];

function createEvent(
  event: Partial<MergedEvent> & { stage: Stage },
): ProtoEvent {
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

  return evt;
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

describe('classifyClients', () => {
  function createClient(
    id: number,
    accurate: boolean,
    recordedTicks: number,
    serverTicks: { count: number; precise: boolean } | null,
  ) {
    return ClientEvents.fromRawEvents(
      id,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.WIPED,
        accurate,
        recordedTicks,
        serverTicks,
      },
      [],
    );
  }

  it('picks a single client as the base', () => {
    const client = createClient(1, true, 10, { count: 10, precise: true });
    const { base, matching, mismatched, referenceTicks } = classifyClients([
      client,
    ]);
    expect(referenceTicks).toBe(10);
    expect(base).toBe(client);
    expect(matching).toEqual([]);
    expect(mismatched).toEqual([]);
  });

  it('uses an accurate client if present', () => {
    const acc1 = createClient(1, true, 10, { count: 10, precise: true });
    const acc2 = createClient(2, true, 10, { count: 10, precise: true });
    const other = createClient(3, false, 9, { count: 9, precise: false });
    const { base, matching, mismatched, referenceTicks } = classifyClients([
      acc1,
      acc2,
      other,
    ]);
    expect(referenceTicks).toBe(10);
    expect(base).toBe(acc1);
    expect(matching).toEqual([acc2]);
    expect(mismatched).toEqual([other]);
  });

  it('breaks ties with lowest client ID', () => {
    const acc1 = createClient(1, true, 10, { count: 10, precise: true });
    const acc2 = createClient(2, true, 10, { count: 10, precise: true });
    const acc3 = createClient(3, true, 10, { count: 10, precise: true });

    let { base } = classifyClients([acc2, acc1, acc3]);
    expect(base).toBe(acc1);

    ({ base } = classifyClients([acc3, acc2]));
    expect(base).toBe(acc2);
  });

  it('chooses the highest tick count in a multi-modal scenario', () => {
    const acc1 = createClient(1, true, 100, { count: 100, precise: true });
    const acc2 = createClient(2, true, 100, { count: 100, precise: true });
    const acc3 = createClient(3, true, 101, { count: 101, precise: true });
    const acc4 = createClient(4, true, 101, { count: 101, precise: true });
    const acc5 = createClient(5, true, 99, { count: 99, precise: true });

    const { base, matching, mismatched, referenceTicks } = classifyClients([
      acc1,
      acc2,
      acc3,
      acc4,
      acc5,
    ]);
    expect(referenceTicks).toBe(101);
    expect(base).toBe(acc3);
    expect(matching).toEqual([acc4]);
    expect(mismatched).toEqual(expect.arrayContaining([acc1, acc2, acc5]));
  });

  it('prefers a precise client if no accurate client is available', () => {
    const precise1 = createClient(1, false, 11, { count: 12, precise: true });
    const precise2 = createClient(2, false, 10, { count: 10, precise: true });
    const { base, matching, mismatched, referenceTicks } = classifyClients([
      precise1,
      precise2,
    ]);

    expect(referenceTicks).toBe(12);
    expect(base).toBe(precise1);
    expect(matching).toEqual([]);
    expect(mismatched).toEqual([precise2]);
  });

  it('prefers an imprecise client if no precise client is available', () => {
    const imprecise1 = createClient(1, false, 11, {
      count: 12,
      precise: false,
    });
    const imprecise2 = createClient(2, false, 10, {
      count: 10,
      precise: false,
    });
    const { base, matching, mismatched, referenceTicks } = classifyClients([
      imprecise1,
      imprecise2,
    ]);

    expect(referenceTicks).toBe(12);
    expect(base).toBe(imprecise1);
    expect(matching).toEqual([]);
    expect(mismatched).toEqual([imprecise2]);
  });

  it('uses highest recorded ticks if no client has server ticks', () => {
    const client1 = createClient(1, false, 11, null);
    const client2 = createClient(2, false, 10, null);
    const { base, matching, mismatched, referenceTicks } = classifyClients([
      client1,
      client2,
    ]);

    expect(referenceTicks).toBe(11);
    expect(base).toBe(client1);
    expect(matching).toEqual([]);
    expect(mismatched).toEqual([client2]);
  });

  it('prefers the larger modal tick when tied', () => {
    const acc1 = createClient(1, true, 10, { count: 10, precise: true });
    const acc2 = createClient(2, true, 11, { count: 11, precise: true });
    const other = createClient(3, false, 11, { count: 11, precise: false });
    const { base, matching, mismatched, referenceTicks } = classifyClients([
      acc1,
      acc2,
      other,
    ]);
    expect(referenceTicks).toBe(11);
    expect(base).toBe(acc2);
    expect(matching).toEqual([]);
    expect(mismatched).toEqual(expect.arrayContaining([other, acc1]));
  });

  it('falls back to server tick consensus when no accurate clients are present', () => {
    const server1 = createClient(1, false, 11, { count: 11, precise: false });
    const server2 = createClient(2, false, 9, { count: 9, precise: false });
    const server3 = createClient(3, false, 11, { count: 11, precise: false });
    const other = createClient(4, false, 11, null);
    const { base, matching, mismatched, referenceTicks } = classifyClients([
      server1,
      server3,
      other,
      server2,
    ]);
    expect(referenceTicks).toBe(11);
    expect(base).toBe(server1);
    expect(matching).toEqual([]);
    expect(mismatched).toEqual(
      expect.arrayContaining([server3, other, server2]),
    );
  });

  it('handles a server tick count of 0', () => {
    const client1 = createClient(1, false, 0, { count: 0, precise: true });
    const client2 = createClient(2, false, 10, null);
    const { base, referenceTicks } = classifyClients([client1, client2]);
    expect(referenceTicks).toBe(0);
    expect(base).toBe(client1);
  });
});

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

    const events = result!.events;
    expect(events.isAccurate()).toBe(true);
    expect(events.getMissingTickCount()).toBe(0);
    const allEvents = Array.from(events);
    expect(allEvents.length).toBe(4);

    expect(allEvents.map((e) => e.toObject())).toEqual(
      client1Events.map((e) => e.toObject()),
    );
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
});

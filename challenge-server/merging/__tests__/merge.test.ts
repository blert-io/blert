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

import { ReferenceSelectionMethod } from '../classification';
import { ClientEvents } from '../client-events';
import {
  Merger,
  MergeAlertType,
  MergeClientClassification,
  MergeClientStatus,
} from '../merge';

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
});

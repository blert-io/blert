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

import { Merger } from '../merge';
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

  if (event.stageUpdate) {
    const stageUpdate = new ProtoEvent.StageUpdate();
    stageUpdate.setStatus(
      event.stageUpdate.status as Proto<ProtoEvent.StageUpdate.StatusMap>,
    );
    stageUpdate.setAccurate(event.stageUpdate.accurate ?? false);
    if (event.stageUpdate.inGameTicks !== undefined) {
      stageUpdate.setInGameTicks(event.stageUpdate.inGameTicks);
    }
    evt.setStageUpdate(stageUpdate);
  }

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

const client1Inaccurate = [
  ...client1Events,
  createEvent({
    type: EventType.STAGE_UPDATE,
    tick: 2,
    stage: Stage.TOB_MAIDEN,
    stageUpdate: {
      status: StageStatus.WIPED,
      accurate: false,
    },
  }),
];

const client1Accurate = [
  ...client1Events,
  createEvent({
    type: EventType.STAGE_UPDATE,
    tick: 2,
    stage: Stage.TOB_MAIDEN,
    stageUpdate: {
      status: StageStatus.COMPLETED,
      accurate: true,
    },
  }),
];

describe('Merger', () => {
  const fakeChallenge = {
    id: 99,
    uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeffffff',
    type: ChallengeType.TOB,
    status: ChallengeStatus.WIPED,
    stage: Stage.TOB_SOTETSEG,
    party: ['player1', 'player2'],
  };

  it('fails when there are no clients to merge', () => {
    const merger = new Merger(fakeChallenge, Stage.TOB_MAIDEN, []);
    expect(merger.merge()).toBeNull();
  });

  it("uses a single inaccurate client's events directly", () => {
    const client1 = ClientEvents.fromRawEvents(
      1,
      fakeChallenge,
      Stage.TOB_MAIDEN,
      client1Inaccurate,
    );
    const merger = new Merger(fakeChallenge, Stage.TOB_MAIDEN, [client1]);
    const result = merger.merge();

    expect(result).not.toBeNull();
    expect(result!.mergedClients).toEqual([client1]);
    expect(result!.unmergedClients).toEqual([]);

    const events = result!.events;
    expect(events.missingTicks()).toBe(0);
    const allEvents = Array.from(events);
    expect(allEvents.length).toBe(6);

    const [startEvent, ...otherEvents] = allEvents;
    expect(startEvent.toObject()).toMatchObject({
      type: EventType.STAGE_UPDATE,
      tick: 0,
      stage: Stage.TOB_MAIDEN,
      stageUpdate: { status: StageStatus.STARTED },
    });

    expect(otherEvents.map((e) => e.toObject())).toEqual(
      client1Inaccurate.map((e) => e.toObject()),
    );
  });

  it("uses a single accurate client's events directly", () => {
    const client1 = ClientEvents.fromRawEvents(
      1,
      fakeChallenge,
      Stage.TOB_MAIDEN,
      client1Accurate,
    );
    const merger = new Merger(fakeChallenge, Stage.TOB_MAIDEN, [client1]);
    const result = merger.merge();

    expect(result).not.toBeNull();
    expect(result!.mergedClients).toEqual([client1]);
    expect(result!.unmergedClients).toEqual([]);

    const events = result!.events;
    expect(events.missingTicks()).toBe(0);
    const allEvents = Array.from(events);
    expect(allEvents.length).toBe(6);

    const [startEvent, ...otherEvents] = allEvents;
    expect(startEvent.toObject()).toMatchObject({
      type: EventType.STAGE_UPDATE,
      tick: 0,
      stage: Stage.TOB_MAIDEN,
      stageUpdate: { status: StageStatus.STARTED },
    });

    expect(otherEvents.map((e) => e.toObject())).toEqual(
      client1Accurate.map((e) => e.toObject()),
    );
  });

  it('offsets ticks for an inaccurate client with a reported stage update', () => {
    const MISSING_TICKS = 8;

    const eventsWithLaterStageUpdate = [...client1Events];
    eventsWithLaterStageUpdate.push(
      createEvent({
        type: EventType.STAGE_UPDATE,
        tick: 2,
        stage: Stage.TOB_MAIDEN,
        stageUpdate: {
          status: StageStatus.WIPED,
          accurate: false,
          inGameTicks: 2 + MISSING_TICKS,
        },
      }),
    );

    const client1 = ClientEvents.fromRawEvents(
      1,
      fakeChallenge,
      Stage.TOB_MAIDEN,
      eventsWithLaterStageUpdate,
    );
    const merger = new Merger(fakeChallenge, Stage.TOB_MAIDEN, [client1]);
    const result = merger.merge();

    expect(result).not.toBeNull();
    expect(result!.mergedClients).toEqual([client1]);
    expect(result!.unmergedClients).toEqual([]);

    const events = result!.events;
    expect(events.missingTicks()).toBe(MISSING_TICKS);
    const allEvents = Array.from(events);
    expect(allEvents.length).toBe(6);

    const [startEvent, ...otherEvents] = allEvents;
    expect(startEvent.toObject()).toMatchObject({
      type: EventType.STAGE_UPDATE,
      tick: 0,
      stage: Stage.TOB_MAIDEN,
      stageUpdate: { status: StageStatus.STARTED },
    });

    expect(otherEvents.map((e) => e.toObject())).toEqual(
      client1Inaccurate.map((e) => {
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

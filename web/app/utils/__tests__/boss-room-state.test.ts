/**
 * @jest-environment jsdom
 */
import {
  Challenge,
  DataSource,
  EventType,
  NpcUpdateEvent,
  PlayerUpdateEvent,
  PrayerSet,
  RoomNpcType,
  SkillLevel,
  Stage,
} from '@blert/common';
import { renderHook } from '@testing-library/react';

import { NpcEntity, ObjectEntity } from '@/components/map-renderer';
import {
  buildEventMaps,
  computeNpcState,
  computePlayerState,
  useMapEntities,
} from '@/utils/boss-room-state';

describe('useMapEntities', () => {
  it('builds players with their subsequent state', () => {
    const challenge = {
      party: [{ username: '715' }, { username: '1Ogp' }],
    } as unknown as Challenge;
    const events: PlayerUpdateEvent[] = [
      {
        tick: 140,
        type: EventType.PLAYER_UPDATE as const,
        stage: Stage.TFA_EZEKIEL,
        xCoord: 4065,
        yCoord: 5538,
        player: {
          source: DataSource.SECONDARY,
          name: '715',
          offCooldownTick: 0,
          prayerSet: 0,
        },
      },
      {
        tick: 140,
        type: EventType.PLAYER_UPDATE as const,
        stage: Stage.TFA_EZEKIEL,
        xCoord: 4061,
        yCoord: 5537,
        player: {
          source: DataSource.PRIMARY,
          name: '1Ogp',
          offCooldownTick: 0,
          prayerSet: 0,
          hitpoints: 5767267,
        },
      },
      {
        tick: 141,
        type: EventType.PLAYER_UPDATE as const,
        stage: Stage.TFA_EZEKIEL,
        xCoord: 4064,
        yCoord: 5537,
        player: {
          source: DataSource.SECONDARY,
          name: '715',
          offCooldownTick: 0,
          prayerSet: 0,
        },
      },
      {
        tick: 141,
        type: EventType.PLAYER_UPDATE as const,
        stage: Stage.TFA_EZEKIEL,
        xCoord: 4062,
        yCoord: 5537,
        player: {
          source: DataSource.PRIMARY,
          name: '1Ogp',
          offCooldownTick: 0,
          prayerSet: 0,
          hitpoints: 6094947,
        },
      },
    ];
    const [eventsByTick, eventsByType] = buildEventMaps(events);
    const playerState = computePlayerState(
      ['715', '1Ogp'],
      142,
      eventsByTick,
      eventsByType,
    );

    const { result } = renderHook(() =>
      useMapEntities(challenge, playerState, new Map(), 142),
    );

    expect([140, 141].map((tick) => result.current(tick))).toMatchObject([
      [
        {
          name: '715',
          orb: 0,
          position: { x: 4065, y: 5538 },
          nextPosition: { x: 4064, y: 5537 },
          hitpoints: null,
        },
        {
          name: '1Ogp',
          orb: 1,
          position: { x: 4061, y: 5537 },
          nextPosition: { x: 4062, y: 5537 },
          hitpoints: {
            current: new SkillLevel(88, 99),
            next: new SkillLevel(93, 99),
          },
        },
      ],
      [
        {
          name: '715',
          orb: 0,
          position: { x: 4064, y: 5537 },
          nextPosition: undefined,
          hitpoints: null,
        },
        {
          name: '1Ogp',
          orb: 1,
          position: { x: 4062, y: 5537 },
          nextPosition: undefined,
          hitpoints: { current: new SkillLevel(93, 99), next: undefined },
        },
      ],
    ]);
  });

  it('builds NPCs with their subsequent state', () => {
    const challenge = { party: [] } as unknown as Challenge;
    const events: NpcUpdateEvent[] = [
      {
        tick: 8,
        type: EventType.NPC_UPDATE as const,
        stage: Stage.MOKHAIOTL_DELVE_2,
        xCoord: 3421,
        yCoord: 6435,
        npc: { roomId: 56656, id: 14707, hitpoints: 31392294, prayers: 0 },
      },
      {
        tick: 8,
        type: EventType.NPC_UPDATE as const,
        stage: Stage.MOKHAIOTL_DELVE_2,
        xCoord: 3425,
        yCoord: 6430,
        npc: { roomId: 56698, id: 14710, hitpoints: 131074, prayers: 262144 },
      },
      {
        tick: 9,
        type: EventType.NPC_UPDATE as const,
        stage: Stage.MOKHAIOTL_DELVE_2,
        xCoord: 3421,
        yCoord: 6435,
        npc: { roomId: 56656, id: 14707, hitpoints: 28574246, prayers: 0 },
      },
      {
        tick: 9,
        type: EventType.NPC_UPDATE as const,
        stage: Stage.MOKHAIOTL_DELVE_2,
        xCoord: 3425,
        yCoord: 6431,
        npc: { roomId: 56698, id: 14710, hitpoints: 131074, prayers: 262144 },
      },
    ];
    const [eventsByTick, eventsByType] = buildEventMaps(events);
    const npcState = computeNpcState(
      {
        56656: {
          roomId: 56656,
          spawnNpcId: 14707,
          spawnTick: 0,
          spawnPoint: { x: 3421, y: 6435 },
          dyingTick: 0,
          deathTick: 0,
          deathPoint: { x: 0, y: 0 },
          type: RoomNpcType.BASIC,
        },
        56698: {
          roomId: 56698,
          spawnNpcId: 14710,
          spawnTick: 6,
          spawnPoint: { x: 3425, y: 6429 },
          dyingTick: 20,
          deathTick: 22,
          deathPoint: { x: 3425, y: 6435 },
          type: RoomNpcType.BASIC,
        },
      },
      10,
      eventsByTick,
      eventsByType,
    );

    const { result } = renderHook(() =>
      useMapEntities(challenge, new Map(), npcState, 10),
    );

    expect([8, 9].map((tick) => result.current(tick))).toMatchObject([
      [
        {
          id: 14707,
          roomId: 56656,
          position: { x: 3421, y: 6435 },
          nextPosition: { x: 3421, y: 6435 },
          hitpoints: {
            current: new SkillLevel(479, 550),
            next: new SkillLevel(436, 550),
          },
          prayers: PrayerSet.fromRaw(0),
          shield: null,
        },
        {
          id: 14710,
          roomId: 56698,
          position: { x: 3425, y: 6430 },
          nextPosition: { x: 3425, y: 6431 },
          hitpoints: {
            current: new SkillLevel(2, 2),
            next: new SkillLevel(2, 2),
          },
          prayers: PrayerSet.fromRaw(262144),
          shield: null,
        },
      ],
      [
        {
          id: 14707,
          roomId: 56656,
          position: { x: 3421, y: 6435 },
          nextPosition: undefined,
          hitpoints: { current: new SkillLevel(436, 550), next: undefined },
          prayers: PrayerSet.fromRaw(0),
          shield: null,
        },
        {
          id: 14710,
          roomId: 56698,
          position: { x: 3425, y: 6431 },
          nextPosition: undefined,
          hitpoints: { current: new SkillLevel(2, 2), next: undefined },
          prayers: PrayerSet.fromRaw(262144),
          shield: null,
        },
      ],
    ]);
  });

  it('leaves out NPCs that are not rendered', () => {
    const challenge = { party: [] } as unknown as Challenge;
    const events: NpcUpdateEvent[] = [
      {
        tick: 224,
        type: EventType.NPC_UPDATE as const,
        stage: Stage.TFA_OCELLUS,
        xCoord: 4126,
        yCoord: 5672,
        npc: { roomId: 54691, id: 16675, hitpoints: 0, prayers: 0 },
      },
      {
        tick: 224,
        type: EventType.NPC_UPDATE as const,
        stage: Stage.TFA_OCELLUS,
        xCoord: 4126,
        yCoord: 5672,
        npc: { roomId: 64035, id: 16676, hitpoints: 0, prayers: 0 },
      },
    ];
    const [eventsByTick, eventsByType] = buildEventMaps(events);
    const npcState = computeNpcState(
      {
        54691: {
          roomId: 54691,
          spawnNpcId: 16674,
          spawnTick: 0,
          spawnPoint: { x: 4126, y: 5669 },
          dyingTick: 0,
          deathTick: 0,
          deathPoint: { x: 0, y: 0 },
          type: RoomNpcType.BASIC,
        },
        64035: {
          roomId: 64035,
          spawnNpcId: 16676,
          spawnTick: 223,
          spawnPoint: { x: 4126, y: 5672 },
          dyingTick: 0,
          deathTick: 0,
          deathPoint: { x: 0, y: 0 },
          type: RoomNpcType.BASIC,
        },
      },
      225,
      eventsByTick,
      eventsByType,
    );

    const { result } = renderHook(() =>
      useMapEntities(challenge, new Map(), npcState, 225),
    );

    expect(result.current(224)).toMatchObject([
      { id: 16675, roomId: 54691, position: { x: 4126, y: 5672 } },
    ]);
  });

  it('returns nothing for a tick beyond the end of the stage', () => {
    const challenge = { party: [{ username: '1Ogp' }] } as unknown as Challenge;
    const rock = new ObjectEntity(
      { x: 3423, y: 6433 },
      '/images/objects/mokhaiotl-rock.png',
      'Rock',
      1,
      '#958442',
    );

    const { result } = renderHook(() =>
      useMapEntities(challenge, new Map(), new Map(), 80, {
        customEntitiesForTick: () => [rock],
      }),
    );

    expect([34, 80].map((tick) => result.current(tick))).toEqual([[rock], []]);
  });

  it('applies modifyEntity to each NPC and appends from customEntitiesForTick', () => {
    const challenge = { party: [{ username: '1Ogp' }] } as unknown as Challenge;
    const events: (PlayerUpdateEvent | NpcUpdateEvent)[] = [
      {
        tick: 34,
        type: EventType.PLAYER_UPDATE as const,
        stage: Stage.MOKHAIOTL_DELVE_2,
        xCoord: 3422,
        yCoord: 6433,
        player: {
          source: DataSource.PRIMARY,
          name: '1Ogp',
          offCooldownTick: 0,
          prayerSet: 0,
          hitpoints: 5832803,
        },
      },
      {
        tick: 34,
        type: EventType.NPC_UPDATE as const,
        stage: Stage.MOKHAIOTL_DELVE_2,
        xCoord: 3421,
        yCoord: 6435,
        npc: { roomId: 56656, id: 14707, hitpoints: 19792422, prayers: 0 },
      },
    ];
    const [eventsByTick, eventsByType] = buildEventMaps(events);
    const playerState = computePlayerState(
      ['1Ogp'],
      80,
      eventsByTick,
      eventsByType,
    );
    const npcState = computeNpcState(
      {
        56656: {
          roomId: 56656,
          spawnNpcId: 14707,
          spawnTick: 0,
          spawnPoint: { x: 3421, y: 6435 },
          dyingTick: 0,
          deathTick: 0,
          deathPoint: { x: 0, y: 0 },
          type: RoomNpcType.BASIC,
        },
      },
      80,
      eventsByTick,
      eventsByType,
    );
    const rock = new ObjectEntity(
      { x: 3423, y: 6433 },
      '/images/objects/mokhaiotl-rock.png',
      'Rock',
      1,
      '#958442',
    );

    const { result } = renderHook(() =>
      useMapEntities(challenge, playerState, npcState, 80, {
        customEntitiesForTick: () => [rock],
        modifyEntity: (tick, entity) => {
          if (entity instanceof NpcEntity) {
            entity.label = `${tick}`;
          }
          return entity;
        },
      }),
    );

    expect(result.current(34)).toMatchObject([
      { name: '1Ogp', position: { x: 3422, y: 6433 } },
      { roomId: 56656, label: '34' },
      rock,
    ]);
  });

  it('sets shields from NPC properties', () => {
    const challenge = { party: [] } as unknown as Challenge;
    const events: NpcUpdateEvent[] = [
      {
        tick: 63,
        type: EventType.NPC_UPDATE as const,
        stage: Stage.MOKHAIOTL_DELVE_8,
        xCoord: 3549,
        yCoord: 6435,
        npc: {
          roomId: 46703,
          id: 14708,
          hitpoints: 33096355,
          prayers: 0,
          mokhaiotl: { charging: false, shield: 26214900 },
        },
      },
      {
        tick: 64,
        type: EventType.NPC_UPDATE as const,
        stage: Stage.MOKHAIOTL_DELVE_8,
        xCoord: 3549,
        yCoord: 6435,
        npc: {
          roomId: 46703,
          id: 14708,
          hitpoints: 33096355,
          prayers: 0,
          mokhaiotl: { charging: false, shield: 23003636 },
        },
      },
    ];
    const [eventsByTick, eventsByType] = buildEventMaps(events);
    const npcState = computeNpcState(
      {
        46703: {
          roomId: 46703,
          spawnNpcId: 14707,
          spawnTick: 0,
          spawnPoint: { x: 3549, y: 6435 },
          dyingTick: 0,
          deathTick: 0,
          deathPoint: { x: 0, y: 0 },
          type: RoomNpcType.BASIC,
        },
      },
      65,
      eventsByTick,
      eventsByType,
    );

    const { result } = renderHook(() =>
      useMapEntities(challenge, new Map(), npcState, 65),
    );

    expect([63, 64].map((tick) => result.current(tick))).toMatchObject([
      [
        {
          roomId: 46703,
          shield: {
            current: new SkillLevel(400, 500),
            next: new SkillLevel(351, 500),
          },
        },
      ],
      [
        {
          roomId: 46703,
          shield: { current: new SkillLevel(351, 500), next: undefined },
        },
      ],
    ]);
  });
});

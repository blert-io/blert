import {
  AttackStyle,
  Event,
  EventType,
  NpcAttack,
  NpcAttackEvent,
} from '@blert/common';

import { EventMapBuilder, buildEventMaps } from '../event-maps';

function makeEvent(tick: number, type: EventType): Event {
  return { tick, type, stage: 0, xCoord: 0, yCoord: 0 } as Event;
}

describe('buildEventMaps', () => {
  it('returns empty maps for empty events', () => {
    const [byTick, byType] = buildEventMaps([]);
    expect(byTick).toEqual({});
    expect(byType).toEqual({});
  });

  it('groups events by tick', () => {
    const events = [
      makeEvent(0, EventType.PLAYER_UPDATE),
      makeEvent(0, EventType.NPC_SPAWN),
      makeEvent(1, EventType.PLAYER_UPDATE),
    ];
    const [byTick] = buildEventMaps(events);
    expect(byTick[0]).toHaveLength(2);
    expect(byTick[1]).toHaveLength(1);
  });

  it('groups events by type', () => {
    const events = [
      makeEvent(0, EventType.PLAYER_UPDATE),
      makeEvent(1, EventType.PLAYER_UPDATE),
      makeEvent(0, EventType.NPC_SPAWN),
    ];
    const [, byType] = buildEventMaps(events);
    expect(byType[EventType.PLAYER_UPDATE]).toHaveLength(2);
    expect(byType[EventType.NPC_SPAWN]).toHaveLength(1);
  });
});

describe('EventMapBuilder', () => {
  it('matches full build when appending in chunks', () => {
    const events = [
      makeEvent(0, EventType.PLAYER_UPDATE),
      makeEvent(0, EventType.NPC_SPAWN),
      makeEvent(1, EventType.PLAYER_UPDATE),
      makeEvent(2, EventType.NPC_DEATH),
      makeEvent(2, EventType.PLAYER_ATTACK),
    ];

    const [fullByTick, fullByType] = buildEventMaps(events);

    const builder = new EventMapBuilder();
    builder.append(events.slice(0, 2));
    builder.append(events.slice(2, 4));
    builder.append(events.slice(4));

    expect(builder.eventsByTick).toEqual(fullByTick);
    expect(builder.eventsByType).toEqual(fullByType);
  });

  it('resets to empty state', () => {
    const builder = new EventMapBuilder();
    builder.append([makeEvent(0, EventType.PLAYER_UPDATE)]);
    expect(Object.keys(builder.eventsByTick)).toHaveLength(1);

    builder.clear();
    expect(builder.eventsByTick).toEqual({});
    expect(builder.eventsByType).toEqual({});
  });

  it('builds fresh maps after clear', () => {
    const builder = new EventMapBuilder();
    builder.append([makeEvent(0, EventType.PLAYER_UPDATE)]);
    builder.clear();
    builder.append([makeEvent(5, EventType.NPC_SPAWN)]);

    expect(builder.eventsByTick[0]).toBeUndefined();
    expect(builder.eventsByTick[5]).toHaveLength(1);
  });
});

function npcAttackEvent(tick: number, attack: NpcAttack): NpcAttackEvent {
  return {
    tick,
    type: EventType.NPC_ATTACK,
    stage: 0,
    xCoord: 0,
    yCoord: 0,
    npc: { id: 1, roomId: 1 },
    npcAttack: { attack },
  } as NpcAttackEvent;
}

describe('EventMapBuilder cross-referencing', () => {
  it('resolves verzik P3 attack style to melee', () => {
    const builder = new EventMapBuilder();
    const attack = npcAttackEvent(10, NpcAttack.TOB_VERZIK_P3_AUTO);
    builder.append([attack]);
    builder.append([
      {
        ...makeEvent(11, EventType.TOB_VERZIK_ATTACK_STYLE),
        verzikAttack: { style: AttackStyle.MELEE, npcAttackTick: 10 },
      } as Event,
    ]);

    expect(attack.npcAttack.attack).toBe(NpcAttack.TOB_VERZIK_P3_MELEE);
    expect(
      builder.eventsByType[EventType.TOB_VERZIK_ATTACK_STYLE],
    ).toBeUndefined();
  });

  it('resolves verzik bounce target', () => {
    const builder = new EventMapBuilder();
    const attack = npcAttackEvent(10, NpcAttack.TOB_VERZIK_P2_BOUNCE);
    builder.append([attack]);
    builder.append([
      {
        ...makeEvent(11, EventType.TOB_VERZIK_BOUNCE),
        verzikBounce: {
          npcAttackTick: 10,
          playersInRange: 1,
          playersNotInRange: 3,
          bouncedPlayer: 'Player1',
        },
      } as Event,
    ]);

    expect(attack.npcAttack.target).toBe('Player1');
    // Bounce events are kept in the maps.
    expect(builder.eventsByType[EventType.TOB_VERZIK_BOUNCE]).toHaveLength(1);
  });

  it('resolves mokhaiotl auto attack style to ranged', () => {
    const builder = new EventMapBuilder();
    const attack = npcAttackEvent(5, NpcAttack.MOKHAIOTL_AUTO);
    builder.append([attack]);
    builder.append([
      {
        ...makeEvent(6, EventType.MOKHAIOTL_ATTACK_STYLE),
        mokhaiotlAttackStyle: { style: AttackStyle.RANGE, npcAttackTick: 5 },
      } as Event,
    ]);

    expect(attack.npcAttack.attack).toBe(NpcAttack.MOKHAIOTL_RANGED_AUTO);
    expect(
      builder.eventsByType[EventType.MOKHAIOTL_ATTACK_STYLE],
    ).toBeUndefined();
  });

  it('resolves mokhaiotl ball attack style to mage ball', () => {
    const builder = new EventMapBuilder();
    const attack = npcAttackEvent(5, NpcAttack.MOKHAIOTL_BALL);
    builder.append([attack]);
    builder.append([
      {
        ...makeEvent(6, EventType.MOKHAIOTL_ATTACK_STYLE),
        mokhaiotlAttackStyle: { style: AttackStyle.MAGE, npcAttackTick: 5 },
      } as Event,
    ]);

    expect(attack.npcAttack.attack).toBe(NpcAttack.MOKHAIOTL_MAGE_BALL);
  });
});

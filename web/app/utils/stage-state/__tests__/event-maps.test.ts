import { Event, EventType } from '@blert/common';

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

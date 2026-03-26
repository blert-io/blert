import { Event, EventType, RoomNpcType } from '@blert/common';

import { NpcMapBuilder, buildNpcMapFromEvents } from '../npc-map';

function spawnEvent(roomId: number, npcId: number, tick: number): Event {
  return {
    tick,
    type: EventType.NPC_SPAWN,
    stage: 0,
    xCoord: 10 + roomId,
    yCoord: 20 + roomId,
    npc: { roomId, id: npcId, hitpoints: 0, prayers: 0 },
  } as Event;
}

function deathEvent(roomId: number, tick: number): Event {
  return {
    tick,
    type: EventType.NPC_DEATH,
    stage: 0,
    xCoord: 30 + roomId,
    yCoord: 40 + roomId,
    npc: { roomId, id: 0, hitpoints: 0, prayers: 0 },
  } as Event;
}

describe('buildNpcMapFromEvents', () => {
  it('returns empty map for no events', () => {
    expect(buildNpcMapFromEvents([])).toEqual({});
  });

  it('creates entry on NPC_SPAWN', () => {
    const map = buildNpcMapFromEvents([spawnEvent(1, 100, 5)]);
    expect(map[1]).toEqual({
      roomId: 1,
      spawnNpcId: 100,
      spawnTick: 5,
      spawnPoint: { x: 11, y: 21 },
      deathTick: 0,
      deathPoint: { x: 0, y: 0 },
      type: RoomNpcType.BASIC,
    });
  });

  it('updates entry on NPC_DEATH', () => {
    const map = buildNpcMapFromEvents([
      spawnEvent(1, 100, 5),
      deathEvent(1, 10),
    ]);
    expect(map[1].deathTick).toBe(10);
    expect(map[1].deathPoint).toEqual({ x: 31, y: 41 });
  });

  it('ignores NPC_DEATH for unknown roomId', () => {
    const map = buildNpcMapFromEvents([deathEvent(99, 10)]);
    expect(map[99]).toBeUndefined();
  });
});

describe('NpcMapBuilder', () => {
  it('matches full build when appending in chunks', () => {
    const events = [
      spawnEvent(1, 100, 0),
      spawnEvent(2, 200, 1),
      deathEvent(1, 5),
      spawnEvent(3, 300, 6),
      deathEvent(2, 8),
    ];

    const full = buildNpcMapFromEvents(events);

    const builder = new NpcMapBuilder();
    builder.append(events.slice(0, 2));
    builder.append(events.slice(2, 4));
    builder.append(events.slice(4));

    expect(builder.npcMap).toEqual(full);
  });

  it('resets to empty state on clear', () => {
    const builder = new NpcMapBuilder();
    builder.append([spawnEvent(1, 100, 0)]);
    expect(Object.keys(builder.npcMap)).toHaveLength(1);

    builder.clear();
    expect(builder.npcMap).toEqual({});
  });
});

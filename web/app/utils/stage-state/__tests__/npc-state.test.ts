import {
  Event,
  EventType,
  NpcAttack,
  NpcAttackEvent,
  NpcUpdateEvent,
  RoomNpc,
  RoomNpcMap as RawRoomNpcMap,
  RoomNpcType,
  SkillLevel,
} from '@blert/common';

import { buildEventMaps } from '../event-maps';
import { NpcStateBuilder, computeNpcState } from '../npc-state';

function makeNpc(
  roomId: number,
  npcId: number,
  spawnTick: number,
  deathTick = 0,
): RoomNpc {
  return {
    roomId,
    spawnNpcId: npcId,
    spawnTick,
    spawnPoint: { x: 0, y: 0 },
    deathTick,
    deathPoint: { x: 0, y: 0 },
    type: RoomNpcType.BASIC,
  };
}

function npcUpdate(
  roomId: number,
  npcId: number,
  tick: number,
  hp = 100,
): NpcUpdateEvent {
  return {
    tick,
    type: EventType.NPC_UPDATE as const,
    stage: 0,
    xCoord: tick,
    yCoord: tick + 1,
    npc: {
      roomId,
      id: npcId,
      hitpoints: new SkillLevel(hp, hp).toRaw(),
      prayers: 0,
    },
  };
}

function npcAttack(
  roomId: number,
  npcId: number,
  tick: number,
  attack: NpcAttack = NpcAttack.TOB_MAIDEN_AUTO,
): NpcAttackEvent {
  return {
    tick,
    type: EventType.NPC_ATTACK as const,
    stage: 0,
    xCoord: tick,
    yCoord: tick + 1,
    npc: { roomId, id: npcId },
    npcAttack: { attack },
  };
}

function toNpcMap(...npcs: RoomNpc[]): RawRoomNpcMap {
  const map: RawRoomNpcMap = {};
  for (const npc of npcs) {
    map[npc.roomId] = npc;
  }
  return map;
}

describe('computeNpcState', () => {
  it('returns empty map for empty npcMap', () => {
    const result = computeNpcState({}, 10, {}, {});
    expect(result.size).toBe(0);
  });

  it('creates null-filled state arrays when no events exist', () => {
    const npcMap = toNpcMap(makeNpc(1, 100, 0));
    const result = computeNpcState(npcMap, 5, {}, {});
    const npc = result.get(1)!;

    expect(npc.stateByTick).toHaveLength(5);
    expect(npc.stateByTick.every((s) => s === null)).toBe(true);
  });

  it('builds state from NPC update events', () => {
    const npcMap = toNpcMap(makeNpc(1, 100, 0));
    const events: Event[] = [
      npcUpdate(1, 100, 1, 90),
      npcUpdate(1, 100, 3, 50),
    ];
    const [byTick, byType] = buildEventMaps(events);
    const result = computeNpcState(npcMap, 5, byTick, byType);
    const npc = result.get(1)!;

    expect(npc.stateByTick[0]).toBeNull();
    expect(npc.stateByTick[1]).not.toBeNull();
    expect(npc.stateByTick[1]!.hitpoints.getCurrent()).toBe(90);
    expect(npc.stateByTick[2]).toBeNull();
    expect(npc.stateByTick[3]!.hitpoints.getCurrent()).toBe(50);
  });

  it('tracks NPC attacks', () => {
    const npcMap = toNpcMap(makeNpc(1, 100, 0));
    const events: Event[] = [npcUpdate(1, 100, 0), npcAttack(1, 100, 2)];
    const [byTick, byType] = buildEventMaps(events);
    const result = computeNpcState(npcMap, 4, byTick, byType);
    const npc = result.get(1)!;

    expect(npc.relevant).toBe(true);
    expect(npc.stateByTick[2]!.attack).not.toBeNull();
    expect(npc.stateByTick[2]!.attack!.attack).toBe(NpcAttack.TOB_MAIDEN_AUTO);
  });

  it('handles multiple NPCs independently', () => {
    const npcMap = toNpcMap(makeNpc(1, 100, 0), makeNpc(2, 200, 0));
    const events: Event[] = [npcUpdate(1, 100, 0), npcUpdate(2, 200, 1)];
    const [byTick, byType] = buildEventMaps(events);
    const result = computeNpcState(npcMap, 3, byTick, byType);

    expect(result.get(1)!.stateByTick[0]).not.toBeNull();
    expect(result.get(1)!.stateByTick[1]).toBeNull();
    expect(result.get(2)!.stateByTick[0]).toBeNull();
    expect(result.get(2)!.stateByTick[1]).not.toBeNull();
  });
});

describe('NpcStateBuilder', () => {
  it('matches full build when appending in chunks', () => {
    const npcMap = toNpcMap(makeNpc(1, 100, 0), makeNpc(2, 200, 0));
    const events: Event[] = [
      npcUpdate(1, 100, 0),
      npcUpdate(2, 200, 1),
      npcUpdate(1, 100, 2, 80),
      npcAttack(1, 100, 3),
      npcUpdate(2, 200, 4, 60),
    ];
    const [byTick, byType] = buildEventMaps(events);
    const totalTicks = 6;

    const full = computeNpcState(npcMap, totalTicks, byTick, byType);

    const builder = new NpcStateBuilder();
    builder.extend(npcMap, 2, byTick, byType);
    builder.extend(npcMap, 4, byTick, byType);
    builder.extend(npcMap, totalTicks, byTick, byType);

    for (const [roomId, fullNpc] of full) {
      const incNpc = builder.state.get(roomId)!;
      expect(incNpc.stateByTick).toHaveLength(fullNpc.stateByTick.length);
      expect(incNpc.relevant).toBe(fullNpc.relevant);

      for (let tick = 0; tick < totalTicks; tick++) {
        const fullState = fullNpc.stateByTick[tick];
        const incState = incNpc.stateByTick[tick];

        if (fullState === null) {
          expect(incState).toBeNull();
        } else {
          expect(incState).not.toBeNull();
          expect(incState!.hitpoints.getCurrent()).toBe(
            fullState.hitpoints.getCurrent(),
          );
          expect(incState!.position).toEqual(fullState.position);
          if (fullState.attack === null) {
            expect(incState!.attack).toBeNull();
          } else {
            expect(incState!.attack!.attack).toBe(fullState.attack.attack);
          }
        }
      }
    }
  });

  it('handles new NPCs appearing mid-fight', () => {
    const npcMap1 = toNpcMap(makeNpc(1, 100, 0));
    const events: Event[] = [
      npcUpdate(1, 100, 0),
      npcUpdate(1, 100, 1),
      npcUpdate(2, 200, 2),
      npcUpdate(1, 100, 3),
      npcUpdate(2, 200, 3),
    ];
    const [byTick, byType] = buildEventMaps(events);

    const builder = new NpcStateBuilder();
    builder.extend(npcMap1, 2, byTick, byType);
    expect(builder.state.size).toBe(1);

    const npcMap2 = toNpcMap(makeNpc(1, 100, 0), makeNpc(2, 200, 2));
    builder.extend(npcMap2, 5, byTick, byType);
    expect(builder.state.size).toBe(2);

    const npc2 = builder.state.get(2)!;
    expect(npc2.stateByTick[2]).not.toBeNull();
    expect(npc2.stateByTick[3]).not.toBeNull();
  });

  it('syncs death info from npcMap', () => {
    const npcMap = toNpcMap(makeNpc(1, 100, 0));
    const events: Event[] = [npcUpdate(1, 100, 0)];
    const [byTick, byType] = buildEventMaps(events);

    const builder = new NpcStateBuilder();
    builder.extend(npcMap, 3, byTick, byType);
    expect(builder.state.get(1)!.deathTick).toBe(0);

    const npcMapWithDeath = toNpcMap(makeNpc(1, 100, 0, 5));
    builder.extend(npcMapWithDeath, 6, byTick, byType);
    expect(builder.state.get(1)!.deathTick).toBe(5);
  });

  it('resets all state on clear', () => {
    const npcMap = toNpcMap(makeNpc(1, 100, 0));
    const events: Event[] = [npcUpdate(1, 100, 0)];
    const [byTick, byType] = buildEventMaps(events);

    const builder = new NpcStateBuilder();
    builder.extend(npcMap, 2, byTick, byType);
    expect(builder.state.size).toBe(1);

    builder.clear();
    expect(builder.state.size).toBe(0);
  });
});

import {
  Coords,
  Event,
  EventType,
  RoomNpcMap as RawRoomNpcMap,
  RoomNpcType,
} from '@blert/common';

const ZERO_COORDS: Coords = { x: 0, y: 0 };

/**
 * Incrementally builds a `RawRoomNpcMap` from NPC_SPAWN and NPC_DEATH events.
 */
export class NpcMapBuilder {
  private map: RawRoomNpcMap = {};

  get npcMap(): Readonly<RawRoomNpcMap> {
    return this.map;
  }

  /**
   * Processes events, updating the NPC map for any spawn or death events.
   */
  append(events: Event[]): void {
    for (const event of events) {
      if (event.type === EventType.NPC_SPAWN) {
        this.map[event.npc.roomId] = {
          roomId: event.npc.roomId,
          spawnNpcId: event.npc.id,
          spawnTick: event.tick,
          spawnPoint: { x: event.xCoord, y: event.yCoord },
          deathTick: 0,
          deathPoint: ZERO_COORDS,
          type: RoomNpcType.BASIC,
        };
      } else if (event.type === EventType.NPC_DEATH) {
        const npc = this.map[event.npc.roomId];
        if (npc !== undefined) {
          npc.deathTick = event.tick;
          npc.deathPoint = { x: event.xCoord, y: event.yCoord };
        }
      }
    }
  }

  clear(): void {
    this.map = {};
  }
}

/**
 * Builds a `RawRoomNpcMap` from NPC_SPAWN and NPC_DEATH events.
 */
export function buildNpcMapFromEvents(events: Event[]): RawRoomNpcMap {
  const builder = new NpcMapBuilder();
  builder.append(events);
  return builder.npcMap;
}

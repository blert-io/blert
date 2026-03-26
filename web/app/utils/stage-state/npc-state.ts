import {
  Event,
  EventType,
  Npc,
  NpcAttack,
  NpcAttackEvent,
  NpcEvent,
  NpcId,
  NpcSpawnEvent,
  PrayerSet,
  RoomNpcMap as RawRoomNpcMap,
  SkillLevel,
  getNpcDefinition,
  isNpcEvent,
} from '@blert/common';

import {
  EnhancedRoomNpc,
  EventTickMap,
  EventTypeMap,
  NpcState,
  Nullable,
  RoomNpcMap,
} from './types';

export type NpcCursor = {
  lastActiveTick: number;
};

const BLOAT_DOWN_TICKS = 32;

/**
 * Processes a single tick for an NPC, building its state from events.
 */
function processNpcTick(
  roomId: number,
  tick: number,
  npc: EnhancedRoomNpc,
  cursor: NpcCursor,
  eventsForThisTick: Event[] | undefined,
): void {
  if (eventsForThisTick === undefined) {
    return;
  }

  const eventsForThisNpc = eventsForThisTick
    .filter<NpcEvent>(isNpcEvent)
    .filter((event) => event.npc.roomId === roomId);

  if (eventsForThisNpc.length > 0) {
    npc.stateByTick[tick] = {
      id: eventsForThisNpc[0].npc.id,
      attack: null,
      position: {
        x: eventsForThisNpc[0].xCoord,
        y: eventsForThisNpc[0].yCoord,
      },
      hitpoints: SkillLevel.fromRaw(eventsForThisNpc[0].npc.hitpoints),
      prayers: PrayerSet.fromRaw(eventsForThisNpc[0].npc.prayers),
    };
    cursor.lastActiveTick = tick;
  }

  const attackEvent = eventsForThisTick.find(
    (e): e is NpcAttackEvent =>
      e.type === EventType.NPC_ATTACK && e.npc.roomId === roomId,
  );

  if (attackEvent !== undefined) {
    if (npc.stateByTick[tick] === null) {
      const hitpoints =
        cursor.lastActiveTick !== -1
          ? npc.stateByTick[cursor.lastActiveTick]!.hitpoints
          : new SkillLevel(0, 1);
      const prayers =
        cursor.lastActiveTick !== -1
          ? npc.stateByTick[cursor.lastActiveTick]!.prayers
          : PrayerSet.fromRaw(0);
      npc.stateByTick[tick] = {
        id: attackEvent.npc.id,
        attack: null,
        position: {
          x: eventsForThisNpc[0]?.xCoord ?? 0,
          y: eventsForThisNpc[0]?.yCoord ?? 0,
        },
        hitpoints,
        prayers,
      };
    }

    npc.relevant = true;
    npc.stateByTick[tick].attack = {
      type: attackEvent.npcAttack.attack,
      target: attackEvent.npcAttack.target ?? null,
    };
  }
}

function postprocessNpc(
  npc: EnhancedRoomNpc,
  eventsByType: EventTypeMap,
  fromTick: number,
): void {
  if (Npc.isBloat(npc.spawnNpcId)) {
    eventsByType[EventType.TOB_BLOAT_DOWN]?.forEach((event) => {
      // A bloat down event's label range can extend up to BLOAT_DOWN_TICKS
      // ticks forward. Process events whose range overlaps the new tick range.
      if (event.tick + BLOAT_DOWN_TICKS < fromTick) {
        return;
      }
      const startTick = Math.max(event.tick, fromTick);
      const lastDownTick = Math.min(
        event.tick + BLOAT_DOWN_TICKS,
        npc.stateByTick.length - 1,
      );
      for (let i = startTick; i <= lastDownTick; i++) {
        if (npc.stateByTick[i] !== null) {
          const downTick = BLOAT_DOWN_TICKS - (i - event.tick);
          npc.stateByTick[i]!.label = downTick.toString();
          npc.relevant = true;
        }
      }
    });
    return;
  }

  if (npc.spawnNpcId === (NpcId.JAL_ZEK as number)) {
    for (let tick = fromTick; tick < npc.stateByTick.length; tick++) {
      const attack = npc.stateByTick[tick]?.attack;
      if (!attack) {
        continue;
      }
      if (attack.type === NpcAttack.INFERNO_MAGER_RESURRECT) {
        const target = (
          eventsByType[EventType.NPC_SPAWN] as NpcSpawnEvent[]
        )?.find((event) => {
          const npcSpawn = event.npc;
          return !Npc.isBloblet(npcSpawn.id) && event.tick === tick;
        });
        if (target) {
          attack.target = getNpcDefinition(target.npc.id)?.fullName ?? null;
        }
      }
    }
  }
}

/**
 * Incrementally builds NPC state arrays, extending by new ticks on each
 * call to `extend`.
 */
export class NpcStateBuilder {
  private map: RoomNpcMap = new Map();
  private cursors = new Map<number, NpcCursor>();
  private processedTicks = 0;

  get state(): RoomNpcMap {
    return this.map;
  }

  /**
   * Extends NPC state arrays to `totalTicks`. New NPCs in `npcMap` that
   * aren't yet tracked are initialized and processed from tick 0.
   */
  extend(
    npcMap: RawRoomNpcMap,
    totalTicks: number,
    eventsByTick: EventTickMap,
    eventsByType: EventTypeMap,
  ): void {
    const fromTick = this.processedTicks;

    for (const [roomIdStr, roomNpc] of Object.entries(npcMap)) {
      const roomId = Number(roomIdStr);

      let npc = this.map.get(roomId);
      let cursor = this.cursors.get(roomId);
      let npcFromTick = fromTick;

      if (npc === undefined) {
        npc = {
          ...roomNpc,
          stateByTick: Array<Nullable<NpcState>>(totalTicks).fill(null),
          relevant: false,
        };
        cursor = { lastActiveTick: -1 };
        this.map.set(roomId, npc);
        this.cursors.set(roomId, cursor);
        npcFromTick = 0;
      } else {
        if (npc.stateByTick.length < totalTicks) {
          const oldLength = npc.stateByTick.length;
          npc.stateByTick.length = totalTicks;
          npc.stateByTick.fill(null, oldLength);
        }
        npc.deathTick = roomNpc.deathTick;
        npc.deathPoint = roomNpc.deathPoint;
      }

      for (let tick = npcFromTick; tick < totalTicks; tick++) {
        processNpcTick(roomId, tick, npc, cursor!, eventsByTick[tick]);
      }

      postprocessNpc(npc, eventsByType, npcFromTick);
    }

    this.processedTicks = totalTicks;
  }

  clear(): void {
    this.map = new Map();
    this.cursors = new Map();
    this.processedTicks = 0;
  }
}

/**
 * Builds NPC state maps for all ticks in a stage.
 */
export function computeNpcState(
  npcMap: RawRoomNpcMap,
  totalTicks: number,
  eventsByTick: EventTickMap,
  eventsByType: EventTypeMap,
): RoomNpcMap {
  const builder = new NpcStateBuilder();
  builder.extend(npcMap, totalTicks, eventsByTick, eventsByType);
  return builder.state;
}

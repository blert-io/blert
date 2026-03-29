import {
  AttackStyle,
  Event,
  EventType,
  NpcAttack,
  NpcAttackEvent,
} from '@blert/common';

import { EventTickMap, EventTypeMap } from './types';

/**
 * Finds the NPC_ATTACK event at the given tick matching the predicate.
 */
function findNpcAttack(
  eventsByTick: EventTickMap,
  tick: number,
  predicate: (attack: NpcAttack) => boolean,
): NpcAttackEvent | undefined {
  const tickEvents = eventsByTick[tick];
  if (tickEvents === undefined) {
    return undefined;
  }
  return tickEvents.find(
    (e) => e.type === EventType.NPC_ATTACK && predicate(e.npcAttack.attack),
  ) as NpcAttackEvent | undefined;
}

/**
 * Incrementally accumulates events into tick-indexed and type-indexed maps,
 * handling events that mutate past events.
 */
export class EventMapBuilder {
  private byTick: EventTickMap = {};
  private byType: EventTypeMap = {};

  get eventsByTick(): Readonly<EventTickMap> {
    return this.byTick;
  }

  get eventsByType(): Readonly<EventTypeMap> {
    return this.byType;
  }

  /**
   * Appends events to the accumulated maps.
   */
  append(events: Event[]): void {
    for (const event of events) {
      if (this.crossReference(event)) {
        continue;
      }

      this.byTick[event.tick] ??= [];
      this.byTick[event.tick].push(event);

      this.byType[event.type] ??= [];
      this.byType[event.type].push(event);
    }
  }

  /**
   * Attempts to cross-reference an event against a previously accumulated one.
   * @returns `true` if the event was consumed.
   */
  private crossReference(event: Event): boolean {
    switch (event.type) {
      case EventType.TOB_VERZIK_ATTACK_STYLE: {
        const { style, npcAttackTick } = event.verzikAttack;
        const attack = findNpcAttack(
          this.byTick,
          npcAttackTick,
          (a) => a === NpcAttack.TOB_VERZIK_P3_AUTO,
        );
        if (attack !== undefined) {
          switch (style) {
            case AttackStyle.MELEE:
              attack.npcAttack.attack = NpcAttack.TOB_VERZIK_P3_MELEE;
              break;
            case AttackStyle.RANGE:
              attack.npcAttack.attack = NpcAttack.TOB_VERZIK_P3_RANGE;
              break;
            case AttackStyle.MAGE:
              attack.npcAttack.attack = NpcAttack.TOB_VERZIK_P3_MAGE;
              break;
          }
        }
        return true;
      }

      case EventType.TOB_VERZIK_BOUNCE: {
        const { npcAttackTick, bouncedPlayer } = event.verzikBounce;
        if (npcAttackTick !== -1 && bouncedPlayer !== undefined) {
          const attack = findNpcAttack(
            this.byTick,
            npcAttackTick,
            (a) => a === NpcAttack.TOB_VERZIK_P2_BOUNCE,
          );
          if (attack !== undefined) {
            attack.npcAttack.target = bouncedPlayer;
          }
        }
        return false;
      }

      case EventType.MOKHAIOTL_ATTACK_STYLE: {
        const { style, npcAttackTick } = event.mokhaiotlAttackStyle;
        const attack = findNpcAttack(
          this.byTick,
          npcAttackTick,
          (a) =>
            a === NpcAttack.MOKHAIOTL_AUTO || a === NpcAttack.MOKHAIOTL_BALL,
        );
        if (attack !== undefined) {
          if (attack.npcAttack.attack === NpcAttack.MOKHAIOTL_BALL) {
            if (style === AttackStyle.RANGE) {
              attack.npcAttack.attack = NpcAttack.MOKHAIOTL_RANGED_BALL;
            } else if (style === AttackStyle.MAGE) {
              attack.npcAttack.attack = NpcAttack.MOKHAIOTL_MAGE_BALL;
            }
          } else {
            if (style === AttackStyle.MELEE) {
              attack.npcAttack.attack = NpcAttack.MOKHAIOTL_MELEE_AUTO;
            } else if (style === AttackStyle.RANGE) {
              attack.npcAttack.attack = NpcAttack.MOKHAIOTL_RANGED_AUTO;
            } else if (style === AttackStyle.MAGE) {
              attack.npcAttack.attack = NpcAttack.MOKHAIOTL_MAGE_AUTO;
            }
          }
        }
        return true;
      }

      default:
        return false;
    }
  }

  clear(): void {
    this.byTick = {};
    this.byType = {};
  }
}

/**
 * Builds tick-indexed and type-indexed event maps from an event array.
 */
export function buildEventMaps(events: Event[]): [EventTickMap, EventTypeMap] {
  const builder = new EventMapBuilder();
  builder.append(events);
  return [builder.eventsByTick, builder.eventsByType];
}

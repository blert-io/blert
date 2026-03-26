import {
  DataSource,
  EquipmentSlot,
  Event,
  EventType,
  ItemDelta,
  RawItemDelta,
  Skill,
  SkillLevel,
  VerzikDawnEvent,
  VerzikHealEvent,
  isPlayerEvent,
} from '@blert/common';

import { simpleItemCache } from '../item-cache/simple';

import {
  EventTickMap,
  EventTypeMap,
  Nullable,
  PlayerEquipment,
  PlayerState,
  PlayerStateMap,
} from './types';

const EMPTY_EQUIPMENT: PlayerEquipment = {
  [EquipmentSlot.HEAD]: null,
  [EquipmentSlot.CAPE]: null,
  [EquipmentSlot.AMULET]: null,
  [EquipmentSlot.AMMO]: null,
  [EquipmentSlot.WEAPON]: null,
  [EquipmentSlot.TORSO]: null,
  [EquipmentSlot.SHIELD]: null,
  [EquipmentSlot.LEGS]: null,
  [EquipmentSlot.GLOVES]: null,
  [EquipmentSlot.BOOTS]: null,
  [EquipmentSlot.RING]: null,
  [EquipmentSlot.QUIVER]: null,
};

export type PlayerCursor = {
  isDead: boolean;
  lastActiveTick: number;
};

function eventBelongsToPlayer(event: Event, playerName: string): boolean {
  return isPlayerEvent(event) && event.player.name === playerName;
}

function applyItemDeltas(
  equipment: PlayerEquipment,
  rawDeltas: RawItemDelta[],
): void {
  for (const rawDelta of rawDeltas) {
    const delta = ItemDelta.fromRaw(rawDelta);
    const previousItem = equipment[delta.getSlot()];

    if (delta.isAdded()) {
      if (previousItem?.id !== delta.getItemId()) {
        const itemName = simpleItemCache.getItemName(delta.getItemId());
        equipment[delta.getSlot()] = {
          id: delta.getItemId(),
          name: itemName,
          quantity: delta.getQuantity(),
        };
      } else {
        equipment[delta.getSlot()] = {
          id: previousItem.id,
          name: previousItem.name,
          quantity: previousItem.quantity + delta.getQuantity(),
        };
      }
    } else {
      if (
        previousItem !== null &&
        previousItem.quantity - delta.getQuantity() > 0
      ) {
        equipment[delta.getSlot()] = {
          ...previousItem,
          quantity: previousItem.quantity - delta.getQuantity(),
        };
      } else {
        equipment[delta.getSlot()] = null;
      }
    }
  }
}

/**
 * Processes a single tick for a player, building their state from events.
 */
function processPlayerTick(
  partyMember: string,
  tick: number,
  state: Nullable<PlayerState>[],
  cursor: PlayerCursor,
  eventsForThisTick: Event[] | undefined,
): void {
  if (eventsForThisTick === undefined) {
    return;
  }

  const eventsForThisPlayer = eventsForThisTick.filter((event) =>
    eventBelongsToPlayer(event, partyMember),
  );
  let playerStateThisTick: PlayerState | null = null;

  if (eventsForThisPlayer.length > 0) {
    playerStateThisTick = {
      acc: true,
      xCoord: 0,
      yCoord: 0,
      tick,
      player: {
        source: DataSource.SECONDARY,
        name: partyMember,
        offCooldownTick: 0,
        prayerSet: 0,
      },
      diedThisTick: false,
      isDead: cursor.isDead,
      equipment:
        cursor.lastActiveTick !== -1
          ? { ...state[cursor.lastActiveTick]!.equipment }
          : { ...EMPTY_EQUIPMENT },
      skills: {},
      customState: [],
    };
    cursor.lastActiveTick = tick;

    eventsForThisPlayer.forEach((event) => {
      if (event.type === EventType.PLAYER_DEATH) {
        cursor.isDead = true;
        playerStateThisTick = {
          ...playerStateThisTick!,
          diedThisTick: true,
          isDead: true,
        };
      } else if (event.type === EventType.PLAYER_UPDATE) {
        const { type: _type, stage: _stage, ...rest } = event;

        if (rest.player.equipmentDeltas) {
          applyItemDeltas(
            playerStateThisTick!.equipment,
            rest.player.equipmentDeltas,
          );
        }

        if (rest.player.attack !== undefined) {
          playerStateThisTick!.skills[Skill.ATTACK] = SkillLevel.fromRaw(
            rest.player.attack,
          );
        }
        if (rest.player.defence !== undefined) {
          playerStateThisTick!.skills[Skill.DEFENCE] = SkillLevel.fromRaw(
            rest.player.defence,
          );
        }
        if (rest.player.strength !== undefined) {
          playerStateThisTick!.skills[Skill.STRENGTH] = SkillLevel.fromRaw(
            rest.player.strength,
          );
        }
        if (rest.player.hitpoints !== undefined) {
          playerStateThisTick!.skills[Skill.HITPOINTS] = SkillLevel.fromRaw(
            rest.player.hitpoints,
          );
        }
        if (rest.player.prayer !== undefined) {
          playerStateThisTick!.skills[Skill.PRAYER] = SkillLevel.fromRaw(
            rest.player.prayer,
          );
        }
        if (rest.player.ranged !== undefined) {
          playerStateThisTick!.skills[Skill.RANGED] = SkillLevel.fromRaw(
            rest.player.ranged,
          );
        }
        if (rest.player.magic !== undefined) {
          playerStateThisTick!.skills[Skill.MAGIC] = SkillLevel.fromRaw(
            rest.player.magic,
          );
        }

        playerStateThisTick = { ...playerStateThisTick!, ...rest };
      } else if (event.type === EventType.PLAYER_ATTACK) {
        const attack = event.attack;
        if (attack.weapon) {
          attack.weapon.name = simpleItemCache.getItemName(attack.weapon.id);
        }
        playerStateThisTick = {
          ...playerStateThisTick!,
          attack,
        };
      } else if (event.type === EventType.PLAYER_SPELL) {
        playerStateThisTick = {
          ...playerStateThisTick!,
          spell: event.spell,
        };
      }
    });
  } else if (cursor.isDead) {
    playerStateThisTick = {
      acc: true,
      xCoord: 0,
      yCoord: 0,
      tick,
      player: {
        source: DataSource.SECONDARY,
        name: partyMember,
        offCooldownTick: 0,
        prayerSet: 0,
      },
      diedThisTick: false,
      isDead: true,
      equipment: { ...EMPTY_EQUIPMENT },
      skills: {},
      customState: [],
    };
  }

  state[tick] = playerStateThisTick;
}

function postprocessPlayerState(
  partyMember: string,
  state: Nullable<PlayerState>[],
  eventsByType: EventTypeMap,
  fromTick: number,
): void {
  eventsByType[EventType.TOB_VERZIK_HEAL]?.forEach((event) => {
    if (event.tick < fromTick) {
      return;
    }
    const verzikHeal = (event as VerzikHealEvent).verzikHeal;
    const tickState = state[event.tick];
    if (tickState !== null && verzikHeal.player === partyMember) {
      tickState.customState.push({
        icon: '/images/npcs/8386.webp',
        label: verzikHeal.healAmount.toString(),
        fullText:
          verzikHeal.healAmount > 0
            ? `Healed Verzik for ${verzikHeal.healAmount}`
            : 'Healed Verzik',
      });
    }
  });

  eventsByType[EventType.TOB_VERZIK_DAWN]?.forEach((event) => {
    const dawn = (event as VerzikDawnEvent).verzikDawn;
    if (dawn.attackTick < fromTick) {
      return;
    }
    const tickState = state[dawn.attackTick];
    if (tickState !== null && dawn.player === partyMember) {
      if (tickState.attack !== undefined) {
        tickState.attack.damage = dawn.damage;
      }
      tickState.customState.push({
        label: dawn.damage.toString(),
        fullText: `Dawnbringer special attack hit for ${dawn.damage}`,
      });
    }
  });
}

/**
 * Incrementally builds player state arrays, extending by new ticks on each
 * call to `extend`.
 */
export class PlayerStateBuilder {
  private map: PlayerStateMap = new Map();
  private cursors = new Map<string, PlayerCursor>();
  private processedTicks = 0;

  get state(): PlayerStateMap {
    return this.map;
  }

  /**
   * Extends player state arrays to `totalTicks`, processing only ticks from
   * the previously processed point onward.
   *
   * @param party Party members for whom to extend player state.
   * @param totalTicks Total number of ticks to extend up to.
   * @param eventsByTick Event map indexed by tick.
   * @param eventsByType Event map indexed by type.
   */
  extend(
    party: string[],
    totalTicks: number,
    eventsByTick: EventTickMap,
    eventsByType: EventTypeMap,
  ): void {
    const fromTick = this.processedTicks;

    for (const partyMember of party) {
      let stateArray = this.map.get(partyMember);
      let cursor = this.cursors.get(partyMember);

      if (stateArray === undefined) {
        stateArray = Array<Nullable<PlayerState>>(totalTicks).fill(null);
        this.map.set(partyMember, stateArray);
      } else if (stateArray.length < totalTicks) {
        const oldLength = stateArray.length;
        stateArray.length = totalTicks;
        stateArray.fill(null, oldLength);
      }

      if (cursor === undefined) {
        cursor = { isDead: false, lastActiveTick: -1 };
        this.cursors.set(partyMember, cursor);
      }

      for (let tick = fromTick; tick < totalTicks; tick++) {
        processPlayerTick(
          partyMember,
          tick,
          stateArray,
          cursor,
          eventsByTick[tick],
        );
      }

      postprocessPlayerState(partyMember, stateArray, eventsByType, fromTick);
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
 * Builds player state maps for all ticks in a stage.
 *
 * @param party Party members for whom to build player state.
 * @param totalTicks Total number of ticks in the stage.
 * @param eventsByTick Event map indexed by tick.
 * @param eventsByType Event map indexed by type.
 * @returns Player state map for the stage.
 */
export function computePlayerState(
  party: string[],
  totalTicks: number,
  eventsByTick: EventTickMap,
  eventsByType: EventTypeMap,
): PlayerStateMap {
  const builder = new PlayerStateBuilder();
  builder.extend(party, totalTicks, eventsByTick, eventsByType);
  return builder.state;
}

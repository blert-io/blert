import { EquipmentSlot } from '@blert/common';

import { ItemCache, ItemData } from './cache';

export interface ExtendedItemData extends ItemData {
  equipable: boolean;
  stackable: boolean;
  tradeable: boolean;
  weight: number;
  slot?: EquipmentSlot;
  stats?: EquipmentStats;
}

export type EquipmentStats = {
  stabAttack: number;
  slashAttack: number;
  crushAttack: number;
  magicAttack: number;
  rangedAttack: number;
  stabDefence: number;
  slashDefence: number;
  crushDefence: number;
  magicDefence: number;
  rangedDefence: number;
  meleeStrength: number;
  rangedStrength: number;
  magicDamage: number;
  prayer: number;
  attackSpeed: number;
  twoHanded: boolean;
};

class ExtendedItemCache extends ItemCache<ExtendedItemData> {
  public getItem(id: number): ExtendedItemData | null {
    return this.cache.get(id) ?? null;
  }
}

import itemDump from '../../../resources/extended_items.json';

const defaultCache = new ExtendedItemCache();
defaultCache.populate(itemDump as ExtendedItemData[]);

export const extendedItemCache = defaultCache;

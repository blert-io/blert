import { ChallengeType } from '@blert/common';

export const MAX_LOCAL_SETUPS = 5;

export const NUM_EQUIPMENT_SLOTS = 11;
export const NUM_INVENTORY_SLOTS = 28;
export const NUM_POUCH_SLOTS = 4;

export type GearSetup = {
  title: string;
  description: string;
  challenge: ChallengeType;
  players: GearSetupPlayer[];
};

export type GearSetupPlayer = {
  name: string;
  inventory: PlayerInventory;
  equipment: PlayerEquipment;
  pouch: PlayerPouch;
  spellbook: Spellbook;
};

export type SlotContainer = {
  slots: ItemSlot[];
};

export type PlayerInventory = SlotContainer & {};

export type PlayerEquipment = SlotContainer & {};

export type PlayerPouch = SlotContainer & {};

export type ItemSlot = {
  index: number;
  item: SlotItem | null;
  comment: string | null;
};

export type SlotItem = {
  id: number;
  quantity: number;
};

export const enum Spellbook {
  STANDARD = 0,
  ANCIENT = 1,
  LUNAR = 2,
  ARCEUUS = 3,
}

export const enum Container {
  INVENTORY = 0,
  EQUIPMENT = 1,
  POUCH = 2,
}

type Containers = Pick<GearSetupPlayer, 'inventory' | 'equipment' | 'pouch'>;

export function getContainerKey(container: Container): keyof Containers {
  switch (container) {
    case Container.INVENTORY:
      return 'inventory';
    case Container.EQUIPMENT:
      return 'equipment';
    case Container.POUCH:
      return 'pouch';
  }
}

export function getContainer(
  player: GearSetupPlayer,
  container: Container,
): ItemSlot[] {
  switch (container) {
    case Container.INVENTORY:
      return player.inventory.slots;
    case Container.EQUIPMENT:
      return player.equipment.slots;
    case Container.POUCH:
      return player.pouch.slots;
  }
}

export const NEW_GEAR_SETUP: GearSetup = {
  title: 'Untitled setup',
  description: 'My new gear setup.',
  challenge: 0,
  players: [newGearSetupPlayer(1)],
};

export function newGearSetupPlayer(num: number): GearSetupPlayer {
  return {
    name: `Player ${num}`,
    inventory: { slots: [] },
    equipment: { slots: [] },
    pouch: { slots: [] },
    spellbook: Spellbook.STANDARD,
  };
}

export function hasAllItems(setup: GearSetup): boolean {
  return setup.players.every(
    (player) =>
      player.inventory.slots.length >= NUM_INVENTORY_SLOTS &&
      player.equipment.slots.length >= NUM_EQUIPMENT_SLOTS &&
      player.pouch.slots.length >= NUM_POUCH_SLOTS,
  );
}

export const QUIVER_SLOT_INDEX = 99;
export const QUIVER_IDS = [28955, 28902, 28951];

/**
 * Checks if the player has a Dizana's quiver equipped or in their inventory.
 */
export function hasQuiver(player: GearSetupPlayer): boolean {
  return (
    player.equipment.slots.some((slot) =>
      QUIVER_IDS.includes(slot.item?.id ?? 0),
    ) ||
    player.inventory.slots.some((slot) =>
      QUIVER_IDS.includes(slot.item?.id ?? 0),
    )
  );
}

export function spellbookName(spellbook: Spellbook): string {
  switch (spellbook) {
    case Spellbook.STANDARD:
      return 'Standard';
    case Spellbook.ANCIENT:
      return 'Ancient';
    case Spellbook.LUNAR:
      return 'Lunar';
    case Spellbook.ARCEUUS:
      return 'Arceuus';
  }
}

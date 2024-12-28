import { ChallengeType } from '@blert/common';

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

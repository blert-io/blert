import { EquipmentSlot } from '@blert/common';
import {
  GearSetup,
  GearSetupPlayer,
  NUM_EQUIPMENT_SLOTS,
  NUM_INVENTORY_SLOTS,
  NUM_POUCH_SLOTS,
  SlotContainer,
  Spellbook,
} from './setup';

/**
 * A format to which a gear setup can be translated.
 *
 * Can be one of:
 * - `inventory-setups`: JSON format used by the Inventory Setups plugin.
 */
export type ExportFormat = 'inventory-setups';

interface InventorySetupsItem {
  id: number;
  q?: number;
}

export type InventorySetupsData = {
  setup: {
    inv: (InventorySetupsItem | null)[];
    eq: (InventorySetupsItem | null)[];
    rp: (InventorySetupsItem | null)[];
    qv?: (InventorySetupsItem | null)[];
    name: string;
    hc: string;
    sb: number;
  };
  layout: (number | null)[];
};

// Map our equipment slot indices to Inventory Setups indices.
const BLERT_TO_INVENTORY_SETUPS_EQUIPMENT_SLOT: Record<EquipmentSlot, number> =
  {
    [EquipmentSlot.HEAD]: 0, // Head
    [EquipmentSlot.CAPE]: 1, // Cape
    [EquipmentSlot.AMULET]: 2, // Amulet
    [EquipmentSlot.WEAPON]: 3, // Weapon
    [EquipmentSlot.TORSO]: 4, // Body
    [EquipmentSlot.SHIELD]: 5, // Shield
    // Inventory setups slot 6 is always null
    [EquipmentSlot.LEGS]: 7, // Legs
    // Inventory setups slot 8 is always null
    [EquipmentSlot.GLOVES]: 9, // Gloves
    [EquipmentSlot.BOOTS]: 10, // Boots
    // Inventory setups slot 11 is always null
    [EquipmentSlot.RING]: 12, // Ring
    [EquipmentSlot.AMMO]: 13, // Ammo
  };

// Map Inventory Setups indices back to our equipment slots.
const INVENTORY_SETUPS_TO_BLERT_EQUIPMENT_SLOT: Record<number, EquipmentSlot> =
  {
    0: EquipmentSlot.HEAD,
    1: EquipmentSlot.CAPE,
    2: EquipmentSlot.AMULET,
    3: EquipmentSlot.WEAPON,
    4: EquipmentSlot.TORSO,
    5: EquipmentSlot.SHIELD,
    7: EquipmentSlot.LEGS,
    9: EquipmentSlot.GLOVES,
    10: EquipmentSlot.BOOTS,
    12: EquipmentSlot.RING,
    13: EquipmentSlot.AMMO,
  };

/**
 * Creates a bank layout in the "preset" style, where the left side has the
 * user's equipment in its standard view, and the right side has the user's
 * inventory in a 4x7 grid.
 *
 * @param inv Inventory slots.
 * @param eq Equipment slots.
 * @param rp Pouch slots.
 * @param qv Quiver slots.
 * @returns A layout array.
 */
function buildPresetLayout(
  inv: (InventorySetupsItem | null)[],
  eq: (InventorySetupsItem | null)[],
  rp: (InventorySetupsItem | null)[],
  qv: (InventorySetupsItem | null)[],
) {
  const layout: (number | null)[] = [];

  layout.push(-1);
  layout.push(eq[0]?.id ?? -1);
  layout.push(qv[0]?.id ?? -1);
  layout.push(-1);
  layout.push(inv[0]?.id ?? -1);
  layout.push(inv[1]?.id ?? -1);
  layout.push(inv[2]?.id ?? -1);
  layout.push(inv[3]?.id ?? -1);
  layout.push(eq[1]?.id ?? -1);
  layout.push(eq[2]?.id ?? -1);
  layout.push(eq[13]?.id ?? -1);
  layout.push(-1);
  layout.push(inv[4]?.id ?? -1);
  layout.push(inv[5]?.id ?? -1);
  layout.push(inv[6]?.id ?? -1);
  layout.push(inv[7]?.id ?? -1);
  layout.push(eq[3]?.id ?? -1);
  layout.push(eq[4]?.id ?? -1);
  layout.push(eq[5]?.id ?? -1);
  layout.push(-1);
  layout.push(inv[8]?.id ?? -1);
  layout.push(inv[9]?.id ?? -1);
  layout.push(inv[10]?.id ?? -1);
  layout.push(inv[11]?.id ?? -1);
  layout.push(-1);
  layout.push(eq[7]?.id ?? -1);
  layout.push(-1);
  layout.push(-1);
  layout.push(inv[12]?.id ?? -1);
  layout.push(inv[13]?.id ?? -1);
  layout.push(inv[14]?.id ?? -1);
  layout.push(inv[15]?.id ?? -1);
  layout.push(eq[9]?.id ?? -1);
  layout.push(eq[10]?.id ?? -1);
  layout.push(eq[12]?.id ?? -1);
  layout.push(-1);
  layout.push(inv[16]?.id ?? -1);
  layout.push(inv[17]?.id ?? -1);
  layout.push(inv[18]?.id ?? -1);
  layout.push(inv[19]?.id ?? -1);
  layout.push(rp[0]?.id ?? -1);
  layout.push(rp[1]?.id ?? -1);
  layout.push(rp[2]?.id ?? -1);
  layout.push(rp[3]?.id ?? -1);
  layout.push(inv[20]?.id ?? -1);
  layout.push(inv[21]?.id ?? -1);
  layout.push(inv[22]?.id ?? -1);
  layout.push(inv[23]?.id ?? -1);
  layout.push(-1);
  layout.push(-1);
  layout.push(-1);
  layout.push(-1);
  layout.push(inv[24]?.id ?? -1);
  layout.push(inv[25]?.id ?? -1);
  layout.push(inv[26]?.id ?? -1);
  layout.push(inv[27]?.id ?? -1);

  return layout;
}

const BLERT_TO_INVENTORY_SETUPS_SPELLBOOK: [Spellbook, number][] = [
  [Spellbook.STANDARD, 0],
  [Spellbook.ANCIENT, 1],
  [Spellbook.LUNAR, 2],
  [Spellbook.ARCEUUS, 3],
];

function spellbookToInventorySetups(spellbook: Spellbook): number {
  const index = BLERT_TO_INVENTORY_SETUPS_SPELLBOOK.findIndex(
    ([s, _]) => s === spellbook,
  );
  if (index === -1) {
    return 0;
  }
  return BLERT_TO_INVENTORY_SETUPS_SPELLBOOK[index][1];
}

function spellbookFromInventorySetups(spellbook: number): Spellbook {
  const index = BLERT_TO_INVENTORY_SETUPS_SPELLBOOK.findIndex(
    ([_, s]) => s === spellbook,
  );
  if (index === -1) {
    return Spellbook.STANDARD;
  }
  return BLERT_TO_INVENTORY_SETUPS_SPELLBOOK[index][0];
}

function exportPlayerToInventorySetups(
  player: GearSetupPlayer,
): InventorySetupsData {
  const inventory = new Array<InventorySetupsItem | null>(
    NUM_INVENTORY_SLOTS,
  ).fill(null);
  // Inventory setups has 3 always-null slots in its equipment array.
  const equipment = new Array<InventorySetupsItem | null>(
    NUM_EQUIPMENT_SLOTS + 3,
  ).fill(null);
  const pouch = new Array<InventorySetupsItem | null>(NUM_POUCH_SLOTS).fill(
    null,
  );
  const quiver: (InventorySetupsItem | null)[] = [];

  // Fill inventory slots
  for (const slot of player.inventory.slots) {
    if (slot.item) {
      inventory[slot.index] = {
        id: slot.item.id,
        ...(slot.item.quantity > 1 ? { q: slot.item.quantity } : {}),
      };
    }
  }

  // Fill equipment slots
  for (const slot of player.equipment.slots) {
    if (slot.item) {
      if (slot.index === 99) {
        // Quiver slot.
        quiver.push({
          id: slot.item.id,
          ...(slot.item.quantity > 1 ? { q: slot.item.quantity } : {}),
        });
      } else {
        const index = BLERT_TO_INVENTORY_SETUPS_EQUIPMENT_SLOT[slot.index];
        if (index !== undefined) {
          equipment[index] = {
            id: slot.item.id,
            ...(slot.item.quantity > 1 ? { q: slot.item.quantity } : {}),
          };
        }
      }
    }
  }

  for (const slot of player.pouch.slots) {
    if (slot.item) {
      pouch[slot.index] = {
        id: slot.item.id,
        ...(slot.item.quantity > 1 ? { q: slot.item.quantity } : {}),
      };
    }
  }

  const isEmptySetup =
    player.inventory.slots.length === 0 &&
    player.equipment.slots.length === 0 &&
    player.pouch.slots.length === 0;

  const layout = isEmptySetup
    ? []
    : buildPresetLayout(inventory, equipment, pouch, quiver);

  return {
    setup: {
      inv: inventory,
      eq: equipment,
      rp: pouch,
      name: player.name,
      hc: '#FFFF0000',
      sb: spellbookToInventorySetups(player.spellbook),
      ...(quiver.length > 0 ? { qv: quiver } : {}),
    },
    layout,
  };
}

export function importInventorySetups(
  setup: InventorySetupsData,
): GearSetupPlayer {
  const { inv, eq, rp, qv, name, sb } = setup.setup;

  const inventory: SlotContainer = { slots: [] };
  const equipment: SlotContainer = { slots: [] };
  const pouch: SlotContainer = { slots: [] };

  // Import inventory slots
  for (let i = 0; i < inv.length; i++) {
    const item = inv[i];
    if (item !== null) {
      inventory.slots.push({
        index: i,
        item: {
          id: item.id,
          quantity: 1,
          // TODO(frolv): Allow quantities in Blert setups.
          // quantity: item.q ?? 1,
        },
        comment: null,
      });
    }
  }

  // Import equipment slots
  for (let i = 0; i < eq.length; i++) {
    const item = eq[i];
    if (item !== null) {
      const blertSlot = INVENTORY_SETUPS_TO_BLERT_EQUIPMENT_SLOT[i];
      if (blertSlot !== undefined) {
        equipment.slots.push({
          index: blertSlot,
          item: {
            id: item.id,
            quantity: 1,
            // TODO(frolv): Allow quantities in Blert setups.
            // quantity: item.q ?? 1,
          },
          comment: null,
        });
      }
    }
  }

  // Import quiver slot if present
  if (qv && qv.length > 0 && qv[0] !== null) {
    equipment.slots.push({
      index: 99,
      item: {
        id: qv[0].id,
        quantity: 1,
        // TODO(frolv): Allow quantities in Blert setups.
        // quantity: qv[0].q ?? 1,
      },
      comment: null,
    });
  }

  // Import rune pouch slots
  for (let i = 0; i < rp.length; i++) {
    const item = rp[i];
    if (item !== null) {
      pouch.slots.push({
        index: i,
        item: {
          id: item.id,
          quantity: 1,
          // TODO(frolv): Allow quantities in Blert setups.
          // quantity: item.q ?? 1,
        },
        comment: null,
      });
    }
  }

  return {
    name: name ?? 'Imported Setup',
    spellbook: spellbookFromInventorySetups(sb),
    inventory,
    equipment,
    pouch,
  };
}

export class TranslateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranslateError';
  }
}

/**
 * Exports a player in a specified format.
 *
 * @param player The player to export.
 * @param format The format to which to export the player.
 * @returns The exported player.
 * @throws `TranslateError` if the format is unsupported.
 */
export function exportPlayer(
  player: GearSetupPlayer,
  format: ExportFormat,
): string {
  switch (format) {
    case 'inventory-setups':
      return JSON.stringify(exportPlayerToInventorySetups(player));
    default:
      throw new TranslateError(
        `Unsupported export format: ${format as string}`,
      );
  }
}

/**
 * Exports a setup for a specific player in a specified format.
 *
 * @param setup The setup to export.
 * @param playerIndex The index of the player to export.
 * @param format The format to which to export the setup.
 * @returns The exported setup.
 * @throws `TranslateError` if the player index is invalid or the format is
 * unsupported.
 */
export function exportSetup(
  setup: GearSetup,
  playerIndex: number,
  format: ExportFormat,
): string {
  if (playerIndex < 0 || playerIndex >= setup.players.length) {
    throw new TranslateError('Invalid player index');
  }

  return exportPlayer(setup.players[playerIndex], format);
}

/**
 * Imports a setup from a string, attempting to detect the format of the
 * setup data.
 *
 * @param data The string from which to import the setup.
 * @returns The imported setup.
 * @throws `TranslateError` if the setup data is invalid or unsupported.
 */
export function importSetup(data: string): GearSetupPlayer {
  if (data.length === 0) {
    throw new TranslateError('Empty setup data');
  }

  const parsed: unknown = JSON.parse(data);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new TranslateError('Invalid setup data');
  }

  // Attempt to detect the format of the setup data.
  const obj = parsed as Record<string, unknown>;
  if (obj.setup !== undefined) {
    const setup = obj.setup as Record<string, unknown>;
    if (setup.inv || setup.eq || setup.rp) {
      return importInventorySetups(parsed as InventorySetupsData);
    }
  }

  throw new TranslateError('Invalid or unsupported setup import format');
}

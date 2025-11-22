import { EquipmentSlot } from '@blert/common';

import {
  ExtendedItemData,
  extendedItemCache,
} from '@/utils/item-cache/extended';

import { SelectionRegion, SlotKey } from './editing-context';
import {
  Container,
  GearSetupPlayer,
  ItemSlot,
  NUM_INVENTORY_SLOTS,
  NUM_POUCH_SLOTS,
  QUIVER_IDS,
  QUIVER_SLOT_INDEX,
  SlotItem,
  getContainerKey,
  hasQuiver,
} from './setup';

const RUNE_ITEMS = [
  554, 555, 556, 557, 558, 562, 560, 565, 21880, 559, 564, 561, 563, 566, 9075,
  4694, 4695, 4696, 4697, 4698, 4699, 28929, 30843,
];

/**
 * Grid dimensions for each container type.
 */
const CONTAINER_DIMENSIONS = {
  [Container.INVENTORY]: { cols: 4, rows: 7 },
  [Container.EQUIPMENT]: { cols: 3, rows: 5 },
  [Container.POUCH]: { cols: 4, rows: 1 },
} as const;

/**
 * Rendered slot size in pixels.
 */
export const SLOT_SIZE_PX = 42;

/**
 * Identifier for a specific slot in the setup.
 */
export type SlotIdentifier = {
  playerIndex: number;
  container: Container;
  index: number;
};

export type SlotIdString = `slot-${number}-${Container}-${number}`;

/**
 * Converts a slot identifier to a string.
 * @param slotId The slot identifier to convert to a string.
 * @returns The string representation of the slot identifier.
 */
export function slotIdToString(slotId: SlotIdentifier): SlotIdString {
  return `slot-${slotId.playerIndex}-${slotId.container}-${slotId.index}`;
}

/**
 * Parses a slot identifier from a string.
 * @param id The string representation of the slot identifier.
 * @returns The slot identifier, or null if the string is not a valid slot
 *   identifier.
 */
export function slotIdFromString(id: string): SlotIdentifier | null {
  const parts = id.split('-');
  if (parts.length !== 4 || parts[0] !== 'slot') {
    return null;
  }
  const playerIndex = parseInt(parts[1]);
  const container = parseInt(parts[2]) as Container;
  const index = parseInt(parts[3]);
  if (isNaN(playerIndex) || isNaN(container) || isNaN(index)) {
    return null;
  }
  return { playerIndex, container, index };
}

/**
 * Equipment grid layout mapping grid positions to equipment slot indices.
 * null represents empty/invalid positions.
 */
const EQUIPMENT_GRID: (number | null)[][] = [
  [null, EquipmentSlot.HEAD, QUIVER_SLOT_INDEX],
  [EquipmentSlot.CAPE, EquipmentSlot.AMULET, EquipmentSlot.AMMO],
  [EquipmentSlot.WEAPON, EquipmentSlot.TORSO, EquipmentSlot.SHIELD],
  [null, EquipmentSlot.LEGS, null],
  [EquipmentSlot.GLOVES, EquipmentSlot.BOOTS, EquipmentSlot.RING],
] as const;

/**
 * Reverse mapping of equipment slot indices to grid coordinates.
 */
const EQUIPMENT_INDEX_TO_COORDS = new Map<number, [number, number]>();
for (let y = 0; y < EQUIPMENT_GRID.length; y++) {
  for (let x = 0; x < EQUIPMENT_GRID[y].length; x++) {
    const index = EQUIPMENT_GRID[y][x];
    if (index !== null) {
      EQUIPMENT_INDEX_TO_COORDS.set(index, [x, y]);
    }
  }
}

/**
 * Converts a slot index to grid coordinates (x, y).
 */
export function indexToCoords(
  index: number,
  container: Container,
): [number, number] | null {
  switch (container) {
    case Container.INVENTORY: {
      if (index < 0 || index >= NUM_INVENTORY_SLOTS) {
        return null;
      }
      const { cols } = CONTAINER_DIMENSIONS[Container.INVENTORY];
      return [index % cols, Math.floor(index / cols)];
    }

    case Container.EQUIPMENT: {
      return EQUIPMENT_INDEX_TO_COORDS.get(index) ?? null;
    }

    case Container.POUCH: {
      if (index < 0 || index >= NUM_POUCH_SLOTS) {
        return null;
      }
      return [index, 0];
    }
  }
}

/**
 * Converts grid coordinates (x, y) to a slot index.
 */
export function coordsToIndex(
  x: number,
  y: number,
  container: Container,
): number | null {
  switch (container) {
    case Container.INVENTORY: {
      const { cols, rows } = CONTAINER_DIMENSIONS[Container.INVENTORY];
      if (x < 0 || x >= cols || y < 0 || y >= rows) {
        return null;
      }
      return y * cols + x;
    }

    case Container.EQUIPMENT: {
      if (y < 0 || y >= EQUIPMENT_GRID.length) {
        return null;
      }
      if (x < 0 || x >= EQUIPMENT_GRID[y].length) {
        return null;
      }
      return EQUIPMENT_GRID[y][x];
    }

    case Container.POUCH: {
      const { cols } = CONTAINER_DIMENSIONS[Container.POUCH];
      if (x < 0 || x >= cols || y !== 0) {
        return null;
      }
      return x;
    }
  }
}

/**
 * Gets the dimensions (cols, rows) of a container.
 */
export function getContainerDimensions(container: Container): {
  cols: number;
  rows: number;
} {
  return CONTAINER_DIMENSIONS[container];
}

/**
 * Checks if a grid position is valid for a container.
 */
export function isValidGridPosition(
  x: number,
  y: number,
  container: Container,
): boolean {
  return coordsToIndex(x, y, container) !== null;
}

/**
 * Converts a DOM event within a container to grid coordinates.
 * @param event Mouse event
 * @param containerElement The DOM element of the container
 * @param container The container type
 * @returns Grid coordinates or null if outside the grid
 */
export function eventToGridCoords(
  event: React.MouseEvent,
  containerElement: HTMLElement,
  container: Container,
): [number, number] | null {
  const rect = containerElement.getBoundingClientRect();
  const { cols, rows } = getContainerDimensions(container);

  const relativeX = event.clientX - rect.left;
  const relativeY = event.clientY - rect.top;

  const slotWidth = rect.width / cols;
  const slotHeight = rect.height / rows;

  const gridX = Math.floor(relativeX / slotWidth);
  const gridY = Math.floor(relativeY / slotHeight);

  if (gridX < 0 || gridX >= cols || gridY < 0 || gridY >= rows) {
    return null;
  }

  return [gridX, gridY];
}

export type PlacementTarget = {
  container: Container;
  playerIndex: number;
  gridCoords: [number, number];
};

export const enum PlacementMode {
  /** Replace the target with the selection. */
  REPLACE,
  /** Fill empty slots in the target with the selection. */
  MERGE,
  /** Swap the target with the selection. */
  SWAP,
}

/**
 * Metadata defining restrictions for a slot.
 */
export interface SlotMetadata {
  index: number;
  typeFilter: (item: ExtendedItemData) => boolean;
  condition?: (player: GearSetupPlayer) => boolean;
}

/**
 * Type filter that accepts any item.
 */
function acceptAll(_item: ExtendedItemData): boolean {
  return true;
}

/**
 * Type filter for specific equipment slot.
 */
function equipmentTypeFilter(
  slot: EquipmentSlot,
): (item: ExtendedItemData) => boolean {
  return (item) => item.slot === slot;
}

/**
 * Type filter for runes.
 */
function runeFilter(item: ExtendedItemData): boolean {
  return RUNE_ITEMS.includes(item.id);
}

/**
 * Gets slot metadata for a specific slot in a container.
 * Returns null if the slot is invalid or doesn't exist.
 */
export function getSlotMetadata(
  container: Container,
  index: number,
): SlotMetadata | null {
  switch (container) {
    case Container.INVENTORY:
      // Inventory slots accept any item.
      if (index < 0 || index >= NUM_INVENTORY_SLOTS) {
        return null;
      }
      return {
        index,
        typeFilter: acceptAll,
      };

    case Container.EQUIPMENT:
      switch (index as EquipmentSlot) {
        case EquipmentSlot.HEAD:
          return { index, typeFilter: equipmentTypeFilter(EquipmentSlot.HEAD) };
        case EquipmentSlot.CAPE:
          return { index, typeFilter: equipmentTypeFilter(EquipmentSlot.CAPE) };
        case EquipmentSlot.AMULET:
          return {
            index,
            typeFilter: equipmentTypeFilter(EquipmentSlot.AMULET),
          };
        case EquipmentSlot.AMMO:
          return { index, typeFilter: equipmentTypeFilter(EquipmentSlot.AMMO) };
        case EquipmentSlot.WEAPON:
          return {
            index,
            typeFilter: equipmentTypeFilter(EquipmentSlot.WEAPON),
          };
        case EquipmentSlot.TORSO:
          return {
            index,
            typeFilter: equipmentTypeFilter(EquipmentSlot.TORSO),
          };
        case EquipmentSlot.SHIELD:
          return {
            index,
            typeFilter: equipmentTypeFilter(EquipmentSlot.SHIELD),
          };
        case EquipmentSlot.LEGS:
          return { index, typeFilter: equipmentTypeFilter(EquipmentSlot.LEGS) };
        case EquipmentSlot.GLOVES:
          return {
            index,
            typeFilter: equipmentTypeFilter(EquipmentSlot.GLOVES),
          };
        case EquipmentSlot.BOOTS:
          return {
            index,
            typeFilter: equipmentTypeFilter(EquipmentSlot.BOOTS),
          };
        case EquipmentSlot.RING:
          return { index, typeFilter: equipmentTypeFilter(EquipmentSlot.RING) };
        case QUIVER_SLOT_INDEX:
          return {
            index,
            typeFilter: equipmentTypeFilter(EquipmentSlot.AMMO),
            condition: hasQuiver,
          };
        default:
          return null;
      }

    case Container.POUCH:
      // The pouch only accepts runes.
      if (index < 0 || index >= NUM_POUCH_SLOTS) {
        return null;
      }
      return {
        index,
        typeFilter: runeFilter,
      };
  }
}

export const enum PlacementError {
  OUT_OF_BOUNDS,
  NULL_SLOT,
  TYPE_MISMATCH,
  CONDITION_NOT_MET,
  QUIVER_NOT_VISIBLE,
  TWO_HANDED_CONFLICT,
  STACKABLE_DUPLICATE,
  /** In merge operations, a slot is already occupied by an item. */
  OCCUPIED_SLOT,
}

export interface SlotValidationResult {
  valid: boolean;
  reason?: PlacementError;
  targetCoords: [number, number];
  targetIndex: number | null;
}

export interface PlacementValidationResult {
  canPlace: boolean;
  validSlots: number;
  totalSlots: number;
  slotResults: Map<SlotKey, SlotValidationResult>;
}

/**
 * Gets the item at a specific slot in a player's container.
 * @param player The player to whom the container belongs.
 * @param container The container to which the slot belongs.
 * @param index The index of the slot whose item is being retrieved.
 * @returns The item in the slot, or null if the slot is empty.
 */
function getItemAtSlot(
  player: GearSetupPlayer,
  container: Container,
  index: number,
): { id: number; quantity: number } | null {
  const containerKey = getContainerKey(container);
  const slot = player[containerKey].slots.find((s) => s.index === index);
  return slot?.item ?? null;
}

/**
 * Counts how many of each item would exist in a container after an operation.
 * @param player The player to whom the container belongs.
 * @param container The container whose items are being calculated.
 * @param changes A map of slot indices to the items being added or removed.
 * @returns Map of item IDs to the number of slots which would contain it.
 */
function simulateContainerAfterOperation(
  player: GearSetupPlayer,
  container: Container,
  changes: Map<number, { id: number; quantity: number } | null>,
): Map<number, number> {
  const itemCounts = new Map<number, number>();

  // Start with existing items, keeping those which are not being changed.
  for (const slot of player[getContainerKey(container)].slots) {
    if (slot.item !== null && !changes.has(slot.index)) {
      itemCounts.set(slot.item.id, (itemCounts.get(slot.item.id) ?? 0) + 1);
    }
  }

  // Apply changes.
  for (const [_, newItem] of changes) {
    if (newItem !== null) {
      itemCounts.set(newItem.id, (itemCounts.get(newItem.id) ?? 0) + 1);
    }
  }

  return itemCounts;
}

function canFitItemInSlot(
  slot: SlotMetadata,
  player: GearSetupPlayer,
  item: SlotItem,
  itemCounts: Map<number, number> | null,
): PlacementError | undefined {
  if (slot.condition && !slot.condition(player)) {
    let error: PlacementError | undefined;

    if (slot.index === QUIVER_SLOT_INDEX) {
      // Check if the calculated post-operation counts include a quiver.
      const quiverAdded = QUIVER_IDS.some((id) => itemCounts?.get(id) ?? 0 > 0);
      if (!quiverAdded) {
        error = PlacementError.QUIVER_NOT_VISIBLE;
      }
    } else {
      error = PlacementError.CONDITION_NOT_MET;
    }

    if (error !== undefined) {
      return error;
    }
  }

  const itemData = extendedItemCache.getItem(item.id);
  if (itemData && !slot.typeFilter(itemData)) {
    return PlacementError.TYPE_MISMATCH;
  }

  // If the item is stackable, only one instance of it can exist in the
  // target container. Check the precalculated count to see if this would
  // be violated.
  if (itemData?.stackable && itemCounts !== null) {
    const count = itemCounts.get(item.id) ?? 0;
    if (count > 1) {
      return PlacementError.STACKABLE_DUPLICATE;
    }
  }

  return undefined;
}

export function countItemsAfterOperation(
  region: SelectionRegion,
  target: PlacementTarget,
  targetPlayer: GearSetupPlayer,
  sourcePlayer: GearSetupPlayer,
  mode: PlacementMode,
  isMovingItems: boolean,
  anchorX: number,
  anchorY: number,
): [Map<number, number>, Map<number, number> | null] {
  const targetChanges = new Map<
    number,
    { id: number; quantity: number } | null
  >();
  const sourceChanges = new Map<
    number,
    { id: number; quantity: number } | null
  >();

  for (const [_, slotData] of region.slots) {
    const targetX = anchorX + slotData.localX;
    const targetY = anchorY + slotData.localY;
    const targetIndex = coordsToIndex(targetX, targetY, target.container);

    if (targetIndex !== null) {
      targetChanges.set(targetIndex, slotData.slot?.item ?? null);

      // If the operation moves items from the source container, its counts
      // are affected too.
      if (isMovingItems) {
        if (mode === PlacementMode.SWAP) {
          const destItem = getItemAtSlot(
            targetPlayer,
            target.container,
            targetIndex,
          );
          sourceChanges.set(slotData.slotId.index, destItem);
        } else {
          sourceChanges.set(slotData.slotId.index, null);
        }
      }
    }
  }

  const isSameContainer =
    region.bounds.container === target.container &&
    region.bounds.playerIndex === target.playerIndex;

  let targetAfter: Map<number, number>;
  let sourceAfter: Map<number, number> | null = null;

  if (isSameContainer && isMovingItems) {
    // Same container operation: merge both change sets.
    // Source changes (removals) must be applied first.
    const combinedChanges = new Map([
      ...sourceChanges.entries(),
      ...targetChanges.entries(),
    ]);
    targetAfter = simulateContainerAfterOperation(
      targetPlayer,
      target.container,
      combinedChanges,
    );
    sourceAfter = targetAfter;
  } else {
    // Different containers: simulate separately.
    targetAfter = simulateContainerAfterOperation(
      targetPlayer,
      target.container,
      targetChanges,
    );

    if (isMovingItems) {
      sourceAfter = simulateContainerAfterOperation(
        sourcePlayer,
        region.bounds.container,
        sourceChanges,
      );
    }
  }

  return [targetAfter, sourceAfter];
}

function getAnchorCoords(
  region: SelectionRegion,
  target: PlacementTarget,
  offset: [number, number] | null,
): [number, number] {
  return [
    target.gridCoords[0] - (offset?.[0] ?? Math.floor(region.bounds.width / 2)),
    target.gridCoords[1] -
      (offset?.[1] ?? Math.floor(region.bounds.height / 2)),
  ];
}

function is2hWeapon(item: SlotItem | null): boolean {
  if (item === null) {
    return false;
  }
  const itemData = extendedItemCache.getItem(item.id);
  return itemData?.stats?.twoHanded ?? false;
}

function isShield(item: SlotItem | null): boolean {
  if (item === null) {
    return false;
  }
  const itemData = extendedItemCache.getItem(item.id);
  return itemData?.slot === EquipmentSlot.SHIELD;
}

/**
 * In the equipment container, the third row contains the slots for the weapon,
 * torso, and shield.
 *
 * When a region is being placed into equipment from a container without
 * restrictions, we have to check whether the alignment of a two-handed weapon
 * would result in both of them being placed in equipment slots, which would
 * result in a conflict.
 *
 * @param slotResults The results of the per-slot validations.
 * @param region The region being placed.
 * @param target The target of the placement.
 * @param targetPlayer The target player.
 * @param mode The mode of the placement.
 * @returns The number of invalid slots due to the two-handed weapon and shield
 * conflict.
 */
function checkInternal2HandedConflict(
  slotResults: Map<SlotKey, SlotValidationResult>,
  region: SelectionRegion,
  target: PlacementTarget,
  targetPlayer: GearSetupPlayer,
  mode: PlacementMode,
): number {
  let invalidatedSlots = 0;

  function invalidate(key: SlotKey) {
    const result = slotResults.get(key)!;
    slotResults.set(key, {
      ...result,
      valid: false,
      reason: PlacementError.TWO_HANDED_CONFLICT,
    });
    invalidatedSlots++;
  }

  if (target.container === Container.EQUIPMENT) {
    let weaponKey: SlotKey | null = null;
    let shieldKey: SlotKey | null = null;

    for (const [key, slotResult] of slotResults) {
      if (!slotResult.valid) {
        continue;
      }
      const targetIndex = slotResult.targetIndex;
      if (targetIndex === null) {
        continue;
      }

      if (targetIndex === EquipmentSlot.WEAPON) {
        weaponKey = key;
      } else if (targetIndex === EquipmentSlot.SHIELD) {
        shieldKey = key;
      }
    }

    if (weaponKey !== null && shieldKey !== null) {
      const weapon = region.slots.get(weaponKey)!.slot?.item ?? null;
      const shield = region.slots.get(shieldKey)!.slot?.item ?? null;

      if (is2hWeapon(weapon) && isShield(shield)) {
        invalidate(weaponKey);
        invalidate(shieldKey);
        return invalidatedSlots;
      }
    }
  }

  if (
    mode === PlacementMode.SWAP &&
    region.bounds.container === Container.EQUIPMENT
  ) {
    let sourceWeaponKey: SlotKey | null = null;
    let sourceShieldKey: SlotKey | null = null;
    let incomingWeapon: SlotItem | null = null;
    let incomingShield: SlotItem | null = null;

    for (const [key, slotData] of region.slots) {
      const sourceIndex = slotData.slotId.index;
      if (
        sourceIndex !== EquipmentSlot.WEAPON &&
        sourceIndex !== EquipmentSlot.SHIELD
      ) {
        continue;
      }

      // Check if an item is being swapped out of the source slot.
      const result = slotResults.get(key);
      if (!result?.valid || result.targetIndex === null) {
        continue;
      }

      const incoming = getItemAtSlot(
        targetPlayer,
        target.container,
        result.targetIndex,
      );
      if (incoming !== null) {
        if (sourceIndex === EquipmentSlot.WEAPON) {
          sourceWeaponKey = key;
          incomingWeapon = incoming;
        } else if (sourceIndex === EquipmentSlot.SHIELD) {
          sourceShieldKey = key;
          incomingShield = incoming;
        }
      }
    }

    if (sourceWeaponKey !== null && sourceShieldKey !== null) {
      if (is2hWeapon(incomingWeapon) && isShield(incomingShield)) {
        invalidate(sourceWeaponKey);
        invalidate(sourceShieldKey);
        return invalidatedSlots;
      }
    }
  }

  return invalidatedSlots;
}

export function canPlaceRegion(
  region: SelectionRegion,
  target: PlacementTarget,
  targetPlayer: GearSetupPlayer,
  sourcePlayer: GearSetupPlayer,
  mode: PlacementMode = PlacementMode.REPLACE,
  isMovingItems: boolean = false,
  offset: [number, number] | null = null,
): PlacementValidationResult {
  // TODO(frolv): Implement placement strategies and make validation
  // strategy-aware:
  //
  //   - Default (preserve shape): Whole-region validation (current behavior)
  //   - Linear reflow: Per-slot validation, show which items fit
  //   - Smart fill: Show items snapping to valid positions

  const { cols, rows } = getContainerDimensions(target.container);

  const [anchorX, anchorY] = getAnchorCoords(region, target, offset);

  // First, count how many of each item would exist in the source and target
  // containers if the operation was performed. This will be used to validate
  // items which have unique constraints (e.g. stackable items).
  const [targetAfter, sourceAfter] = countItemsAfterOperation(
    region,
    target,
    targetPlayer,
    sourcePlayer,
    mode,
    isMovingItems,
    anchorX,
    anchorY,
  );

  const slotResults = new Map<SlotKey, SlotValidationResult>();
  let validSlots = 0;
  let totalSlots = 0;

  for (const [key, slotData] of region.slots) {
    totalSlots++;
    const targetX = anchorX + slotData.localX;
    const targetY = anchorY + slotData.localY;

    let valid = true;
    let reason: PlacementError | undefined;
    let targetIndex: number | null = null;

    if (targetX < 0 || targetX >= cols || targetY < 0 || targetY >= rows) {
      valid = false;
      reason = PlacementError.OUT_OF_BOUNDS;
    } else {
      targetIndex = coordsToIndex(targetX, targetY, target.container);
      if (targetIndex === null) {
        valid = false;
        reason = PlacementError.NULL_SLOT;
      }
    }

    if (valid && targetIndex !== null) {
      const targetSlotMetadata = getSlotMetadata(target.container, targetIndex);

      if (targetSlotMetadata === null) {
        valid = false;
        reason = PlacementError.NULL_SLOT;
      } else {
        if (mode === PlacementMode.MERGE) {
          const targetItem = getItemAtSlot(
            targetPlayer,
            target.container,
            targetIndex,
          );
          if (targetItem !== null) {
            valid = false;
            reason = PlacementError.OCCUPIED_SLOT;
          }
        }

        if (slotData.slot?.item) {
          // Check if the source item would fit in the target slot.
          reason = canFitItemInSlot(
            targetSlotMetadata,
            targetPlayer,
            slotData.slot.item,
            targetAfter,
          );
          if (reason !== undefined) {
            valid = false;
          }
        }
      }
    }

    // If swapping the source and target regions, we have to perform the same
    // validation checks in the reverse direction as well.
    if (valid && mode === PlacementMode.SWAP && targetIndex !== null) {
      const destItem = getItemAtSlot(
        targetPlayer,
        target.container,
        targetIndex,
      );

      if (destItem !== null) {
        const sourceSlotMetadata = getSlotMetadata(
          region.bounds.container,
          slotData.slotId.index,
        );

        if (sourceSlotMetadata !== null) {
          reason = canFitItemInSlot(
            sourceSlotMetadata,
            sourcePlayer,
            destItem,
            sourceAfter,
          );
          if (reason !== undefined) {
            valid = false;
          }
        }
      }
    }

    slotResults.set(key, {
      valid,
      reason,
      targetCoords: [targetX, targetY],
      targetIndex,
    });

    if (valid) {
      validSlots++;
    }
  }

  validSlots -= checkInternal2HandedConflict(
    slotResults,
    region,
    target,
    targetPlayer,
    mode,
  );

  let canPlace: boolean;
  switch (mode) {
    case PlacementMode.REPLACE:
    case PlacementMode.SWAP:
      canPlace = validSlots === totalSlots;
      break;

    case PlacementMode.MERGE:
      canPlace = validSlots > 0;
      break;
  }

  return {
    canPlace,
    validSlots,
    totalSlots,
    slotResults,
  };
}

/**
 * Removes a conflicting two-handed item from the player's equipment container,
 * placing it into the player's inventory if there is space.
 *
 * Modifies the equipment slots in place, and returns the potentially updated
 * inventory slots.
 *
 * @param placed Whether a weapon or shield was placed in the equipment
 *   container.
 * @param playerEquipment Post-operation player equipment slots.
 * @param playerInventory Post-operation player inventory slots.
 * @returns Updated player inventory slots.
 */
export function removeConflicting2hItem(
  placed: { weapon: boolean; shield: boolean },
  playerEquipment: Map<number, ItemSlot>,
  playerInventory: ItemSlot[],
): ItemSlot[] {
  if (!placed.weapon && !placed.shield) {
    return playerInventory;
  }

  const playerWeapon = playerEquipment.get(EquipmentSlot.WEAPON);
  const playerShield = playerEquipment.get(EquipmentSlot.SHIELD);

  if (playerWeapon !== undefined && playerShield !== undefined) {
    if (is2hWeapon(playerWeapon.item)) {
      // Both `placed.weapon` and `placed.shield` should never be true due to
      // the validation check, but default to removing the shield.
      const removeSlot = placed.shield
        ? EquipmentSlot.WEAPON
        : EquipmentSlot.SHIELD;

      const removed = playerEquipment.get(removeSlot)!;
      playerEquipment.delete(removeSlot);

      const updatedInventory: (ItemSlot | null)[] = new Array<ItemSlot | null>(
        NUM_INVENTORY_SLOTS,
      ).fill(null);
      for (const slot of playerInventory) {
        updatedInventory[slot.index] = slot;
      }

      // Place the removed item into the first available inventory slot if the
      // player has inventory space. Otherwise, just discard the item.
      const firstAvailable = updatedInventory.findIndex(
        (slot) => slot === null,
      );
      if (firstAvailable !== -1) {
        updatedInventory[firstAvailable] = {
          ...removed,
          index: firstAvailable,
        };
        playerInventory = updatedInventory.filter((slot) => slot !== null);
      }
    }
  }

  return playerInventory;
}

/**
 * Places a selection region into a target container.
 *
 * @param region The region to place.
 * @param target Container into which the region is being placed.
 * @param targetPlayer Snapshot of the target player before the operation.
 * @param sourcePlayer Snapshot of the source player before the operation.
 * @param mode Type of placement operation to perform.
 * @param isMovingItems Whether items are being moved from the source container.
 * @returns Updated source and target players after the operation, and the
 *   placement region's new location.
 */
export function placeRegion(
  region: SelectionRegion,
  target: PlacementTarget,
  targetPlayer: GearSetupPlayer,
  sourcePlayer: GearSetupPlayer,
  mode: PlacementMode = PlacementMode.REPLACE,
  isMovingItems: boolean = false,
  offset: [number, number] | null = null,
): [GearSetupPlayer, GearSetupPlayer, SelectionRegion] | null {
  const valid = canPlaceRegion(
    region,
    target,
    targetPlayer,
    sourcePlayer,
    mode,
    isMovingItems,
    offset,
  );
  if (!valid.canPlace) {
    return null;
  }

  const targetContainerKey = getContainerKey(target.container);
  const sourceContainerKey = getContainerKey(region.bounds.container);

  const updatedTarget = structuredClone(targetPlayer);
  let updatedSource: GearSetupPlayer;

  const isSamePlayer = target.playerIndex === region.bounds.playerIndex;
  if (isSamePlayer) {
    updatedSource = updatedTarget;
  } else if (isMovingItems) {
    updatedSource = structuredClone(sourcePlayer);
  } else {
    updatedSource = sourcePlayer;
  }

  // Affected slots in the operation where a conflict might occur.
  // Checked after the operation is performed to resolve in the conflict in
  // postprocessing.
  const placedSource = { weapon: false, shield: false };
  const placedTarget = { weapon: false, shield: false };

  if (isMovingItems) {
    const sourceSlots = new Map<number, ItemSlot>(
      sourcePlayer[sourceContainerKey].slots.map((slot) => [slot.index, slot]),
    );

    for (const [key, slotData] of valid.slotResults) {
      if (!slotData.valid) {
        continue;
      }

      const sourceIndex = region.slots.get(key)!.slotId.index;
      const targetIndex = slotData.targetIndex!;

      if (mode === PlacementMode.SWAP) {
        // Place items from the selection region into the source container.
        const targetItem = targetPlayer[targetContainerKey].slots.find(
          (slot) => slot.index === targetIndex,
        );
        if (targetItem !== undefined) {
          if (region.bounds.container === Container.EQUIPMENT) {
            if (sourceIndex === EquipmentSlot.WEAPON) {
              placedSource.weapon = true;
            } else if (sourceIndex === EquipmentSlot.SHIELD) {
              placedSource.shield = true;
            }
          }
          sourceSlots.set(sourceIndex, {
            index: sourceIndex,
            item: targetItem.item,
            comment: targetItem.comment,
          });
        } else {
          sourceSlots.delete(sourceIndex);
        }
      } else {
        // Delete items moved from the source container.
        sourceSlots.delete(sourceIndex);
      }
    }

    updatedSource[sourceContainerKey].slots = Array.from(sourceSlots.values());
  }

  const [anchorX, anchorY] = getAnchorCoords(region, target, offset);

  const newRegion: SelectionRegion = {
    type: region.type,
    bounds: {
      minX: anchorX,
      minY: anchorY,
      width: region.bounds.width,
      height: region.bounds.height,
      container: target.container,
      playerIndex: target.playerIndex,
    },
    slots: new Map(),
  };

  // Grab slots from the updated target container, which automatically handles
  // the case where the target and source players are the same as they will
  // already have source modifications applied.
  const targetSlots = new Map<number, ItemSlot>(
    updatedTarget[targetContainerKey].slots.map((slot) => [slot.index, slot]),
  );

  for (const [key, slotData] of valid.slotResults) {
    if (!slotData.valid) {
      continue;
    }

    const slot = region.slots.get(key)!;
    const targetIndex = slotData.targetIndex!;

    const sourceSlot = slot.slot;
    if (sourceSlot !== null) {
      if (target.container === Container.EQUIPMENT) {
        if (targetIndex === EquipmentSlot.WEAPON) {
          placedTarget.weapon = true;
        } else if (targetIndex === EquipmentSlot.SHIELD) {
          placedTarget.shield = true;
        }
      }

      targetSlots.set(targetIndex, {
        index: targetIndex,
        item: sourceSlot.item,
        comment: sourceSlot.comment,
      });
    } else {
      targetSlots.delete(targetIndex);
    }

    newRegion.slots.set(key, {
      slot: slot.slot,
      localX: slot.localX,
      localY: slot.localY,
      slotId: {
        playerIndex: target.playerIndex,
        container: target.container,
        index: targetIndex,
      },
    });
  }

  updatedTarget[targetContainerKey].slots = Array.from(targetSlots.values());

  // As a postprocessing step, check the updated players for conflicts with
  // two-handed weapons and shields. Remove any conflicting items.
  if (mode === PlacementMode.SWAP) {
    const sourceEquipment = new Map(
      updatedSource.equipment.slots.map((slot) => [slot.index, slot]),
    );
    updatedSource.inventory.slots = removeConflicting2hItem(
      placedSource,
      sourceEquipment,
      updatedSource.inventory.slots,
    );
    updatedSource.equipment.slots = Array.from(sourceEquipment.values());
  }

  const targetEquipment = new Map(
    updatedTarget.equipment.slots.map((slot) => [slot.index, slot]),
  );
  updatedTarget.inventory.slots = removeConflicting2hItem(
    placedTarget,
    targetEquipment,
    updatedTarget.inventory.slots,
  );
  updatedTarget.equipment.slots = Array.from(targetEquipment.values());

  return [updatedTarget, updatedSource, newRegion];
}

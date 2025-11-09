import { EquipmentSlot } from '@blert/common';

import {
  extendedItemCache,
  ExtendedItemData,
} from '@/utils/item-cache/extended';

import {
  canPlaceRegion,
  coordsToIndex,
  indexToCoords,
  PlacementError,
  PlacementMode,
  PlacementTarget,
  removeConflicting2hItem,
  SlotIdentifier,
} from '../container-grid';
import { SelectionRegion, SlotData, SlotKey } from '../editing-context';
import { Container, GearSetupPlayer, ItemSlot, Spellbook } from '../setup';

describe('indexToCoords and coordsToIndex', () => {
  describe('Inventory', () => {
    it('converts index to coords correctly', () => {
      expect(indexToCoords(0, Container.INVENTORY)).toEqual([0, 0]);
      expect(indexToCoords(3, Container.INVENTORY)).toEqual([3, 0]);
      expect(indexToCoords(4, Container.INVENTORY)).toEqual([0, 1]);
      expect(indexToCoords(27, Container.INVENTORY)).toEqual([3, 6]);
    });

    it('converts coords to index correctly', () => {
      expect(coordsToIndex(0, 0, Container.INVENTORY)).toBe(0);
      expect(coordsToIndex(3, 0, Container.INVENTORY)).toBe(3);
      expect(coordsToIndex(0, 1, Container.INVENTORY)).toBe(4);
      expect(coordsToIndex(3, 6, Container.INVENTORY)).toBe(27);
    });

    it('returns null for out-of-bounds coords', () => {
      expect(coordsToIndex(-1, 0, Container.INVENTORY)).toBeNull();
      expect(coordsToIndex(4, 0, Container.INVENTORY)).toBeNull();
      expect(coordsToIndex(0, 7, Container.INVENTORY)).toBeNull();
    });
  });

  describe('Equipment', () => {
    it('converts valid equipment slots', () => {
      expect(indexToCoords(EquipmentSlot.HEAD, Container.EQUIPMENT)).toEqual([
        1, 0,
      ]);
      expect(coordsToIndex(1, 0, Container.EQUIPMENT)).toBe(EquipmentSlot.HEAD);

      expect(indexToCoords(EquipmentSlot.WEAPON, Container.EQUIPMENT)).toEqual([
        0, 2,
      ]);
      expect(coordsToIndex(0, 2, Container.EQUIPMENT)).toBe(
        EquipmentSlot.WEAPON,
      );

      expect(indexToCoords(EquipmentSlot.AMMO, Container.EQUIPMENT)).toEqual([
        2, 1,
      ]);
      expect(coordsToIndex(2, 1, Container.EQUIPMENT)).toBe(EquipmentSlot.AMMO);
    });

    it('returns null for equipment null positions', () => {
      expect(coordsToIndex(0, 0, Container.EQUIPMENT)).toBeNull(); // Top-left
      expect(coordsToIndex(0, 3, Container.EQUIPMENT)).toBeNull(); // Mid-left
      expect(coordsToIndex(2, 3, Container.EQUIPMENT)).toBeNull(); // Mid-right
    });
  });

  describe('Pouch', () => {
    it('converts pouch slots correctly', () => {
      expect(indexToCoords(0, Container.POUCH)).toEqual([0, 0]);
      expect(indexToCoords(3, Container.POUCH)).toEqual([3, 0]);
      expect(coordsToIndex(0, 0, Container.POUCH)).toBe(0);
      expect(coordsToIndex(3, 0, Container.POUCH)).toBe(3);
    });

    it('returns null for invalid pouch positions', () => {
      expect(coordsToIndex(4, 0, Container.POUCH)).toBeNull();
      expect(coordsToIndex(0, 1, Container.POUCH)).toBeNull();
    });
  });
});

type MockItem = {
  id: number;
  slot?: EquipmentSlot;
  stackable?: boolean;
  stats?: { twoHanded?: boolean };
};

const originalGetItem = extendedItemCache.getItem;

function mockItems(items: MockItem[]): void {
  const map = new Map<number, MockItem>(items.map((item) => [item.id, item]));
  extendedItemCache.getItem = (id: number) => {
    const item = map.get(id);
    if (!item) {
      return null;
    }
    return item as unknown as ExtendedItemData;
  };
}

function restoreItems(): void {
  extendedItemCache.getItem = originalGetItem;
}

function createTestPlayer(items?: {
  inventory?: Array<{ index: number; itemId: number; quantity?: number }>;
  equipment?: Array<{ index: number; itemId: number; quantity?: number }>;
  pouch?: Array<{ index: number; itemId: number; quantity?: number }>;
}): GearSetupPlayer {
  const player: GearSetupPlayer = {
    name: 'Test Player',
    inventory: { slots: [] },
    equipment: { slots: [] },
    pouch: { slots: [] },
    spellbook: Spellbook.STANDARD,
  };

  if (items?.inventory) {
    player.inventory.slots = items.inventory.map((item) => ({
      index: item.index,
      item: { id: item.itemId, quantity: item.quantity ?? 1 },
      comment: null,
    }));
  }

  if (items?.equipment) {
    player.equipment.slots = items.equipment.map((item) => ({
      index: item.index,
      item: { id: item.itemId, quantity: item.quantity ?? 1 },
      comment: null,
    }));
  }

  if (items?.pouch) {
    player.pouch.slots = items.pouch.map((item) => ({
      index: item.index,
      item: { id: item.itemId, quantity: item.quantity ?? 1 },
      comment: null,
    }));
  }

  return player;
}

function createTestRegion(
  container: Container,
  playerIndex: number,
  minX: number,
  minY: number,
  width: number,
  height: number,
  itemSlots: Array<{ x: number; y: number; itemId?: number }> = [],
): SelectionRegion {
  const slots = new Map<SlotKey, SlotData>();

  for (const { x, y, itemId } of itemSlots) {
    const index = coordsToIndex(minX + x, minY + y, container);
    if (index === null) {
      throw new Error(`Invalid coordinates: (${minX + x}, ${minY + y})`);
    }

    const slotId: SlotIdentifier = {
      playerIndex,
      container,
      index,
    };

    const slotData: SlotData = {
      slot: itemId
        ? { index, item: { id: itemId, quantity: 1 }, comment: null }
        : null,
      localX: x,
      localY: y,
      slotId,
    };

    slots.set(`${x},${y}`, slotData);
  }

  return {
    type: slots.size === width * height ? 'dense' : 'sparse',
    bounds: {
      minX,
      minY,
      width,
      height,
      container,
      playerIndex,
    },
    slots,
  };
}

describe('canPlaceRegion', () => {
  const emptyPlayer = createTestPlayer();

  const CAPE: MockItem = {
    id: 122,
    slot: EquipmentSlot.CAPE,
    stackable: true,
    stats: { twoHanded: false },
  };
  const CHESTPLATE: MockItem = {
    id: 123,
    slot: EquipmentSlot.TORSO,
    stackable: true,
    stats: { twoHanded: false },
  };
  const HELMET: MockItem = {
    id: 124,
    slot: EquipmentSlot.HEAD,
    stackable: true,
    stats: { twoHanded: false },
  };

  beforeEach(() => {
    mockItems([CAPE, CHESTPLATE, HELMET]);
  });

  afterEach(() => {
    restoreItems();
  });

  describe('Inventory placement', () => {
    it('allows placing 1x1 region in valid position', () => {
      const region = createTestRegion(Container.INVENTORY, 0, 0, 0, 1, 1, [
        { x: 0, y: 0, itemId: 123 },
      ]);

      const target: PlacementTarget = {
        container: Container.INVENTORY,
        playerIndex: 0,
        gridCoords: [2, 2], // Center will be at [2, 2]
      };

      const result = canPlaceRegion(
        region,
        target,
        emptyPlayer,
        emptyPlayer,
        PlacementMode.REPLACE,
      );

      expect(result.canPlace).toBe(true);
      expect(result.totalSlots).toBe(1);
      expect(result.validSlots).toBe(1);
      expect(result.slotResults.size).toBe(1);

      const slotResult = result.slotResults.get('0,0');
      expect(slotResult?.valid).toBe(true);
      expect(slotResult?.reason).toBeUndefined();
      expect(slotResult?.targetCoords).toEqual([2, 2]);
      expect(slotResult?.targetIndex).toBe(10); // Index at [2, 2] in 4x7 grid
    });

    it('allows placing 2x2 region in valid position', () => {
      const region = createTestRegion(Container.INVENTORY, 0, 0, 0, 2, 2, [
        { x: 0, y: 0, itemId: 1 },
        { x: 1, y: 0, itemId: 2 },
        { x: 0, y: 1, itemId: 3 },
        { x: 1, y: 1, itemId: 4 },
      ]);

      const target: PlacementTarget = {
        container: Container.INVENTORY,
        playerIndex: 0,
        gridCoords: [2, 2], // Centered at [2,2], will span [1-2, 1-2]
      };

      const result = canPlaceRegion(
        region,
        target,
        emptyPlayer,
        emptyPlayer,
        PlacementMode.REPLACE,
      );

      expect(result.canPlace).toBe(true);
      expect(result.totalSlots).toBe(4);
      expect(result.validSlots).toBe(4);
      expect(result.slotResults.size).toBe(4);

      // All slots should be valid with correct target coords
      expect(result.slotResults.get('0,0')?.valid).toBe(true);
      expect(result.slotResults.get('0,0')?.targetCoords).toEqual([1, 1]);
      expect(result.slotResults.get('0,1')?.valid).toBe(true);
      expect(result.slotResults.get('0,1')?.targetCoords).toEqual([1, 2]);
      expect(result.slotResults.get('1,0')?.valid).toBe(true);
      expect(result.slotResults.get('1,0')?.targetCoords).toEqual([2, 1]);
      expect(result.slotResults.get('1,1')?.valid).toBe(true);
      expect(result.slotResults.get('1,1')?.targetCoords).toEqual([2, 2]);
    });

    it('rejects region that extends past right edge', () => {
      const region = createTestRegion(Container.INVENTORY, 0, 0, 0, 2, 1, [
        { x: 0, y: 0, itemId: 1 },
        { x: 1, y: 0, itemId: 2 },
      ]);

      const target: PlacementTarget = {
        container: Container.INVENTORY,
        playerIndex: 0,
        gridCoords: [3, 0], // Would place at [2-3, 0], but x=3 is valid
      };

      expect(
        canPlaceRegion(
          region,
          target,
          emptyPlayer,
          emptyPlayer,
          PlacementMode.REPLACE,
        ).canPlace,
      ).toBe(true);

      const target2: PlacementTarget = {
        container: Container.INVENTORY,
        playerIndex: 0,
        gridCoords: [3, 0], // Centered, anchor at [2, 0], extends to [3, 0] - valid
      };
      expect(
        canPlaceRegion(
          region,
          target2,
          emptyPlayer,
          emptyPlayer,
          PlacementMode.REPLACE,
        ).canPlace,
      ).toBe(true);

      // Actually out of bounds
      const region3x1 = createTestRegion(Container.INVENTORY, 0, 0, 0, 3, 1, [
        { x: 0, y: 0, itemId: 1 },
        { x: 1, y: 0, itemId: 2 },
        { x: 2, y: 0, itemId: 3 },
      ]);
      const target3: PlacementTarget = {
        container: Container.INVENTORY,
        playerIndex: 0,
        gridCoords: [3, 0], // Anchor at [2, 0], extends to [4, 0] - invalid!
      };
      expect(
        canPlaceRegion(
          region3x1,
          target3,
          emptyPlayer,
          emptyPlayer,
          PlacementMode.REPLACE,
        ).canPlace,
      ).toBe(false);
    });

    it('rejects region that extends past bottom edge', () => {
      const region = createTestRegion(Container.INVENTORY, 0, 0, 0, 1, 3, [
        { x: 0, y: 0, itemId: 1 },
        { x: 0, y: 1, itemId: 2 },
        { x: 0, y: 2, itemId: 3 },
      ]);

      const target: PlacementTarget = {
        container: Container.INVENTORY,
        playerIndex: 0,
        gridCoords: [0, 6], // Anchor at [0, 5], extends to [0, 7] - invalid!
      };

      const result = canPlaceRegion(
        region,
        target,
        emptyPlayer,
        emptyPlayer,
        PlacementMode.REPLACE,
      );

      expect(result.canPlace).toBe(false);
      expect(result.totalSlots).toBe(3);
      expect(result.validSlots).toBe(2); // First two slots valid, third OOB

      // First two slots should be valid
      expect(result.slotResults.get('0,0')?.valid).toBe(true);
      expect(result.slotResults.get('0,0')?.targetCoords).toEqual([0, 5]);
      expect(result.slotResults.get('0,1')?.valid).toBe(true);
      expect(result.slotResults.get('0,1')?.targetCoords).toEqual([0, 6]);

      // Third slot extends beyond grid
      expect(result.slotResults.get('0,2')?.valid).toBe(false);
      expect(result.slotResults.get('0,2')?.targetCoords).toEqual([0, 7]);
      expect(result.slotResults.get('0,2')?.reason).toBe(
        PlacementError.OUT_OF_BOUNDS,
      );
      expect(result.slotResults.get('0,2')?.targetIndex).toBeNull();
    });

    it('rejects region partially out of bounds (top-left)', () => {
      const region = createTestRegion(Container.INVENTORY, 0, 0, 0, 2, 2, [
        { x: 0, y: 0, itemId: 1 },
        { x: 1, y: 0, itemId: 2 },
        { x: 0, y: 1, itemId: 3 },
        { x: 1, y: 1, itemId: 4 },
      ]);

      const target: PlacementTarget = {
        container: Container.INVENTORY,
        playerIndex: 0,
        gridCoords: [0, 0], // Anchor at [-1, -1] - invalid!
      };

      expect(
        canPlaceRegion(
          region,
          target,
          emptyPlayer,
          emptyPlayer,
          PlacementMode.REPLACE,
        ).canPlace,
      ).toBe(false);
    });
  });

  describe('Equipment placement', () => {
    it('allows placing item in valid equipment slot', () => {
      const region = createTestRegion(Container.EQUIPMENT, 0, 1, 0, 1, 1, [
        { x: 0, y: 0, itemId: CHESTPLATE.id },
      ]);

      const target: PlacementTarget = {
        container: Container.EQUIPMENT,
        playerIndex: 0,
        gridCoords: [1, 2],
      };

      const result = canPlaceRegion(
        region,
        target,
        emptyPlayer,
        emptyPlayer,
        PlacementMode.REPLACE,
      );

      expect(result.canPlace).toBe(true);
      const slot = result.slotResults.get('0,0');
      expect(slot?.valid).toBe(true);
      expect(slot?.reason).toBeUndefined();
      expect(slot?.targetCoords).toEqual([1, 2]);
      expect(slot?.targetIndex).toBe(EquipmentSlot.TORSO);
    });

    it('rejects placing item in invalid equipment slot', () => {
      const region = createTestRegion(Container.EQUIPMENT, 0, 1, 0, 1, 1, [
        { x: 0, y: 0, itemId: HELMET.id },
      ]);

      const target: PlacementTarget = {
        container: Container.EQUIPMENT,
        playerIndex: 0,
        gridCoords: [1, 2],
      };

      const result = canPlaceRegion(
        region,
        target,
        emptyPlayer,
        emptyPlayer,
        PlacementMode.REPLACE,
      );

      expect(result.canPlace).toBe(false);
      const slot = result.slotResults.get('0,0');
      expect(slot?.valid).toBe(false);
      expect(slot?.reason).toBe(PlacementError.TYPE_MISMATCH);
      expect(slot?.targetCoords).toEqual([1, 2]);
      expect(slot?.targetIndex).toBe(EquipmentSlot.TORSO);
    });

    it('rejects placement on equipment null slots', () => {
      const region = createTestRegion(Container.EQUIPMENT, 0, 1, 0, 2, 1, [
        { x: 0, y: 0, itemId: 1 },
        { x: 1, y: 0, itemId: 2 },
      ]);

      const target: PlacementTarget = {
        container: Container.EQUIPMENT,
        playerIndex: 0,
        gridCoords: [0, 0], // Anchor at [-1, 0], would include null slot
      };

      const result = canPlaceRegion(
        region,
        target,
        emptyPlayer,
        emptyPlayer,
        PlacementMode.REPLACE,
      );

      expect(result.canPlace).toBe(false);
      expect(result.totalSlots).toBe(2);
      expect(result.validSlots).toBe(0); // Both OOB or null slots
      expect(result.slotResults.size).toBe(2);

      // First slot at [-1, 0] is out of bounds
      expect(result.slotResults.get('0,0')?.valid).toBe(false);
      expect(result.slotResults.get('0,0')?.reason).toBe(
        PlacementError.OUT_OF_BOUNDS,
      );

      // Second slot at [0, 0] is a null position in equipment
      expect(result.slotResults.get('1,0')?.valid).toBe(false);
      expect(result.slotResults.get('1,0')?.reason).toBe(
        PlacementError.NULL_SLOT,
      );
    });
  });

  describe('Placement modes', () => {
    it('REPLACE mode requires all slots to be valid', () => {
      const region = createTestRegion(Container.INVENTORY, 0, 0, 0, 3, 1, [
        { x: 0, y: 0, itemId: 1 },
        { x: 1, y: 0, itemId: 2 },
        { x: 2, y: 0, itemId: 3 },
      ]);

      const target: PlacementTarget = {
        container: Container.INVENTORY,
        playerIndex: 0,
        gridCoords: [3, 0], // Anchor at [2, 0], would extend to [4, 0] - one slot OOB
      };

      const result = canPlaceRegion(
        region,
        target,
        emptyPlayer,
        emptyPlayer,
        PlacementMode.REPLACE,
      );

      expect(result.canPlace).toBe(false);
      expect(result.totalSlots).toBe(3);
      expect(result.validSlots).toBe(2); // Two slots fit, one is OOB
      expect(result.slotResults.size).toBe(3);

      // Check individual slot results
      expect(result.slotResults.get('0,0')?.valid).toBe(true);
      expect(result.slotResults.get('1,0')?.valid).toBe(true);
      expect(result.slotResults.get('2,0')?.valid).toBe(false);
      expect(result.slotResults.get('2,0')?.reason).toBe(
        PlacementError.OUT_OF_BOUNDS,
      );
    });

    it('MERGE mode allows partial placement', () => {
      const region = createTestRegion(Container.INVENTORY, 0, 0, 0, 3, 1, [
        { x: 0, y: 0, itemId: 1 },
        { x: 1, y: 0, itemId: 2 },
        { x: 2, y: 0, itemId: 3 },
      ]);

      const target: PlacementTarget = {
        container: Container.INVENTORY,
        playerIndex: 0,
        gridCoords: [3, 0], // Anchor at [2, 0], 2 slots valid, 1 slot OOB
      };

      const result = canPlaceRegion(
        region,
        target,
        emptyPlayer,
        emptyPlayer,
        PlacementMode.MERGE,
      );

      expect(result.canPlace).toBe(true); // MERGE allows partial
      expect(result.totalSlots).toBe(3);
      expect(result.validSlots).toBe(2);

      // Should have detailed results for all slots
      expect(result.slotResults.size).toBe(3);
      expect(result.slotResults.get('2,0')?.valid).toBe(false);
    });

    it('MERGE mode rejects when no slots are valid', () => {
      const region = createTestRegion(Container.INVENTORY, 0, 0, 0, 2, 2, [
        { x: 0, y: 0, itemId: 1 },
        { x: 1, y: 0, itemId: 2 },
        { x: 0, y: 1, itemId: 3 },
        { x: 1, y: 1, itemId: 4 },
      ]);

      const target: PlacementTarget = {
        container: Container.INVENTORY,
        playerIndex: 0,
        gridCoords: [-2, -2], // Completely out of bounds
      };

      const result = canPlaceRegion(
        region,
        target,
        emptyPlayer,
        emptyPlayer,
        PlacementMode.MERGE,
      );

      expect(result.canPlace).toBe(false);
      expect(result.totalSlots).toBe(4);
      expect(result.validSlots).toBe(0);
      expect(result.slotResults.size).toBe(4);

      // All slots should be invalid
      for (const [_, slotResult] of result.slotResults) {
        expect(slotResult.valid).toBe(false);
        expect(slotResult.reason).toBe(PlacementError.OUT_OF_BOUNDS);
      }
    });
  });

  describe('Cross-container placement', () => {
    it('validates placement from inventory to equipment', () => {
      const region = createTestRegion(Container.INVENTORY, 0, 0, 0, 1, 1, [
        { x: 0, y: 0, itemId: HELMET.id },
      ]);

      const target: PlacementTarget = {
        container: Container.EQUIPMENT,
        playerIndex: 0,
        gridCoords: [1, 0], // Head slot
      };

      const result = canPlaceRegion(
        region,
        target,
        emptyPlayer,
        emptyPlayer,
        PlacementMode.REPLACE,
      );

      expect(result.canPlace).toBe(true);
      const slot = result.slotResults.get('0,0');
      expect(slot?.valid).toBe(true);
      expect(slot?.reason).toBeUndefined();
      expect(slot?.targetCoords).toEqual([1, 0]);
      expect(slot?.targetIndex).toBe(EquipmentSlot.HEAD);
    });

    it('rejects equipment placement on null slots', () => {
      const region = createTestRegion(Container.INVENTORY, 0, 0, 0, 1, 1, [
        { x: 0, y: 0, itemId: 123 },
      ]);

      const target: PlacementTarget = {
        container: Container.EQUIPMENT,
        playerIndex: 0,
        gridCoords: [0, 0], // Null slot position
      };

      expect(
        canPlaceRegion(
          region,
          target,
          emptyPlayer,
          emptyPlayer,
          PlacementMode.REPLACE,
        ).canPlace,
      ).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('handles 1x1 region at exact corner', () => {
      const region = createTestRegion(Container.INVENTORY, 0, 0, 0, 1, 1, [
        { x: 0, y: 0, itemId: 1 },
      ]);

      const target: PlacementTarget = {
        container: Container.INVENTORY,
        playerIndex: 0,
        gridCoords: [0, 0],
      };

      expect(
        canPlaceRegion(
          region,
          target,
          emptyPlayer,
          emptyPlayer,
          PlacementMode.REPLACE,
        ).canPlace,
      ).toBe(true);
    });

    it('handles 1x1 region at exact bottom-right corner', () => {
      const region = createTestRegion(Container.INVENTORY, 0, 0, 0, 1, 1, [
        { x: 0, y: 0, itemId: 1 },
      ]);

      const target: PlacementTarget = {
        container: Container.INVENTORY,
        playerIndex: 0,
        gridCoords: [3, 6], // Bottom-right of 4x7 grid
      };

      expect(
        canPlaceRegion(
          region,
          target,
          emptyPlayer,
          emptyPlayer,
          PlacementMode.REPLACE,
        ).canPlace,
      ).toBe(true);
    });

    it('handles sparse region with gaps', () => {
      // L-shaped region
      const region = createTestRegion(Container.INVENTORY, 0, 0, 0, 2, 2, [
        { x: 0, y: 0, itemId: 1 },
        { x: 0, y: 1, itemId: 2 },
        { x: 1, y: 1, itemId: 3 },
        // Missing [1, 0]
      ]);

      const target: PlacementTarget = {
        container: Container.INVENTORY,
        playerIndex: 0,
        gridCoords: [1, 1], // All slots should be valid
      };

      expect(
        canPlaceRegion(
          region,
          target,
          emptyPlayer,
          emptyPlayer,
          PlacementMode.REPLACE,
        ).canPlace,
      ).toBe(true);
    });

    it('handles empty selection region', () => {
      const region = createTestRegion(Container.INVENTORY, 0, 0, 0, 2, 2, []);

      const target: PlacementTarget = {
        container: Container.INVENTORY,
        playerIndex: 0,
        gridCoords: [1, 1],
      };

      // Empty region should be valid (no slots to validate)
      expect(
        canPlaceRegion(
          region,
          target,
          emptyPlayer,
          emptyPlayer,
          PlacementMode.REPLACE,
        ).canPlace,
      ).toBe(true);
    });
  });

  describe('Centering behavior', () => {
    it('centers 2x2 region on target coordinates', () => {
      const region = createTestRegion(Container.INVENTORY, 0, 0, 0, 2, 2, [
        { x: 0, y: 0, itemId: 1 },
        { x: 1, y: 0, itemId: 2 },
        { x: 0, y: 1, itemId: 3 },
        { x: 1, y: 1, itemId: 4 },
      ]);

      const target: PlacementTarget = {
        container: Container.INVENTORY,
        playerIndex: 0,
        gridCoords: [2, 2], // Center, anchor will be [1, 1]
      };

      expect(
        canPlaceRegion(
          region,
          target,
          emptyPlayer,
          emptyPlayer,
          PlacementMode.REPLACE,
        ).canPlace,
      ).toBe(true);

      // Try at corner where it can't fit when centered
      const target2: PlacementTarget = {
        container: Container.INVENTORY,
        playerIndex: 0,
        gridCoords: [0, 0], // Center, anchor at [-1, -1] - invalid!
      };

      expect(
        canPlaceRegion(
          region,
          target2,
          emptyPlayer,
          emptyPlayer,
          PlacementMode.REPLACE,
        ).canPlace,
      ).toBe(false);
    });

    it('centers odd-sized region correctly', () => {
      const region = createTestRegion(Container.INVENTORY, 0, 0, 0, 3, 3, [
        { x: 0, y: 0, itemId: 1 },
        { x: 1, y: 0, itemId: 2 },
        { x: 2, y: 0, itemId: 3 },
        { x: 0, y: 1, itemId: 4 },
        { x: 1, y: 1, itemId: 5 }, // Center
        { x: 2, y: 1, itemId: 6 },
        { x: 0, y: 2, itemId: 7 },
        { x: 1, y: 2, itemId: 8 },
        { x: 2, y: 2, itemId: 9 },
      ]);

      const target: PlacementTarget = {
        container: Container.INVENTORY,
        playerIndex: 0,
        gridCoords: [1, 1], // Center at [1, 1], anchor at [0, 0]
      };

      expect(
        canPlaceRegion(
          region,
          target,
          emptyPlayer,
          emptyPlayer,
          PlacementMode.REPLACE,
        ).canPlace,
      ).toBe(true);
    });
  });
});

describe('removeConflicting2hItem', () => {
  const TWO_HANDED_WEAPON: MockItem = {
    id: 125,
    slot: EquipmentSlot.WEAPON,
    stackable: false,
    stats: { twoHanded: true },
  };
  const SHIELD: MockItem = {
    id: 126,
    slot: EquipmentSlot.SHIELD,
    stackable: false,
    stats: { twoHanded: false },
  };
  const ONE_HANDED_WEAPON: MockItem = {
    id: 127,
    slot: EquipmentSlot.WEAPON,
    stackable: false,
    stats: { twoHanded: false },
  };
  const FILLER: MockItem = {
    id: 128,
    slot: undefined,
    stackable: false,
    stats: { twoHanded: false },
  };

  beforeEach(() => {
    mockItems([TWO_HANDED_WEAPON, SHIELD, ONE_HANDED_WEAPON, FILLER]);
  });

  afterEach(() => {
    restoreItems();
  });

  function equipMap(entries: Array<[number, number]>): Map<number, ItemSlot> {
    return new Map<number, ItemSlot>(
      entries.map(([idx, id]) => [
        idx,
        { index: idx, item: { id, quantity: 1 }, comment: null },
      ]),
    );
  }

  function invArray(indices: number[]): ItemSlot[] {
    return indices.map((i) => ({
      index: i,
      item: { id: FILLER.id, quantity: 1 },
      comment: null,
    }));
  }

  it('does nothing if neither weapon nor shield was placed', () => {
    const equipment = equipMap([
      [EquipmentSlot.WEAPON, TWO_HANDED_WEAPON.id],
      [EquipmentSlot.SHIELD, SHIELD.id],
    ]);
    const inventory = invArray([0, 1, 2]);

    const result = removeConflicting2hItem(
      { weapon: false, shield: false },
      equipment,
      inventory,
    );

    expect(equipment.get(EquipmentSlot.WEAPON)?.item?.id).toBe(
      TWO_HANDED_WEAPON.id,
    );
    expect(equipment.get(EquipmentSlot.SHIELD)?.item?.id).toBe(SHIELD.id);
    expect(result).toHaveLength(3);
  });

  it('removes shield to inventory if user placed the weapon', () => {
    const equipment = equipMap([
      [EquipmentSlot.WEAPON, TWO_HANDED_WEAPON.id],
      [EquipmentSlot.SHIELD, SHIELD.id],
    ]);
    const inventory = invArray([0, 1, 2]);

    const result = removeConflicting2hItem(
      { weapon: true, shield: false },
      equipment,
      inventory,
    );

    expect(equipment.get(EquipmentSlot.WEAPON)?.item?.id).toBe(
      TWO_HANDED_WEAPON.id,
    );
    expect(equipment.has(EquipmentSlot.SHIELD)).toBe(false);

    const ids = new Map(result.map((s) => [s.index, s.item!.id]));
    expect(ids.get(3)).toBe(SHIELD.id);
    expect(result).toHaveLength(4);
  });

  it('removes weapon to inventory if user placed the shield', () => {
    const equipment = equipMap([
      [EquipmentSlot.WEAPON, TWO_HANDED_WEAPON.id],
      [EquipmentSlot.SHIELD, SHIELD.id],
    ]);
    const inventory = invArray([]);

    const result = removeConflicting2hItem(
      { weapon: false, shield: true },
      equipment,
      inventory,
    );

    expect(equipment.has(EquipmentSlot.WEAPON)).toBe(false);
    expect(equipment.get(EquipmentSlot.SHIELD)?.item?.id).toBe(SHIELD.id);

    expect(result.find((s) => s.index === 0)?.item?.id).toBe(
      TWO_HANDED_WEAPON.id,
    );
  });

  it('deletes the conflicting item without modifying inventory if inventory is full', () => {
    const fullInv = invArray(Array.from({ length: 28 }, (_, i) => i));
    const equipment = equipMap([
      [EquipmentSlot.WEAPON, TWO_HANDED_WEAPON.id],
      [EquipmentSlot.SHIELD, SHIELD.id],
    ]);

    const result = removeConflicting2hItem(
      { weapon: true, shield: false },
      equipment,
      fullInv,
    );

    expect(equipment.get(EquipmentSlot.WEAPON)?.item?.id).toBe(
      TWO_HANDED_WEAPON.id,
    );
    expect(equipment.has(EquipmentSlot.SHIELD)).toBe(false);

    expect(result).toHaveLength(28);
    expect(result.every((s) => s.item?.id === FILLER.id)).toBe(true);
  });

  it('does nothing when weapon is not two-handed', () => {
    const equipment = equipMap([
      [EquipmentSlot.WEAPON, ONE_HANDED_WEAPON.id],
      [EquipmentSlot.SHIELD, SHIELD.id],
    ]);
    const inventory = invArray([0]);

    const result = removeConflicting2hItem(
      { weapon: true, shield: false },
      equipment,
      inventory,
    );

    expect(equipment.get(EquipmentSlot.WEAPON)?.item?.id).toBe(
      ONE_HANDED_WEAPON.id,
    );
    expect(equipment.get(EquipmentSlot.SHIELD)?.item?.id).toBe(SHIELD.id);
    expect(result).toHaveLength(1);
  });

  it('does nothing when only 2h weapon is present without shield', () => {
    const equipment = equipMap([[EquipmentSlot.WEAPON, TWO_HANDED_WEAPON.id]]);
    const inventory = invArray([]);

    const result = removeConflicting2hItem(
      { weapon: true, shield: false },
      equipment,
      inventory,
    );

    expect(equipment.get(EquipmentSlot.WEAPON)?.item?.id).toBe(
      TWO_HANDED_WEAPON.id,
    );
    expect(equipment.has(EquipmentSlot.SHIELD)).toBe(false);
    expect(result).toHaveLength(0);
  });
});

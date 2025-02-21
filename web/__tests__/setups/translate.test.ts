import { ChallengeType } from '@blert/common';
import { GearSetup, GearSetupPlayer, Spellbook } from '@/setups/setup';
import {
  exportPlayer,
  exportSetup,
  importInventorySetups,
} from '@/setups/translate';

import emptySlotsBlertSetup from './empty-slots.blert.json';
import emptySlotsInventorySetupsSetup from './empty-slots.inventory-setups.json';
import mageBlertSetup from './mage.blert.json';
import mageInventorySetupsSetup from './mage.inventory-setups.json';

describe('inventory-setups', () => {
  describe('export', () => {
    it('should throw an error for invalid player index', () => {
      const setup: GearSetup = {
        title: 'Test Setup',
        description: '',
        challenge: ChallengeType.TOB,
        players: [],
      };

      expect(() => exportSetup(setup, 0, 'inventory-setups')).toThrow(
        'Invalid player index',
      );
    });

    it('should export an empty setup correctly', () => {
      const player: GearSetupPlayer = {
        name: 'Test Player',
        spellbook: Spellbook.STANDARD,
        inventory: { slots: [] },
        equipment: { slots: [] },
        pouch: { slots: [] },
      };

      const exported = JSON.parse(exportPlayer(player, 'inventory-setups'));

      expect(exported).toEqual({
        setup: {
          name: 'Test Player',
          inv: new Array(28).fill(null),
          eq: new Array(14).fill(null),
          rp: new Array(4).fill(null),
          hc: '#FFFF0000',
          sb: 0,
        },
        layout: [],
      });
    });

    it('should handle different spellbooks correctly', () => {
      const spellbooks = [
        { type: Spellbook.STANDARD, expected: 0 },
        { type: Spellbook.ANCIENT, expected: 1 },
        { type: Spellbook.LUNAR, expected: 2 },
        { type: Spellbook.ARCEUUS, expected: 3 },
      ];

      for (const { type, expected } of spellbooks) {
        const player: GearSetupPlayer = {
          name: 'Test Player',
          spellbook: type,
          inventory: { slots: [] },
          equipment: { slots: [] },
          pouch: { slots: [] },
        };

        const exported = JSON.parse(exportPlayer(player, 'inventory-setups'));
        expect(exported.setup.sb).toBe(expected);
      }
    });

    it('should translate a setup correctly', () => {
      const exported = JSON.parse(
        exportPlayer(mageBlertSetup, 'inventory-setups'),
      );
      expect(exported).toEqual(mageInventorySetupsSetup);
    });

    it('should translate a setup with empty slots correctly', () => {
      const exported = JSON.parse(
        exportPlayer(emptySlotsBlertSetup, 'inventory-setups'),
      );
      expect(exported).toEqual(emptySlotsInventorySetupsSetup);
    });
  });

  describe('import', () => {
    it('should import an empty setup correctly', () => {
      const setup = {
        setup: {
          name: 'Test Player',
          inv: new Array(28).fill(null),
          eq: new Array(14).fill(null),
          rp: new Array(4).fill(null),
          hc: '#FFFF0000',
          sb: 0,
        },
        layout: [],
      };

      const imported = importInventorySetups(setup);
      expect(imported).toEqual({
        name: 'Test Player',
        spellbook: Spellbook.STANDARD,
        inventory: { slots: [] },
        equipment: { slots: [] },
        pouch: { slots: [] },
      });
    });

    it('should import inventory slots correctly', () => {
      const setup = {
        setup: {
          name: 'Test Player',
          inv: new Array(28)
            .fill(null)
            .map((_, i) => (i < 3 ? { id: 100 + i } : null)),
          eq: new Array(14).fill(null),
          rp: new Array(4).fill(null),
          hc: '#FFFF0000',
          sb: 0,
        },
        layout: [],
      };

      const imported = importInventorySetups(setup);
      expect(imported.inventory.slots).toEqual([
        { index: 0, item: { id: 100, quantity: 1 }, comment: null },
        { index: 1, item: { id: 101, quantity: 1 }, comment: null },
        { index: 2, item: { id: 102, quantity: 1 }, comment: null },
      ]);
    });

    it('should import equipment slots correctly', () => {
      const setup = {
        setup: {
          name: 'Test Player',
          inv: new Array(28).fill(null),
          eq: new Array(14)
            .fill(null)
            .map((_, i) => (i < 2 ? { id: 200 + i } : null)),
          rp: new Array(4).fill(null),
          hc: '#FFFF0000',
          sb: 0,
        },
        layout: [],
      };

      const imported = importInventorySetups(setup);
      expect(imported.equipment.slots).toEqual([
        { index: 0, item: { id: 200, quantity: 1 }, comment: null },
        { index: 1, item: { id: 201, quantity: 1 }, comment: null },
      ]);
    });

    it('should import rune pouch slots correctly', () => {
      const setup = {
        setup: {
          name: 'Test Player',
          inv: new Array(28).fill(null),
          eq: new Array(14).fill(null),
          rp: new Array(4)
            .fill(null)
            .map((_, i) => (i < 2 ? { id: 300 + i } : null)),
          hc: '#FFFF0000',
          sb: 0,
        },
        layout: [],
      };

      const imported = importInventorySetups(setup);
      expect(imported.pouch.slots).toEqual([
        { index: 0, item: { id: 300, quantity: 1 }, comment: null },
        { index: 1, item: { id: 301, quantity: 1 }, comment: null },
      ]);
    });

    it('should handle different spellbooks correctly', () => {
      const spellbooks = [
        { type: 0, expected: Spellbook.STANDARD },
        { type: 1, expected: Spellbook.ANCIENT },
        { type: 2, expected: Spellbook.LUNAR },
        { type: 3, expected: Spellbook.ARCEUUS },
      ];

      for (const { type, expected } of spellbooks) {
        const setup = {
          setup: {
            name: 'Test Player',
            inv: new Array(28).fill(null),
            eq: new Array(14).fill(null),
            rp: new Array(4).fill(null),
            hc: '#FFFF0000',
            sb: type,
          },
          layout: [],
        };

        const imported = importInventorySetups(setup);
        expect(imported.spellbook).toBe(expected);
      }
    });

    it('should import a complete setup correctly', () => {
      function importAndSort(setup: any) {
        const imported = importInventorySetups(setup);
        imported.equipment.slots.sort((a, b) => a.index - b.index);
        imported.inventory.slots.sort((a, b) => a.index - b.index);
        imported.pouch.slots.sort((a, b) => a.index - b.index);
        return imported;
      }

      const importedMage = importAndSort(mageInventorySetupsSetup);
      expect(importedMage).toEqual(mageBlertSetup);

      const importedEmptySlots = importAndSort(emptySlotsInventorySetupsSetup);
      expect(importedEmptySlots).toEqual(emptySlotsBlertSetup);
    });
  });
});

import { EquipmentSlot } from '@blert/common';

import {
  ExtendedItemCache,
  ExtendedItemData,
} from '@/utils/item-cache/extended';

describe('ExtendedItemCache', () => {
  let cache: ExtendedItemCache;
  const testItems: ExtendedItemData[] = [
    {
      id: 1,
      name: 'Dragon Scimitar',
      equipable: true,
      stackable: false,
      tradeable: true,
      bankNote: false,
      weight: 1.8,
      slot: EquipmentSlot.WEAPON,
      stats: {
        stabAttack: 0,
        slashAttack: 67,
        crushAttack: -2,
        magicAttack: 0,
        rangedAttack: 0,
        stabDefence: 0,
        slashDefence: 0,
        crushDefence: 0,
        magicDefence: 0,
        rangedDefence: 0,
        meleeStrength: 66,
        rangedStrength: 0,
        magicDamage: 0,
        prayer: 0,
        attackSpeed: 4,
        twoHanded: false,
      },
    },
    {
      id: 2,
      name: 'Dragon Boots',
      equipable: true,
      stackable: false,
      tradeable: true,
      bankNote: false,
      weight: 1.0,
      slot: EquipmentSlot.BOOTS,
      stats: {
        stabAttack: 0,
        slashAttack: 0,
        crushAttack: 0,
        magicAttack: -3,
        rangedAttack: -1,
        stabDefence: 16,
        slashDefence: 17,
        crushDefence: 18,
        magicDefence: 0,
        rangedDefence: 0,
        meleeStrength: 4,
        rangedStrength: 0,
        magicDamage: 0,
        prayer: 0,
        attackSpeed: 0,
        twoHanded: false,
      },
    },
    {
      id: 3,
      name: 'Twisted Bow',
      equipable: true,
      stackable: false,
      tradeable: true,
      bankNote: false,
      weight: 1.8,
      slot: EquipmentSlot.WEAPON,
      stats: {
        stabAttack: 0,
        slashAttack: 0,
        crushAttack: 0,
        magicAttack: 0,
        rangedAttack: 70,
        stabDefence: 0,
        slashDefence: 0,
        crushDefence: 0,
        magicDefence: 0,
        rangedDefence: 0,
        meleeStrength: 0,
        rangedStrength: 20,
        magicDamage: 0,
        prayer: 0,
        attackSpeed: 5,
        twoHanded: true,
      },
    },
    {
      id: 4,
      name: 'Super Combat Potion(4)',
      equipable: false,
      stackable: false,
      tradeable: true,
      bankNote: false,
      weight: 0.01,
    },
    {
      id: 5,
      name: 'Armour Potion(4)',
      equipable: false,
      stackable: false,
      tradeable: true,
      bankNote: false,
      weight: 0.01,
    },
    {
      id: 6,
      name: 'Dragon Defender',
      equipable: true,
      stackable: false,
      tradeable: false,
      bankNote: false,
      weight: 0.5,
      slot: EquipmentSlot.SHIELD,
      stats: {
        stabAttack: 25,
        slashAttack: 25,
        crushAttack: 25,
        magicAttack: -3,
        rangedAttack: -2,
        stabDefence: 25,
        slashDefence: 25,
        crushDefence: 25,
        magicDefence: -3,
        rangedDefence: -2,
        meleeStrength: 7,
        rangedStrength: 0,
        magicDamage: 0,
        prayer: 0,
        attackSpeed: 0,
        twoHanded: false,
      },
    },
    {
      id: 7,
      name: 'Toxic Blowpipe',
      equipable: true,
      stackable: false,
      tradeable: true,
      bankNote: false,
      weight: 1.8,
      slot: EquipmentSlot.WEAPON,
      stats: {
        stabAttack: 0,
        slashAttack: 0,
        crushAttack: 0,
        magicAttack: 0,
        rangedAttack: 30,
        stabDefence: 0,
        slashDefence: 0,
        crushDefence: 0,
        magicDefence: 0,
        rangedDefence: 0,
        meleeStrength: 0,
        rangedStrength: 20,
        magicDamage: 0,
        prayer: 0,
        attackSpeed: 3,
        twoHanded: true,
      },
    },
    {
      id: 8,
      name: 'Dragon Bolts',
      equipable: true,
      stackable: true,
      tradeable: true,
      bankNote: false,
      weight: 0.01,
      slot: EquipmentSlot.AMMO,
      stats: {
        stabAttack: 0,
        slashAttack: 0,
        crushAttack: 0,
        magicAttack: 0,
        rangedAttack: 30,
        stabDefence: 0,
        slashDefence: 0,
        crushDefence: 0,
        magicDefence: 0,
        rangedDefence: 0,
        meleeStrength: 0,
        rangedStrength: 20,
        magicDamage: 0,
        prayer: 0,
        attackSpeed: 0,
        twoHanded: false,
      },
    },
    {
      id: 9,
      name: 'Saradomin Brew(4)',
      equipable: false,
      stackable: false,
      tradeable: true,
      bankNote: false,
      weight: 0.01,
    },
    {
      id: 10,
      name: 'Saradomin Brew(3)',
      equipable: false,
      stackable: false,
      tradeable: true,
      bankNote: false,
      weight: 0.01,
    },
  ];

  beforeEach(() => {
    cache = new ExtendedItemCache();
    cache.populate(testItems);
  });

  describe('search', () => {
    it('returns empty array for empty query', () => {
      expect(cache.search('')).toEqual([]);
      expect(cache.search('   ')).toEqual([]);
    });

    it('finds items by exact name match', () => {
      const results = cache.search('Dragon Scimitar');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(1);
    });

    it('finds items by partial word match', () => {
      const results = cache.search('dragon');
      expect(results).toHaveLength(4);
      expect(results.map((item: ExtendedItemData) => item.id).sort()).toEqual([
        1, 2, 6, 8,
      ]);
    });

    it('finds items by prefix match', () => {
      const results = cache.search('drag');
      expect(results).toHaveLength(4);
      expect(results.map((item: ExtendedItemData) => item.id).sort()).toEqual([
        1, 2, 6, 8,
      ]);
    });

    it('matches all words in query', () => {
      const results = cache.search('dragon scim');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(1);
    });

    it('returns items sorted alphabetically', () => {
      const results = cache.search('dragon');
      expect(results.map((item: ExtendedItemData) => item.name)).toEqual([
        'Dragon Bolts',
        'Dragon Boots',
        'Dragon Defender',
        'Dragon Scimitar',
      ]);
    });

    it('respects result limit', () => {
      const results = cache.search('dragon', undefined, 1);
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Dragon Bolts');
    });

    describe('slot filtering', () => {
      it('filters by equipment slot', () => {
        const results = cache.search('', EquipmentSlot.WEAPON);
        expect(results).toHaveLength(3);
        expect(results.map((item: ExtendedItemData) => item.id).sort()).toEqual(
          [1, 3, 7],
        );
      });

      it('combines name search with slot filter', () => {
        const results = cache.search('dragon', EquipmentSlot.WEAPON);
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe(1);
      });

      it('returns empty array for non-existent slot', () => {
        const results = cache.search('dragon', 99 as EquipmentSlot);
        expect(results).toEqual([]);
      });
    });

    it('handles case insensitive search', () => {
      const results = cache.search('DRAGON SCIMITAR');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(1);
    });

    it('ignores extra whitespace', () => {
      const results = cache.search('  dragon   scimitar  ');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(1);
    });

    it('handles non-equipable items', () => {
      const results = cache.search('super combat');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(4);
    });

    describe('spelling variations', () => {
      it('handles American spelling variants', () => {
        const results = cache.search('armour');
        expect(results).toHaveLength(1);
        expect(results[0].name).toBe('Armour Potion(4)');

        const resultsUS = cache.search('armor');
        expect(resultsUS).toHaveLength(1);
        expect(resultsUS[0].name).toBe('Armour Potion(4)');
      });

      it('ignores special characters', () => {
        const results = cache.search('super-combat');
        expect(results).toHaveLength(1);
        expect(results[0].name).toBe('Super Combat Potion(4)');
      });
    });

    describe('fuzzy matching', () => {
      it('handles common typos', () => {
        const results = cache.search('scimter');
        expect(results).toHaveLength(1);
        expect(results[0].name).toBe('Dragon Scimitar');
      });

      it('handles transposed characters', () => {
        const results = cache.search('darong scimitar');
        expect(results).toHaveLength(1);
        expect(results[0].name).toBe('Dragon Scimitar');
      });

      it('handles missing characters', () => {
        const results = cache.search('dragn');
        expect(results.map((item) => item.id).sort()).toEqual([1, 2, 6, 8]);
      });

      it('handles extra characters', () => {
        const results = cache.search('dragonn');
        expect(results.map((item) => item.id).sort()).toEqual([1, 2, 6, 8]);
      });

      it('does not match with too many differences', () => {
        const results = cache.search('completely wrong');
        expect(results).toHaveLength(0);
      });

      it('prefers exact matches over fuzzy matches', () => {
        // "boots" should match exactly before fuzzy matching "bolts".
        const results = cache.search('boots');
        expect(results.map((item) => item.name)).toEqual([
          'Dragon Boots',
          'Dragon Bolts',
        ]);
      });
    });

    it('filters results by predicate', () => {
      const results = cache.search(
        'dragon',
        undefined,
        undefined,
        (item) => item.tradeable && item.equipable,
      );
      expect(results).toHaveLength(3); // Should exclude Dragon Defender (untradeable)
      expect(results.map((item) => item.id).sort()).toEqual([1, 2, 8]);
    });

    it('combines predicate with slot filtering', () => {
      const results = cache.search(
        '',
        EquipmentSlot.WEAPON,
        undefined,
        (item) => item.stats?.twoHanded ?? false,
      );
      expect(results).toHaveLength(2);
      expect(results.map((item) => item.id).sort()).toEqual([3, 7]); // Twisted Bow and Toxic Blowpipe
    });

    it('applies predicate to empty query with slot filter', () => {
      const results = cache.search(
        '',
        EquipmentSlot.WEAPON,
        undefined,
        (item) => !item.stats?.twoHanded,
      );
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(1); // Only Dragon Scimitar
    });

    it('applies predicate to exact matches', () => {
      const results = cache.search(
        'Toxic Blowpipe',
        undefined,
        undefined,
        (item) => (item.stats?.rangedAttack ?? 0) > 25,
      );
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(7);
    });

    it('applies predicate to partial matches', () => {
      const results = cache.search('sara', undefined, undefined, (item) =>
        item.name.endsWith('(4)'),
      );
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(9); // Only Saradomin Brew(4)
    });
  });

  describe('priorities', () => {
    let cache: ExtendedItemCache;

    beforeEach(() => {
      cache = new ExtendedItemCache();
    });

    it('respects manual item priorities', () => {
      const priorities = {
        [testItems[0].id]: 100, // Dragon Scimitar
      };
      cache.populate(testItems, priorities);

      const results = cache.search('weapon');
      expect(results).toHaveLength(3);
      expect(results[0].name).toBe('Dragon Scimitar');
    });

    it('combines priorities from multiple search terms', () => {
      const priorities = {
        [testItems[1].id]: 100, // Dragon boots
      };
      cache.populate(testItems, priorities);

      const results = cache.search('dragon b');
      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('Dragon Boots');
      expect(results[1].name).toBe('Dragon Bolts');
    });

    it('uses highest priority when item matches multiple terms', () => {
      const priorities = {
        [testItems[6].id]: 50, // Toxic Blowpipe
        [testItems[0].id]: 100, // Dragon Scimitar
      };
      cache.populate(testItems, priorities);

      const results = cache.search('weapon');
      expect(results).toHaveLength(3);
      expect(results[0].name).toBe('Dragon Scimitar');
      expect(results[1].name).toBe('Toxic Blowpipe');
    });

    it('falls back to alphabetical order for equal priorities', () => {
      cache.populate(testItems, {});

      const results = cache.search('weapon');
      expect(results).toHaveLength(3);
      expect(results.map((item) => item.name)).toEqual([
        'Dragon Scimitar',
        'Toxic Blowpipe',
        'Twisted Bow',
      ]);
    });
  });

  describe('priorities and aliases', () => {
    beforeEach(() => {
      // Repopulate cache with priorities
      cache = new ExtendedItemCache();
      cache.populate(
        testItems,
        {
          [testItems[0].id]: 100, // Dragon Scimitar
          [testItems[1].id]: 50, // Dragon Boots
        },
        {
          drag: testItems[5].id, // Dragon Defender
          sb: [testItems[8].id, testItems[9].id],
          tbow: testItems[2].id,
        },
      );
    });

    it('prioritizes exact alias matches', () => {
      const results = cache.search('tbow');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Twisted Bow');
    });

    it('prioritizes exact alias matches over fuzzy matches', () => {
      // "drag" is an alias for Dragon Defender
      // This should also find items with "drag" in their name, but Defender should be first
      const results = cache.search('drag');
      expect(results[0].name).toBe('Dragon Defender');
      const ids = new Set(results.map((item) => item.id));
      expect(ids).toEqual(new Set([1, 2, 6, 8]));
    });

    it('combines alias and word matches', () => {
      // "tbow weapon" should match Twisted Bow via alias and weapon slot
      const results = cache.search('tbow weapon');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Twisted Bow');
    });

    it('handles partial alias matches', () => {
      // "tb" should partially match the "tbow" alias
      const results = cache.search('tb');
      expect(results.some((item) => item.name === 'Twisted Bow')).toBe(true);
    });

    it('maintains alias order for multiple items', () => {
      // "sb" alias maps to multiple saradomin brews in order of doses
      const results = cache.search('sb');
      expect(results.length).toBeGreaterThan(1);
      expect(results[0].id).toBe(9);
      expect(results[1].id).toBe(10);
    });
  });
});

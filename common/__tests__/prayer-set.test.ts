import { Prayer, PrayerBook, PrayerSet } from '../prayer-set';

describe('PrayerSet', () => {
  describe('empty', () => {
    it('should create an empty prayer set with normal book', () => {
      const prayerSet = PrayerSet.empty(PrayerBook.NORMAL);
      expect(prayerSet.isEmpty()).toBe(true);
      expect(prayerSet.getBook()).toBe(PrayerBook.NORMAL);
      expect(prayerSet.prayers()).toEqual([]);
    });
  });

  describe('fromRaw', () => {
    it('should create prayer set from raw number', () => {
      const raw = 0;
      const prayerSet = PrayerSet.fromRaw(raw);
      expect(prayerSet.getRaw()).toBe(raw);
    });

    it('should correctly decode prayer bits from raw value', () => {
      // Create a raw value with THICK_SKIN (bit 0) and PROTECT_FROM_MAGIC (bit 16) set
      const raw = (1 << 0) | (1 << 16);
      const prayerSet = PrayerSet.fromRaw(raw);
      expect(prayerSet.has(Prayer.THICK_SKIN)).toBe(true);
      expect(prayerSet.has(Prayer.PROTECT_FROM_MAGIC)).toBe(true);
      expect(prayerSet.has(Prayer.PIETY)).toBe(false);
    });

    it('should correctly decode book from raw value', () => {
      // Book is stored in bits 50-52, shifted by PRAYER_BOOK_SHIFT
      const bookBits = PrayerBook.NORMAL << 50;
      const prayerSet = PrayerSet.fromRaw(bookBits);
      expect(prayerSet.getBook()).toBe(PrayerBook.NORMAL);
    });
  });

  describe('fromPrayers', () => {
    it('should create prayer set with single prayer', () => {
      const prayerSet = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PIETY,
      ]);
      expect(prayerSet.has(Prayer.PIETY)).toBe(true);
      expect(prayerSet.has(Prayer.RIGOUR)).toBe(false);
      expect(prayerSet.getBook()).toBe(PrayerBook.NORMAL);
    });

    it('should create prayer set with multiple prayers', () => {
      const prayerSet = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PIETY,
        Prayer.PROTECT_FROM_MELEE,
        Prayer.RIGOUR,
      ]);
      expect(prayerSet.has(Prayer.PIETY)).toBe(true);
      expect(prayerSet.has(Prayer.PROTECT_FROM_MELEE)).toBe(true);
      expect(prayerSet.has(Prayer.RIGOUR)).toBe(true);
      expect(prayerSet.has(Prayer.PROTECT_FROM_MAGIC)).toBe(false);
    });

    it('should create empty set when no prayers provided', () => {
      const prayerSet = PrayerSet.fromPrayers(PrayerBook.NORMAL, []);
      expect(prayerSet.isEmpty()).toBe(true);
      expect(prayerSet.prayers()).toEqual([]);
    });
  });

  describe('getBook', () => {
    it('should return correct prayer book', () => {
      const prayerSet = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PIETY,
      ]);
      expect(prayerSet.getBook()).toBe(PrayerBook.NORMAL);
    });
  });

  describe('has', () => {
    it('should return true for active prayers', () => {
      const prayerSet = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PIETY,
        Prayer.PROTECT_FROM_MELEE,
      ]);
      expect(prayerSet.has(Prayer.PIETY)).toBe(true);
      expect(prayerSet.has(Prayer.PROTECT_FROM_MELEE)).toBe(true);
    });

    it('should return false for inactive prayers', () => {
      const prayerSet = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PIETY,
      ]);
      expect(prayerSet.has(Prayer.RIGOUR)).toBe(false);
      expect(prayerSet.has(Prayer.PROTECT_FROM_MAGIC)).toBe(false);
    });

    it('should return false for all prayers in empty set', () => {
      const prayerSet = PrayerSet.empty(PrayerBook.NORMAL);
      expect(prayerSet.has(Prayer.PIETY)).toBe(false);
      expect(prayerSet.has(Prayer.THICK_SKIN)).toBe(false);
    });
  });

  describe('isEmpty', () => {
    it('should return true for empty prayer set', () => {
      const prayerSet = PrayerSet.empty(PrayerBook.NORMAL);
      expect(prayerSet.isEmpty()).toBe(true);
    });

    it('should return false for prayer set with prayers', () => {
      const prayerSet = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.THICK_SKIN,
      ]);
      expect(prayerSet.isEmpty()).toBe(false);
    });

    it('should return true after creating from prayers with empty array', () => {
      const prayerSet = PrayerSet.fromPrayers(PrayerBook.NORMAL, []);
      expect(prayerSet.isEmpty()).toBe(true);
    });
  });

  describe('add', () => {
    it('should add prayer to empty set', () => {
      const prayerSet = PrayerSet.empty(PrayerBook.NORMAL);
      const result = prayerSet.add(Prayer.PIETY);
      expect(result).toBe(true);
      expect(prayerSet.has(Prayer.PIETY)).toBe(true);
      expect(prayerSet.isEmpty()).toBe(false);
    });

    it('should add prayer to set with existing prayers', () => {
      const prayerSet = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PIETY,
      ]);
      const result = prayerSet.add(Prayer.RIGOUR);
      expect(result).toBe(true);
      expect(prayerSet.has(Prayer.PIETY)).toBe(true);
      expect(prayerSet.has(Prayer.RIGOUR)).toBe(true);
    });

    it('should handle adding already active prayer', () => {
      const prayerSet = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PIETY,
      ]);
      const result = prayerSet.add(Prayer.PIETY);
      expect(result).toBe(true);
      expect(prayerSet.has(Prayer.PIETY)).toBe(true);
    });

    it('should return false for prayer index >= 50', () => {
      const prayerSet = PrayerSet.empty(PrayerBook.NORMAL);
      const result = prayerSet.add(50 as Prayer);
      expect(result).toBe(false);
      expect(prayerSet.isEmpty()).toBe(true);
    });

    it('should add multiple prayers sequentially', () => {
      const prayerSet = PrayerSet.empty(PrayerBook.NORMAL);
      prayerSet.add(Prayer.PIETY);
      prayerSet.add(Prayer.RIGOUR);
      prayerSet.add(Prayer.PROTECT_FROM_MELEE);
      expect(prayerSet.prayers()).toEqual([
        Prayer.PROTECT_FROM_MELEE,
        Prayer.PIETY,
        Prayer.RIGOUR,
      ]);
    });
  });

  describe('prayers', () => {
    it('should return empty array for empty set', () => {
      const prayerSet = PrayerSet.empty(PrayerBook.NORMAL);
      expect(prayerSet.prayers()).toEqual([]);
    });

    it('should return all active prayers', () => {
      const prayerSet = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PIETY,
        Prayer.PROTECT_FROM_MELEE,
        Prayer.RIGOUR,
      ]);
      const prayers = prayerSet.prayers();
      expect(prayers).toContain(Prayer.PIETY);
      expect(prayers).toContain(Prayer.PROTECT_FROM_MELEE);
      expect(prayers).toContain(Prayer.RIGOUR);
      expect(prayers.length).toBe(3);
    });

    it('should return prayers in ascending order', () => {
      const prayerSet = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.AUGURY,
        Prayer.THICK_SKIN,
        Prayer.PROTECT_FROM_MELEE,
      ]);
      const prayers = prayerSet.prayers();
      expect(prayers).toEqual([
        Prayer.THICK_SKIN,
        Prayer.PROTECT_FROM_MELEE,
        Prayer.AUGURY,
      ]);
    });

    it('should handle all basic prayers', () => {
      const prayerSet = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.THICK_SKIN,
        Prayer.BURST_OF_STRENGTH,
        Prayer.CLARITY_OF_THOUGHT,
      ]);
      expect(prayerSet.prayers()).toEqual([
        Prayer.THICK_SKIN,
        Prayer.BURST_OF_STRENGTH,
        Prayer.CLARITY_OF_THOUGHT,
      ]);
    });
  });

  describe('getRaw', () => {
    it('should return 0 for empty set with normal book', () => {
      const prayerSet = PrayerSet.empty(PrayerBook.NORMAL);
      // Book bits are stored in high bits, but for NORMAL (0) it should be 0
      expect(prayerSet.getRaw()).toBe(0);
    });

    it('should return raw value that can be used to reconstruct set', () => {
      const original = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PIETY,
        Prayer.PROTECT_FROM_MELEE,
      ]);
      const raw = original.getRaw();
      const reconstructed = PrayerSet.fromRaw(raw);
      expect(reconstructed.has(Prayer.PIETY)).toBe(true);
      expect(reconstructed.has(Prayer.PROTECT_FROM_MELEE)).toBe(true);
      expect(reconstructed.prayers()).toEqual(original.prayers());
    });

    it('should preserve book information in raw value', () => {
      const prayerSet = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PIETY,
      ]);
      const raw = prayerSet.getRaw();
      const reconstructed = PrayerSet.fromRaw(raw);
      expect(reconstructed.getBook()).toBe(PrayerBook.NORMAL);
    });
  });

  describe('equals', () => {
    it('should return true for identical prayer sets', () => {
      const set1 = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PIETY,
        Prayer.PROTECT_FROM_MELEE,
      ]);
      const set2 = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PIETY,
        Prayer.PROTECT_FROM_MELEE,
      ]);
      expect(set1.equals(set2)).toBe(true);
    });

    it('should return true for empty sets with same book', () => {
      const set1 = PrayerSet.empty(PrayerBook.NORMAL);
      const set2 = PrayerSet.empty(PrayerBook.NORMAL);
      expect(set1.equals(set2)).toBe(true);
    });

    it('should return false for sets with different prayers', () => {
      const set1 = PrayerSet.fromPrayers(PrayerBook.NORMAL, [Prayer.PIETY]);
      const set2 = PrayerSet.fromPrayers(PrayerBook.NORMAL, [Prayer.RIGOUR]);
      expect(set1.equals(set2)).toBe(false);
    });

    it('should return false when one set has more prayers', () => {
      const set1 = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PIETY,
        Prayer.PROTECT_FROM_MELEE,
      ]);
      const set2 = PrayerSet.fromPrayers(PrayerBook.NORMAL, [Prayer.PIETY]);
      expect(set1.equals(set2)).toBe(false);
    });

    it('should return false when comparing empty set to non-empty set', () => {
      const set1 = PrayerSet.empty(PrayerBook.NORMAL);
      const set2 = PrayerSet.fromPrayers(PrayerBook.NORMAL, [Prayer.PIETY]);
      expect(set1.equals(set2)).toBe(false);
    });

    it('should return true when comparing sets created different ways', () => {
      const set1 = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PIETY,
        Prayer.PROTECT_FROM_MELEE,
      ]);
      const raw = set1.getRaw();
      const set2 = PrayerSet.fromRaw(raw);
      expect(set1.equals(set2)).toBe(true);
    });

    it('should return true when comparing mutated sets with same result', () => {
      const set1 = PrayerSet.empty(PrayerBook.NORMAL);
      set1.add(Prayer.PIETY);
      set1.add(Prayer.RIGOUR);

      const set2 = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PIETY,
        Prayer.RIGOUR,
      ]);

      expect(set1.equals(set2)).toBe(true);
    });

    it('should handle order independence', () => {
      const set1 = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PIETY,
        Prayer.RIGOUR,
        Prayer.PROTECT_FROM_MELEE,
      ]);
      const set2 = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PROTECT_FROM_MELEE,
        Prayer.PIETY,
        Prayer.RIGOUR,
      ]);
      expect(set1.equals(set2)).toBe(true);
    });
  });

  describe('overheads', () => {
    it('should return empty set when no overheads are active', () => {
      const prayerSet = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PIETY,
        Prayer.RIGOUR,
      ]);
      const overheads = prayerSet.overheads();
      expect(overheads.isEmpty()).toBe(true);
    });

    it('should filter to only overhead prayers', () => {
      const prayerSet = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PIETY,
        Prayer.PROTECT_FROM_MELEE,
        Prayer.RIGOUR,
      ]);
      const overheads = prayerSet.overheads();
      expect(overheads.has(Prayer.PROTECT_FROM_MELEE)).toBe(true);
      expect(overheads.has(Prayer.PIETY)).toBe(false);
      expect(overheads.has(Prayer.RIGOUR)).toBe(false);
    });

    it('should include all overhead prayer types', () => {
      const prayerSet = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PROTECT_FROM_MISSILES,
        Prayer.PROTECT_FROM_MAGIC,
        Prayer.PROTECT_FROM_MELEE,
        Prayer.RETRIBUTION,
        Prayer.REDEMPTION,
        Prayer.SMITE,
        Prayer.PIETY,
      ]);
      const overheads = prayerSet.overheads();
      expect(overheads.has(Prayer.PROTECT_FROM_MISSILES)).toBe(true);
      expect(overheads.has(Prayer.PROTECT_FROM_MAGIC)).toBe(true);
      expect(overheads.has(Prayer.PROTECT_FROM_MELEE)).toBe(true);
      expect(overheads.has(Prayer.RETRIBUTION)).toBe(true);
      expect(overheads.has(Prayer.REDEMPTION)).toBe(true);
      expect(overheads.has(Prayer.SMITE)).toBe(true);
      expect(overheads.has(Prayer.PIETY)).toBe(false);
    });

    it('should preserve book information', () => {
      const prayerSet = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PROTECT_FROM_MELEE,
      ]);
      const overheads = prayerSet.overheads();
      expect(overheads.getBook()).toBe(PrayerBook.NORMAL);
    });
  });

  describe('round-trip conversions', () => {
    it('should convert to raw and back without loss', () => {
      const original = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PIETY,
        Prayer.PROTECT_FROM_MELEE,
        Prayer.RIGOUR,
        Prayer.AUGURY,
      ]);
      const raw = original.getRaw();
      const reconstructed = PrayerSet.fromRaw(raw);
      expect(reconstructed.prayers()).toEqual(original.prayers());
      expect(reconstructed.getBook()).toBe(original.getBook());
    });

    it('should handle edge case prayers', () => {
      const original = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.THICK_SKIN, // First prayer (0)
        Prayer.AUGURY, // Last defined prayer (28)
      ]);
      const raw = original.getRaw();
      const reconstructed = PrayerSet.fromRaw(raw);
      expect(reconstructed.prayers()).toEqual([
        Prayer.THICK_SKIN,
        Prayer.AUGURY,
      ]);
    });
  });

  describe('edge cases', () => {
    it('should handle maximum valid prayer index', () => {
      const prayerSet = PrayerSet.empty(PrayerBook.NORMAL);
      const result = prayerSet.add(49 as Prayer);
      expect(result).toBe(true);
      expect(prayerSet.has(49 as Prayer)).toBe(true);
    });

    it('should handle prayer set with all prayers active', () => {
      const allPrayers = Array.from({ length: 29 }, (_, i) => i as Prayer);
      const prayerSet = PrayerSet.fromPrayers(PrayerBook.NORMAL, allPrayers);
      expect(prayerSet.prayers().length).toBe(29);
      allPrayers.forEach((prayer) => {
        expect(prayerSet.has(prayer)).toBe(true);
      });
    });

    it('should maintain immutability when getting overheads', () => {
      const original = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
        Prayer.PIETY,
        Prayer.PROTECT_FROM_MELEE,
      ]);
      const overheads = original.overheads();
      expect(original.has(Prayer.PIETY)).toBe(true);
      expect(original.has(Prayer.PROTECT_FROM_MELEE)).toBe(true);
      expect(overheads.has(Prayer.PIETY)).toBe(false);
      expect(overheads.has(Prayer.PROTECT_FROM_MELEE)).toBe(true);
    });
  });
});
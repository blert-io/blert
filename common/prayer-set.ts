export type RawPrayerSet = number;

export enum PrayerBook {
  NORMAL = 0,
}

export enum Prayer {
  THICK_SKIN = 0,
  BURST_OF_STRENGTH = 1,
  CLARITY_OF_THOUGHT = 2,
  SHARP_EYE = 3,
  MYSTIC_WILL = 4,
  ROCK_SKIN = 5,
  SUPERHUMAN_STRENGTH = 6,
  IMPROVED_REFLEXES = 7,
  RAPID_RESTORE = 8,
  RAPID_HEAL = 9,
  PROTECT_ITEM = 10,
  HAWK_EYE = 11,
  MYSTIC_LORE = 12,
  STEEL_SKIN = 13,
  ULTIMATE_STRENGTH = 14,
  INCREDIBLE_REFLEXES = 15,
  PROTECT_FROM_MAGIC = 16,
  PROTECT_FROM_MISSILES = 17,
  PROTECT_FROM_MELEE = 18,
  EAGLE_EYE = 19,
  MYSTIC_MIGHT = 20,
  RETRIBUTION = 21,
  REDEMPTION = 22,
  SMITE = 23,
  PRESERVE = 24,
  CHIVALRY = 25,
  PIETY = 26,
  RIGOUR = 27,
  AUGURY = 28,
}

// Javascript bitwise operators are limited to 32 bits so this has to be
// implemented manually.
function shift(value: number, shift: number): number {
  return Math.floor(value * Math.pow(2, shift));
}

export class PrayerSet {
  /** All 32 bits of the low word represent active prayers. */
  private lowWord: number;

  /**
   * The high word is limited to 21 bits because JS numbers are all doubles.
   * Of these, 18 represent active prayers, and the top 3 store the prayer book.
   */
  private highWord: number;

  private static readonly PRAYER_BOOK_SHIFT = 18;
  private static readonly PRAYER_BOOK_MASK = 0b111;

  public static empty(book: PrayerBook): PrayerSet {
    const high =
      (book & PrayerSet.PRAYER_BOOK_MASK) << PrayerSet.PRAYER_BOOK_SHIFT;
    return new PrayerSet(0, high);
  }

  public static fromRaw(raw: RawPrayerSet): PrayerSet {
    const lowWord = raw | 0;
    const highWord = shift(raw, -32);
    return new PrayerSet(lowWord, highWord);
  }

  private constructor(low: number, high: number) {
    this.lowWord = low;
    this.highWord = high;
  }

  public getBook(): PrayerBook {
    return (
      (this.highWord >> PrayerSet.PRAYER_BOOK_SHIFT) &
      PrayerSet.PRAYER_BOOK_MASK
    );
  }

  public has(prayer: Prayer): boolean {
    if (prayer < 32) {
      return (this.lowWord & (1 << prayer)) !== 0;
    }
    if (prayer < 50) {
      return (this.highWord & (1 << (prayer - 32))) !== 0;
    }
    return false;
  }

  public add(prayer: Prayer): boolean {
    if (prayer < 32) {
      this.lowWord |= 1 << prayer;
      return true;
    }
    if (prayer < 50) {
      this.highWord |= 1 << (prayer - 32);
      return true;
    }
    return false;
  }

  public prayers(): Prayer[] {
    const prayers: Prayer[] = [];
    for (let i = 0; i < 32; i++) {
      if ((this.lowWord & (1 << i)) !== 0) {
        prayers.push(i);
      }
    }
    for (let i = 0; i < 18; i++) {
      if ((this.highWord & (1 << i)) !== 0) {
        prayers.push(i + 32);
      }
    }
    return prayers;
  }

  public getRaw(): RawPrayerSet {
    return shift(this.highWord, 32) + this.lowWord;
  }
}

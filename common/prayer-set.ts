/**
 * Raw representation of a prayer set as a number.
 * Encodes both the prayer book and active prayers in a compact format.
 */
export type RawPrayerSet = number;

/**
 * Available prayer books in Old School RuneScape.
 */
export enum PrayerBook {
  NORMAL = 0,
}

/**
 * Individual prayers available in the normal prayer book.
 * Each prayer is represented by its index in the prayer list.
 */
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

export class PrayerSet {
  private static readonly PRAYER_BOOK_SHIFT = BigInt(50);
  private static readonly PRAYER_BOOK_MASK = BigInt(0b111);

  private static readonly NORMAL_OVERHEADS_MASK: bigint = BigInt(
    PrayerSet.fromPrayers(PrayerBook.NORMAL, [
      Prayer.PROTECT_FROM_MISSILES,
      Prayer.PROTECT_FROM_MAGIC,
      Prayer.PROTECT_FROM_MELEE,
      Prayer.RETRIBUTION,
      Prayer.REDEMPTION,
      Prayer.SMITE,
    ]).getRaw(),
  );

  /**
   * Creates an empty prayer set for the given prayer book.
   * @param book The prayer book to use.
   * @returns A new empty prayer set.
   */
  public static empty(book: PrayerBook): PrayerSet {
    return new PrayerSet(
      (BigInt(book) & PrayerSet.PRAYER_BOOK_MASK) <<
        PrayerSet.PRAYER_BOOK_SHIFT,
    );
  }

  /**
   * Creates a prayer set from its raw numeric representation.
   * @param raw The raw prayer set value encoding both book and active prayers.
   * @returns A new prayer set decoded from the raw value.
   */
  public static fromRaw(raw: RawPrayerSet): PrayerSet {
    return new PrayerSet(BigInt(raw));
  }

  /**
   * Returns a prayer set with the given prayers in the given book.
   * @param book The prayer book to use.
   * @param prayers The prayers to add to the prayer set.
   * @returns The prayer set.
   */
  public static fromPrayers(book: PrayerBook, prayers: Prayer[]): PrayerSet {
    const bookBits = BigInt(book) & PrayerSet.PRAYER_BOOK_MASK;
    const prayerBits = prayers.reduce(
      (acc, prayer) => acc | (BigInt(1) << BigInt(prayer)),
      BigInt(0),
    );
    return new PrayerSet(
      (bookBits << PrayerSet.PRAYER_BOOK_SHIFT) | prayerBits,
    );
  }

  private constructor(private value: bigint) {}

  /**
   * Gets the prayer book associated with this prayer set.
   * @returns The prayer book.
   */
  public getBook(): PrayerBook {
    const book =
      (this.value >> PrayerSet.PRAYER_BOOK_SHIFT) & PrayerSet.PRAYER_BOOK_MASK;
    return Number(book) as PrayerBook;
  }

  /**
   * Checks if a specific prayer is active in this set.
   *
   * @param prayer The prayer to check.
   * @returns True if the prayer is active, false otherwise.
   */
  public has(prayer: Prayer): boolean {
    const prayerBit = BigInt(1) << BigInt(prayer);
    return (this.value & prayerBit) !== BigInt(0);
  }

  /**
   * Checks if this prayer set has no active prayers.
   * @returns True if no prayers are active, false otherwise.
   */
  public isEmpty(): boolean {
    return (
      (this.value &
        ~(PrayerSet.PRAYER_BOOK_MASK << PrayerSet.PRAYER_BOOK_SHIFT)) ===
      BigInt(0)
    );
  }

  /**
   * Adds a prayer to this set.
   *
   * @param prayer The prayer to add.
   * @returns True if the prayer was added successfully, false if the prayer is
   * invalid.
   */
  public add(prayer: Prayer): boolean {
    if ((prayer as number) >= 50) {
      return false;
    }
    const prayerBit = BigInt(1) << BigInt(prayer);
    this.value |= prayerBit;
    return true;
  }

  /**
   * Gets all active prayers in this set.
   * @returns An array of all active prayers, in their in-game order.
   */
  public prayers(): Prayer[] {
    const prayers: Prayer[] = [];
    for (let i = 0; i < 50; i++) {
      const prayer = BigInt(1) << BigInt(i);
      if ((this.value & prayer) !== BigInt(0)) {
        prayers.push(i);
      }
    }
    return prayers;
  }

  /**
   * Gets the raw numeric representation of this prayer set.
   * @returns The raw value encoding both the prayer book and active prayers.
   */
  public getRaw(): RawPrayerSet {
    return Number(this.value);
  }

  /**
   * Checks if this prayer set is equal to another prayer set.
   * Two prayer sets are equal if they have the same prayer book and the same
   * active prayers.
   * @param other The prayer set to compare with.
   * @returns True if the prayer sets are equal, false otherwise.
   */
  public equals(other: PrayerSet): boolean {
    return this.value === other.value;
  }

  /**
   * @returns A new prayer set containing only the overhead prayers active in
   * this one.
   */
  public overheads(): PrayerSet {
    switch (this.getBook()) {
      case PrayerBook.NORMAL:
        return new PrayerSet(this.value & PrayerSet.NORMAL_OVERHEADS_MASK);
      default:
        return PrayerSet.empty(this.getBook());
    }
  }
}

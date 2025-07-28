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

export class PrayerSet {
  private static readonly PRAYER_BOOK_SHIFT = BigInt(50);
  private static readonly PRAYER_BOOK_MASK = BigInt(0b111);

  public static empty(book: PrayerBook): PrayerSet {
    return new PrayerSet(
      (BigInt(book) & PrayerSet.PRAYER_BOOK_MASK) <<
        PrayerSet.PRAYER_BOOK_SHIFT,
    );
  }

  public static fromRaw(raw: RawPrayerSet): PrayerSet {
    return new PrayerSet(BigInt(raw));
  }

  private constructor(private value: bigint) {}

  public getBook(): PrayerBook {
    const book =
      (this.value >> PrayerSet.PRAYER_BOOK_SHIFT) & PrayerSet.PRAYER_BOOK_MASK;
    return Number(book) as PrayerBook;
  }

  public has(prayer: Prayer): boolean {
    const prayerBit = BigInt(1) << BigInt(prayer);
    return (this.value & prayerBit) !== BigInt(0);
  }

  public isEmpty(): boolean {
    return (
      (this.value &
        ~(PrayerSet.PRAYER_BOOK_MASK << PrayerSet.PRAYER_BOOK_SHIFT)) ===
      BigInt(0)
    );
  }

  public add(prayer: Prayer): boolean {
    if (prayer >= 50) {
      return false;
    }
    const prayerBit = BigInt(1) << BigInt(prayer);
    this.value |= prayerBit;
    return true;
  }

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

  public getRaw(): RawPrayerSet {
    return Number(this.value);
  }
}

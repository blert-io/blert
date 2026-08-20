//! Prayer set handling.
#![expect(dead_code)]

/// Available prayer books.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrayerBook {
    Normal = 0,
}

/// Prayers of the normal book, by their index in the prayer list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u64)]
pub enum Prayer {
    ThickSkin = 0,
    BurstOfStrength = 1,
    ClarityOfThought = 2,
    SharpEye = 3,
    MysticWill = 4,
    RockSkin = 5,
    SuperhumanStrength = 6,
    ImprovedReflexes = 7,
    RapidRestore = 8,
    RapidHeal = 9,
    ProtectItem = 10,
    HawkEye = 11,
    MysticLore = 12,
    SteelSkin = 13,
    UltimateStrength = 14,
    IncredibleReflexes = 15,
    ProtectFromMagic = 16,
    ProtectFromMissiles = 17,
    ProtectFromMelee = 18,
    EagleEye = 19,
    MysticMight = 20,
    Retribution = 21,
    Redemption = 22,
    Smite = 23,
    Preserve = 24,
    Chivalry = 25,
    Piety = 26,
    Rigour = 27,
    Augury = 28,
}

impl Prayer {
    const fn bit(self) -> u64 {
        1 << self as u64
    }
}

/// A set of active prayers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PrayerSet(u64);

impl PrayerSet {
    const BOOK_SHIFT: u32 = 50;
    const BOOK_MASK: u64 = 0b111;
    const BOOK_BITS: u64 = Self::BOOK_MASK << Self::BOOK_SHIFT;

    const NORMAL_OVERHEADS: u64 = Prayer::ProtectFromMagic.bit()
        | Prayer::ProtectFromMissiles.bit()
        | Prayer::ProtectFromMelee.bit()
        | Prayer::Retribution.bit()
        | Prayer::Redemption.bit()
        | Prayer::Smite.bit();

    /// Creates a set without active prayers.
    pub const fn empty(book: PrayerBook) -> PrayerSet {
        PrayerSet((book as u64 & Self::BOOK_MASK) << Self::BOOK_SHIFT)
    }

    /// Unpacks a prayer set from its raw representation.
    pub const fn from_raw(raw: u64) -> PrayerSet {
        PrayerSet(raw)
    }

    /// Packs the prayer set into its raw representation.
    pub const fn to_raw(self) -> u64 {
        self.0
    }

    /// Returns true if no prayers are active.
    pub const fn is_empty(self) -> bool {
        self.0 & !Self::BOOK_BITS == 0
    }

    /// Returns the set of overhead prayers active in this set.
    pub const fn overheads(self) -> PrayerSet {
        let book = self.0 & Self::BOOK_BITS;
        if book >> Self::BOOK_SHIFT == PrayerBook::Normal as u64 {
            PrayerSet(self.0 & (Self::NORMAL_OVERHEADS | Self::BOOK_BITS))
        } else {
            PrayerSet(book)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_stores_only_book() {
        assert!(PrayerSet::empty(PrayerBook::Normal).is_empty());
        assert_eq!(PrayerSet::empty(PrayerBook::Normal).to_raw(), 0);
    }

    #[test]
    fn raw_round_trips() {
        let raw = Prayer::ProtectFromMissiles.bit() | Prayer::Piety.bit();
        assert_eq!(PrayerSet::from_raw(raw).to_raw(), raw);
        assert!(!PrayerSet::from_raw(raw).is_empty());
    }

    #[test]
    fn overheads_returns_only_overhead_prayers() {
        let set = PrayerSet::from_raw(Prayer::ProtectFromMissiles.bit() | Prayer::Piety.bit());
        assert_eq!(
            set.overheads(),
            PrayerSet::from_raw(Prayer::ProtectFromMissiles.bit())
        );
        assert!(
            PrayerSet::from_raw(Prayer::Piety.bit())
                .overheads()
                .is_empty()
        );
    }
}

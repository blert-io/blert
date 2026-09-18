//! OSRS item definitions.

pub use crate::proto::event::player::EquipmentSlot;

pub(crate) const EQUIPMENT_SLOTS: usize = EquipmentSlot::Quiver as usize + 1;

/// A stack of an item.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Item {
    pub id: u32,
    pub quantity: u32,
}

/// A space in some container, such as a player's inventory or equipment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Slot(pub u8);

/// An `ItemDelta` represents a change in the quantity of an item in a slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemDelta {
    Add(Slot, Item),
    Remove(Slot, Item),
}

impl ItemDelta {
    const QUANTITY_MASK: u64 = 0x0000_0000_7fff_ffff;
    const ADDED_BIT: u64 = 1 << 31;
    const ID_SHIFT: u64 = 32;
    const ID_MASK: u64 = 0xffff;
    const SLOT_SHIFT: u64 = 48;
    const SLOT_MASK: u64 = 0x1f;

    /// Parses an item delta from its packed numeric representation.
    #[must_use]
    pub fn parse(raw_delta: u64) -> Self {
        let slot = (raw_delta >> Self::SLOT_SHIFT & Self::SLOT_MASK) as u8;
        let item = Item {
            id: (raw_delta >> Self::ID_SHIFT & Self::ID_MASK) as u32,
            quantity: (raw_delta & Self::QUANTITY_MASK) as u32,
        };

        if raw_delta & Self::ADDED_BIT != 0 {
            Self::Add(Slot(slot), item)
        } else {
            Self::Remove(Slot(slot), item)
        }
    }

    /// Packs the delta into its numeric representation.
    #[must_use]
    pub fn to_raw(self) -> u64 {
        let (added, slot, item) = match self {
            Self::Add(slot, item) => (true, slot, item),
            Self::Remove(slot, item) => (false, slot, item),
        };
        let mut raw = u64::from(item.quantity) & Self::QUANTITY_MASK;
        if added {
            raw |= Self::ADDED_BIT;
        }
        raw |= (u64::from(item.id) & Self::ID_MASK) << Self::ID_SHIFT;
        raw |= (u64::from(slot.0) & Self::SLOT_MASK) << Self::SLOT_SHIFT;
        raw
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_unpacks_an_added_item() {
        assert_eq!(
            ItemDelta::parse(0x0005_6710_8000_0001),
            ItemDelta::Add(
                Slot(5),
                Item {
                    id: 26384,
                    quantity: 1
                }
            ),
        );
    }

    #[test]
    fn parse_unpacks_a_removed_item() {
        assert_eq!(
            ItemDelta::parse(0x0000_2d91_0000_004b),
            ItemDelta::Remove(
                Slot(0),
                Item {
                    id: 11665,
                    quantity: 75
                }
            ),
        );
    }

    #[test]
    fn parse_masks_the_slot_to_five_bits() {
        assert_eq!(
            ItemDelta::parse(0x00ff_6710_8000_0001),
            ItemDelta::Add(
                Slot(31),
                Item {
                    id: 26384,
                    quantity: 1
                }
            ),
        );
    }

    #[test]
    fn to_raw_packs_the_parsed_representation() {
        assert_eq!(
            ItemDelta::Add(
                Slot(5),
                Item {
                    id: 26384,
                    quantity: 1
                }
            )
            .to_raw(),
            0x0005_6710_8000_0001,
        );
        assert_eq!(
            ItemDelta::Remove(
                Slot(0),
                Item {
                    id: 11665,
                    quantity: 75
                }
            )
            .to_raw(),
            0x0000_2d91_0000_004b,
        );
    }

    #[test]
    fn slot_converts_to_equipment_slot() {
        assert_eq!(EquipmentSlot::try_from(Slot(0)), Ok(EquipmentSlot::Head));
        assert_eq!(EquipmentSlot::try_from(Slot(5)), Ok(EquipmentSlot::Torso));
        assert_eq!(EquipmentSlot::try_from(Slot(11)), Ok(EquipmentSlot::Quiver));
        assert!(EquipmentSlot::try_from(Slot(12)).is_err());
        assert!(EquipmentSlot::try_from(Slot(31)).is_err());
    }
}

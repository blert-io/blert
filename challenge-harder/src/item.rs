//! Game item handling.

use crate::proto::event::player::EquipmentSlot;

/// OSRS item IDs.
pub mod id {
    #![allow(dead_code)]
    include!(concat!(env!("OUT_DIR"), "/item_id.rs"));
}

/// An `ItemDelta` represents a change in the quantity of an item in some
/// container, such as a player's inventory or equipment.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum ItemDelta {
    Add(EquipmentSlot, i32, i32),
    Remove(EquipmentSlot, i32, i32),
}

impl ItemDelta {
    const QUANTITY_MASK: u64 = 0x0000_0000_7fff_ffff;
    const ADDED_BIT: u64 = 1 << 31;
    const ID_SHIFT: u64 = 32;
    const ID_MASK: u64 = 0xffff;
    const SLOT_SHIFT: u64 = 48;
    const SLOT_MASK: u64 = 0x1f;

    /// Parses an item delta from its packed numeric representation.
    pub fn parse(raw_delta: u64) -> Result<Self, &'static str> {
        let slot = i32::try_from(raw_delta >> Self::SLOT_SHIFT & Self::SLOT_MASK)
            .ok()
            .and_then(|raw| EquipmentSlot::try_from(raw).ok())
            .ok_or("invalid slot")?;
        let id = (raw_delta >> Self::ID_SHIFT & Self::ID_MASK) as i32;
        let quantity = (raw_delta & Self::QUANTITY_MASK) as i32;

        if raw_delta & Self::ADDED_BIT != 0 {
            Ok(Self::Add(slot, id, quantity))
        } else {
            Ok(Self::Remove(slot, id, quantity))
        }
    }

    /// Packs the delta into its numeric representation.
    #[cfg_attr(not(test), expect(dead_code))]
    #[expect(clippy::cast_sign_loss)]
    pub fn to_raw(self) -> u64 {
        let (added, slot, id, quantity) = match self {
            Self::Add(slot, id, quantity) => (true, slot, id, quantity),
            Self::Remove(slot, id, quantity) => (false, slot, id, quantity),
        };
        let mut raw = quantity as u64 & Self::QUANTITY_MASK;
        if added {
            raw |= Self::ADDED_BIT;
        }
        raw |= (id as u64 & Self::ID_MASK) << Self::ID_SHIFT;
        raw |= (slot as u64 & Self::SLOT_MASK) << Self::SLOT_SHIFT;
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
            Ok(ItemDelta::Add(EquipmentSlot::Torso, 26384, 1)),
        );
    }

    #[test]
    fn parse_unpacks_a_removed_item() {
        assert_eq!(
            ItemDelta::parse(0x0000_2d91_0000_004b),
            Ok(ItemDelta::Remove(EquipmentSlot::Head, 11665, 75)),
        );
    }

    #[test]
    fn parse_rejects_an_invalid_slot() {
        assert_eq!(ItemDelta::parse(0x001f_6710_8000_0001), Err("invalid slot"));
    }

    #[test]
    fn to_raw_packs_the_parsed_representation() {
        assert_eq!(
            ItemDelta::Add(EquipmentSlot::Torso, 26384, 1).to_raw(),
            0x0005_6710_8000_0001,
        );
        assert_eq!(
            ItemDelta::Remove(EquipmentSlot::Head, 11665, 75).to_raw(),
            0x0000_2d91_0000_004b,
        );
    }

    #[test]
    fn generated_ids_match_known_items() {
        assert_eq!(id::BANDOS_CHESTPLATE, 11832);
        assert_eq!(id::TORVA_PLATEBODY, 26384);
        assert_eq!(id::SANGUINE_TORVA_PLATEBODY, 28256);
        assert_eq!(id::OATHPLATE_CHEST, 30753);
        assert_eq!(id::RADIANT_OATHPLATE_CHEST, 30779);
        assert_eq!(id::VOID_MELEE_HELM, 11665);
        assert_eq!(id::VOID_MELEE_HELM_OR, 26477);
    }
}

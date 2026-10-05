//! Generated proto bindings.

// Disable lints for generated code.
#![allow(
    clippy::doc_markdown,
    clippy::must_use_candidate,
    clippy::too_many_lines
)]

include!(concat!(env!("OUT_DIR"), "/blert.rs"));

mod definitions {
    // Distinct attacks routinely share a cooldown.
    #![allow(clippy::match_same_arms)]
    include!(concat!(env!("OUT_DIR"), "/attack_definitions.rs"));
    include!(concat!(env!("OUT_DIR"), "/spell_definitions.rs"));
}

impl From<crate::Point> for Coords {
    fn from(p: crate::Point) -> Coords {
        Coords {
            x: i32::from(p.0),
            y: i32::from(p.1),
        }
    }
}

impl TryFrom<Coords> for crate::Point {
    type Error = std::num::TryFromIntError;

    fn try_from(c: Coords) -> Result<crate::Point, Self::Error> {
        Ok(crate::Point(u16::try_from(c.x)?, u16::try_from(c.y)?))
    }
}

impl PlayerAttack {
    pub fn cooldown(self) -> crate::Ticks {
        // Every constructible `PlayerAttack` has a defined cooldown.
        crate::Ticks(definitions::cooldown(self as i32).unwrap_or(0))
    }

    /// Returns the attack's combat style.
    pub fn style(self) -> Option<crate::CombatStyle> {
        definitions::style(self as i32)
    }
}

impl PlayerSpell {
    /// Returns whether the spell is cast on a target.
    pub fn is_targeted(self) -> bool {
        definitions::is_targeted(self as i32)
    }
}

impl TryFrom<crate::Slot> for event::player::EquipmentSlot {
    type Error = prost::UnknownEnumValue;

    fn try_from(value: crate::Slot) -> Result<Self, Self::Error> {
        Self::try_from(i32::from(value.0))
    }
}

impl From<event::attack_style::Style> for crate::CombatStyle {
    fn from(style: event::attack_style::Style) -> Self {
        match style {
            event::attack_style::Style::Melee => Self::Melee,
            event::attack_style::Style::Range => Self::Ranged,
            event::attack_style::Style::Mage => Self::Magic,
        }
    }
}

impl From<event::npc::nylo::Style> for crate::CombatStyle {
    fn from(style: event::npc::nylo::Style) -> Self {
        match style {
            event::npc::nylo::Style::Melee => Self::Melee,
            event::npc::nylo::Style::Range => Self::Ranged,
            event::npc::nylo::Style::Mage => Self::Magic,
        }
    }
}

impl From<crate::CombatStyle> for event::attack_style::Style {
    fn from(style: crate::CombatStyle) -> Self {
        match style {
            crate::CombatStyle::Melee => Self::Melee,
            crate::CombatStyle::Ranged => Self::Range,
            crate::CombatStyle::Magic => Self::Mage,
        }
    }
}

impl From<crate::CombatStyle> for event::npc::nylo::Style {
    fn from(style: crate::CombatStyle) -> Self {
        match style {
            crate::CombatStyle::Melee => Self::Melee,
            crate::CombatStyle::Ranged => Self::Range,
            crate::CombatStyle::Magic => Self::Mage,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stage_deserializes_from_proto_number() {
        assert_eq!(
            serde_json::from_str::<Stage>("15").unwrap(),
            Stage::TobVerzik
        );
        assert!(serde_json::from_str::<Stage>("9").is_err());
    }
}

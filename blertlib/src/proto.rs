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

impl PlayerAttack {
    pub fn cooldown(self) -> crate::Ticks {
        // Every constructible `PlayerAttack` has a defined cooldown.
        crate::Ticks(definitions::cooldown(self as i32).unwrap_or(0))
    }
}

impl PlayerSpell {
    /// Returns whether the spell is cast on a target.
    pub fn is_targeted(self) -> bool {
        definitions::is_targeted(self as i32)
    }
}

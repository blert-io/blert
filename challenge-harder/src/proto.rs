//! Generated proto bindings.

// Disable lints for generated code.
#![allow(
    dead_code,
    clippy::doc_markdown,
    clippy::enum_variant_names,
    clippy::large_enum_variant,
    clippy::too_many_lines,
    clippy::trivially_copy_pass_by_ref
)]

include!(concat!(env!("OUT_DIR"), "/blert.rs"));

mod definitions {
    // Distinct attacks routinely share a cooldown.
    #![allow(clippy::match_same_arms)]
    include!(concat!(env!("OUT_DIR"), "/attack_definitions.rs"));
}

impl From<(i32, i32)> for Coords {
    fn from((x, y): (i32, i32)) -> Coords {
        Coords { x, y }
    }
}

impl PlayerAttack {
    pub fn cooldown(self) -> u32 {
        // Every constructible `PlayerAttack` has a defined cooldown.
        definitions::cooldown(self as i32).unwrap_or(0)
    }
}

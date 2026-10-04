//! OSRS NPC definitions.

use crate::CombatStyle;

mod generated {
    #![allow(clippy::manual_range_patterns, clippy::too_many_lines)]
    use super::Definition;
    include!(concat!(env!("OUT_DIR"), "/npc_definitions.rs"));
}

pub use generated::{definition, id};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Definition {
    pub full_name: &'static str,
    pub short_name: &'static str,
    pub canonical_id: u32,
    pub size: u16,
}

#[must_use]
pub fn is_maiden(npc_id: u32) -> bool {
    matches!(
        npc_id,
        id::MAIDEN_ENTRY
            | id::MAIDEN_ENTRY_10815
            | id::MAIDEN_ENTRY_10816
            | id::MAIDEN_ENTRY_10817
            | id::MAIDEN_ENTRY_10818
            | id::MAIDEN_ENTRY_10819
            | id::MAIDEN_REGULAR
            | id::MAIDEN_REGULAR_8361
            | id::MAIDEN_REGULAR_8362
            | id::MAIDEN_REGULAR_8363
            | id::MAIDEN_REGULAR_8364
            | id::MAIDEN_REGULAR_8365
            | id::MAIDEN_HARD
            | id::MAIDEN_HARD_10823
            | id::MAIDEN_HARD_10824
            | id::MAIDEN_HARD_10825
            | id::MAIDEN_HARD_10826
            | id::MAIDEN_HARD_10827
    )
}

#[must_use]
pub fn is_maiden_matomenos(npc_id: u32) -> bool {
    matches!(
        npc_id,
        id::MAIDEN_MATOMENOS_ENTRY | id::MAIDEN_MATOMENOS_REGULAR | id::MAIDEN_MATOMENOS_HARD
    )
}

#[must_use]
pub fn is_bloat(npc_id: u32) -> bool {
    matches!(npc_id, id::BLOAT_ENTRY | id::BLOAT_REGULAR | id::BLOAT_HARD)
}

#[must_use]
pub fn is_nylocas(npc_id: u32) -> bool {
    matches!(
        npc_id,
        id::NYLOCAS_ISCHYROS_SMALL_ENTRY
            | id::NYLOCAS_ISCHYROS_SMALL_REGULAR
            | id::NYLOCAS_ISCHYROS_SMALL_HARD
            | id::NYLOCAS_ISCHYROS_SMALL_AGGRO_ENTRY
            | id::NYLOCAS_ISCHYROS_SMALL_AGGRO_REGULAR
            | id::NYLOCAS_ISCHYROS_SMALL_AGGRO_HARD
            | id::NYLOCAS_ISCHYROS_BIG_ENTRY
            | id::NYLOCAS_ISCHYROS_BIG_REGULAR
            | id::NYLOCAS_ISCHYROS_BIG_HARD
            | id::NYLOCAS_ISCHYROS_BIG_AGGRO_ENTRY
            | id::NYLOCAS_ISCHYROS_BIG_AGGRO_REGULAR
            | id::NYLOCAS_ISCHYROS_BIG_AGGRO_HARD
            | id::NYLOCAS_TOXOBOLOS_SMALL_ENTRY
            | id::NYLOCAS_TOXOBOLOS_SMALL_REGULAR
            | id::NYLOCAS_TOXOBOLOS_SMALL_HARD
            | id::NYLOCAS_TOXOBOLOS_SMALL_AGGRO_ENTRY
            | id::NYLOCAS_TOXOBOLOS_SMALL_AGGRO_REGULAR
            | id::NYLOCAS_TOXOBOLOS_SMALL_AGGRO_HARD
            | id::NYLOCAS_TOXOBOLOS_BIG_ENTRY
            | id::NYLOCAS_TOXOBOLOS_BIG_REGULAR
            | id::NYLOCAS_TOXOBOLOS_BIG_HARD
            | id::NYLOCAS_TOXOBOLOS_BIG_AGGRO_ENTRY
            | id::NYLOCAS_TOXOBOLOS_BIG_AGGRO_REGULAR
            | id::NYLOCAS_TOXOBOLOS_BIG_AGGRO_HARD
            | id::NYLOCAS_HAGIOS_SMALL_ENTRY
            | id::NYLOCAS_HAGIOS_SMALL_REGULAR
            | id::NYLOCAS_HAGIOS_SMALL_HARD
            | id::NYLOCAS_HAGIOS_SMALL_AGGRO_ENTRY
            | id::NYLOCAS_HAGIOS_SMALL_AGGRO_REGULAR
            | id::NYLOCAS_HAGIOS_SMALL_AGGRO_HARD
            | id::NYLOCAS_HAGIOS_BIG_ENTRY
            | id::NYLOCAS_HAGIOS_BIG_REGULAR
            | id::NYLOCAS_HAGIOS_BIG_HARD
            | id::NYLOCAS_HAGIOS_BIG_AGGRO_ENTRY
            | id::NYLOCAS_HAGIOS_BIG_AGGRO_REGULAR
            | id::NYLOCAS_HAGIOS_BIG_AGGRO_HARD
    )
}

#[must_use]
pub fn is_nylocas_prinkipas(npc_id: u32) -> bool {
    matches!(
        npc_id,
        id::NYLOCAS_PRINKIPAS_MELEE | id::NYLOCAS_PRINKIPAS_MAGE | id::NYLOCAS_PRINKIPAS_RANGE
    )
}

#[must_use]
pub fn is_nylocas_vasilias(npc_id: u32) -> bool {
    nylocas_vasilias_style(npc_id).is_some()
}

/// Returns the combat style of a Nylocas boss NPC ID, or `None` for other NPCs.
#[must_use]
pub fn nylocas_vasilias_style(npc_id: u32) -> Option<CombatStyle> {
    match npc_id {
        id::NYLOCAS_VASILIAS_DROPPING_ENTRY
        | id::NYLOCAS_VASILIAS_DROPPING_REGULAR
        | id::NYLOCAS_VASILIAS_DROPPING_HARD
        | id::NYLOCAS_VASILIAS_MELEE_ENTRY
        | id::NYLOCAS_VASILIAS_MELEE_REGULAR
        | id::NYLOCAS_VASILIAS_MELEE_HARD => Some(CombatStyle::Melee),
        id::NYLOCAS_VASILIAS_RANGE_ENTRY
        | id::NYLOCAS_VASILIAS_RANGE_REGULAR
        | id::NYLOCAS_VASILIAS_RANGE_HARD => Some(CombatStyle::Ranged),
        id::NYLOCAS_VASILIAS_MAGE_ENTRY
        | id::NYLOCAS_VASILIAS_MAGE_REGULAR
        | id::NYLOCAS_VASILIAS_MAGE_HARD => Some(CombatStyle::Magic),
        _ => None,
    }
}

#[must_use]
pub fn is_sotetseg(npc_id: u32) -> bool {
    matches!(
        npc_id,
        id::SOTETSEG_IDLE_ENTRY
            | id::SOTETSEG_IDLE_REGULAR
            | id::SOTETSEG_IDLE_HARD
            | id::SOTETSEG_ENTRY
            | id::SOTETSEG_REGULAR
            | id::SOTETSEG_HARD
    )
}

#[must_use]
pub fn is_xarpus(npc_id: u32) -> bool {
    matches!(
        npc_id,
        id::XARPUS_IDLE_ENTRY
            | id::XARPUS_IDLE_REGULAR
            | id::XARPUS_IDLE_HARD
            | id::XARPUS_P1_ENTRY
            | id::XARPUS_P1_REGULAR
            | id::XARPUS_P1_HARD
            | id::XARPUS_ENTRY
            | id::XARPUS_REGULAR
            | id::XARPUS_HARD
    )
}

#[must_use]
pub fn is_verzik_p1(npc_id: u32) -> bool {
    matches!(
        npc_id,
        id::VERZIK_P1_ENTRY
            | id::VERZIK_P1_ENTRY_10832
            | id::VERZIK_P1_REGULAR
            | id::VERZIK_P1_REGULAR_8371
            | id::VERZIK_P1_HARD
            | id::VERZIK_P1_HARD_10849
    )
}

#[must_use]
pub fn is_verzik_p2(npc_id: u32) -> bool {
    matches!(
        npc_id,
        id::VERZIK_P2_ENTRY | id::VERZIK_P2_REGULAR | id::VERZIK_P2_HARD
    )
}

#[must_use]
pub fn is_verzik_p3_transition(npc_id: u32) -> bool {
    matches!(
        npc_id,
        id::VERZIK_P3_TRANSITION_ENTRY
            | id::VERZIK_P3_TRANSITION_REGULAR
            | id::VERZIK_P3_TRANSITION_HARD
    )
}

#[must_use]
pub fn is_verzik_p3(npc_id: u32) -> bool {
    matches!(
        npc_id,
        id::VERZIK_P3_ENTRY
            | id::VERZIK_P3_ENTRY_10836
            | id::VERZIK_P3_REGULAR
            | id::VERZIK_P3_REGULAR_8375
            | id::VERZIK_P3_HARD
            | id::VERZIK_P3_HARD_10853
    )
}

#[must_use]
pub fn is_verzik(npc_id: u32) -> bool {
    is_verzik_p1(npc_id)
        || is_verzik_p2(npc_id)
        || is_verzik_p3_transition(npc_id)
        || is_verzik_p3(npc_id)
}

#[must_use]
pub fn is_verzik_matomenos(npc_id: u32) -> bool {
    matches!(
        npc_id,
        id::VERZIK_MATOMENOS_ENTRY | id::VERZIK_MATOMENOS_REGULAR | id::VERZIK_MATOMENOS_HARD
    )
}

#[must_use]
pub fn is_mokhaiotl_larva(npc_id: u32) -> bool {
    matches!(
        npc_id,
        id::DEMONIC_LARVA
            | id::DEMONIC_RANGE_LARVA
            | id::DEMONIC_MAGIC_LARVA
            | id::DEMONIC_MELEE_LARVA
            | id::GIANT_DEMONIC_RANGE_LARVA
            | id::GIANT_DEMONIC_MAGIC_LARVA
    )
}

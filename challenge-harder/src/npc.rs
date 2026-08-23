//! OSRS NPC information.

use crate::proto::event::npc::nylo::Style as NyloStyle;

pub mod id {
    pub const ROCKY_SUPPORT: u32 = 7709;

    pub const MAIDEN_MATOMENOS_ENTRY: u32 = 10820;
    pub const MAIDEN_MATOMENOS_REGULAR: u32 = 8366;
    pub const MAIDEN_MATOMENOS_HARD: u32 = 10828;

    pub const BLOAT_ENTRY: u32 = 10812;
    pub const BLOAT_REGULAR: u32 = 8359;
    pub const BLOAT_HARD: u32 = 10813;

    pub const NYLOCAS_ISCHYROS_SMALL_ENTRY: u32 = 10774;
    pub const NYLOCAS_ISCHYROS_SMALL_REGULAR: u32 = 8342;
    pub const NYLOCAS_ISCHYROS_SMALL_HARD: u32 = 10791;
    pub const NYLOCAS_ISCHYROS_SMALL_AGGRO_ENTRY: u32 = 10780;
    pub const NYLOCAS_ISCHYROS_SMALL_AGGRO_REGULAR: u32 = 8348;
    pub const NYLOCAS_ISCHYROS_SMALL_AGGRO_HARD: u32 = 10797;
    pub const NYLOCAS_ISCHYROS_BIG_ENTRY: u32 = 10777;
    pub const NYLOCAS_ISCHYROS_BIG_REGULAR: u32 = 8345;
    pub const NYLOCAS_ISCHYROS_BIG_HARD: u32 = 10794;
    pub const NYLOCAS_ISCHYROS_BIG_AGGRO_ENTRY: u32 = 10783;
    pub const NYLOCAS_ISCHYROS_BIG_AGGRO_REGULAR: u32 = 8351;
    pub const NYLOCAS_ISCHYROS_BIG_AGGRO_HARD: u32 = 10800;
    pub const NYLOCAS_TOXOBOLOS_SMALL_ENTRY: u32 = 10775;
    pub const NYLOCAS_TOXOBOLOS_SMALL_REGULAR: u32 = 8343;
    pub const NYLOCAS_TOXOBOLOS_SMALL_HARD: u32 = 10792;
    pub const NYLOCAS_TOXOBOLOS_SMALL_AGGRO_ENTRY: u32 = 10781;
    pub const NYLOCAS_TOXOBOLOS_SMALL_AGGRO_REGULAR: u32 = 8349;
    pub const NYLOCAS_TOXOBOLOS_SMALL_AGGRO_HARD: u32 = 10798;
    pub const NYLOCAS_TOXOBOLOS_BIG_ENTRY: u32 = 10778;
    pub const NYLOCAS_TOXOBOLOS_BIG_REGULAR: u32 = 8346;
    pub const NYLOCAS_TOXOBOLOS_BIG_HARD: u32 = 10795;
    pub const NYLOCAS_TOXOBOLOS_BIG_AGGRO_ENTRY: u32 = 10784;
    pub const NYLOCAS_TOXOBOLOS_BIG_AGGRO_REGULAR: u32 = 8352;
    pub const NYLOCAS_TOXOBOLOS_BIG_AGGRO_HARD: u32 = 10801;
    pub const NYLOCAS_HAGIOS_SMALL_ENTRY: u32 = 10776;
    pub const NYLOCAS_HAGIOS_SMALL_REGULAR: u32 = 8344;
    pub const NYLOCAS_HAGIOS_SMALL_HARD: u32 = 10793;
    pub const NYLOCAS_HAGIOS_SMALL_AGGRO_ENTRY: u32 = 10782;
    pub const NYLOCAS_HAGIOS_SMALL_AGGRO_REGULAR: u32 = 8350;
    pub const NYLOCAS_HAGIOS_SMALL_AGGRO_HARD: u32 = 10799;
    pub const NYLOCAS_HAGIOS_BIG_ENTRY: u32 = 10779;
    pub const NYLOCAS_HAGIOS_BIG_REGULAR: u32 = 8347;
    pub const NYLOCAS_HAGIOS_BIG_HARD: u32 = 10796;
    pub const NYLOCAS_HAGIOS_BIG_AGGRO_ENTRY: u32 = 10785;
    pub const NYLOCAS_HAGIOS_BIG_AGGRO_REGULAR: u32 = 8353;
    pub const NYLOCAS_HAGIOS_BIG_AGGRO_HARD: u32 = 10802;

    pub const NYLOCAS_PRINKIPAS_MELEE: u32 = 10804;
    pub const NYLOCAS_PRINKIPAS_MAGE: u32 = 10805;
    pub const NYLOCAS_PRINKIPAS_RANGE: u32 = 10806;

    pub const NYLOCAS_VASILIAS_DROPPING_ENTRY: u32 = 10787;
    pub const NYLOCAS_VASILIAS_MELEE_ENTRY: u32 = 10788;
    pub const NYLOCAS_VASILIAS_MAGE_ENTRY: u32 = 10789;
    pub const NYLOCAS_VASILIAS_RANGE_ENTRY: u32 = 10790;
    pub const NYLOCAS_VASILIAS_DROPPING_REGULAR: u32 = 8354;
    pub const NYLOCAS_VASILIAS_MELEE_REGULAR: u32 = 8355;
    pub const NYLOCAS_VASILIAS_MAGE_REGULAR: u32 = 8356;
    pub const NYLOCAS_VASILIAS_RANGE_REGULAR: u32 = 8357;
    pub const NYLOCAS_VASILIAS_DROPPING_HARD: u32 = 10807;
    pub const NYLOCAS_VASILIAS_MELEE_HARD: u32 = 10808;
    pub const NYLOCAS_VASILIAS_MAGE_HARD: u32 = 10809;
    pub const NYLOCAS_VASILIAS_RANGE_HARD: u32 = 10810;

    pub const VERZIK_P1_ENTRY: u32 = 10831;
    pub const VERZIK_P1_ENTRY_10832: u32 = 10832;
    pub const VERZIK_P1_REGULAR: u32 = 8370;
    pub const VERZIK_P1_REGULAR_8371: u32 = 8371;
    pub const VERZIK_P1_HARD: u32 = 10848;
    pub const VERZIK_P1_HARD_10849: u32 = 10849;

    pub const VERZIK_P2_ENTRY: u32 = 10833;
    pub const VERZIK_P2_REGULAR: u32 = 8372;
    pub const VERZIK_P2_HARD: u32 = 10850;

    pub const VERZIK_P3_TRANSITION_ENTRY: u32 = 10834;
    pub const VERZIK_P3_TRANSITION_REGULAR: u32 = 8373;
    pub const VERZIK_P3_TRANSITION_HARD: u32 = 10851;

    pub const VERZIK_P3_ENTRY: u32 = 10835;
    pub const VERZIK_P3_ENTRY_10836: u32 = 10836;
    pub const VERZIK_P3_REGULAR: u32 = 8374;
    pub const VERZIK_P3_REGULAR_8375: u32 = 8375;
    pub const VERZIK_P3_HARD: u32 = 10852;
    pub const VERZIK_P3_HARD_10853: u32 = 10853;

    pub const VERZIK_MATOMENOS_ENTRY: u32 = 10845;
    pub const VERZIK_MATOMENOS_REGULAR: u32 = 8385;
    pub const VERZIK_MATOMENOS_HARD: u32 = 10862;
}

pub fn is_maiden_matomenos(npc_id: u32) -> bool {
    matches!(
        npc_id,
        id::MAIDEN_MATOMENOS_ENTRY | id::MAIDEN_MATOMENOS_REGULAR | id::MAIDEN_MATOMENOS_HARD
    )
}

pub fn is_bloat(npc_id: u32) -> bool {
    matches!(npc_id, id::BLOAT_ENTRY | id::BLOAT_REGULAR | id::BLOAT_HARD)
}

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

pub fn is_nylocas_prinkipas(npc_id: u32) -> bool {
    matches!(
        npc_id,
        id::NYLOCAS_PRINKIPAS_MELEE | id::NYLOCAS_PRINKIPAS_MAGE | id::NYLOCAS_PRINKIPAS_RANGE
    )
}

pub fn is_nylocas_vasilias(npc_id: u32) -> bool {
    nylocas_vasilias_style(npc_id).is_some()
}

pub fn nylocas_vasilias_style(npc_id: u32) -> Option<NyloStyle> {
    match npc_id {
        id::NYLOCAS_VASILIAS_DROPPING_ENTRY
        | id::NYLOCAS_VASILIAS_DROPPING_REGULAR
        | id::NYLOCAS_VASILIAS_DROPPING_HARD
        | id::NYLOCAS_VASILIAS_MELEE_ENTRY
        | id::NYLOCAS_VASILIAS_MELEE_REGULAR
        | id::NYLOCAS_VASILIAS_MELEE_HARD => Some(NyloStyle::Melee),
        id::NYLOCAS_VASILIAS_RANGE_ENTRY
        | id::NYLOCAS_VASILIAS_RANGE_REGULAR
        | id::NYLOCAS_VASILIAS_RANGE_HARD => Some(NyloStyle::Range),
        id::NYLOCAS_VASILIAS_MAGE_ENTRY
        | id::NYLOCAS_VASILIAS_MAGE_REGULAR
        | id::NYLOCAS_VASILIAS_MAGE_HARD => Some(NyloStyle::Mage),
        _ => None,
    }
}

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

pub fn is_verzik_p2(npc_id: u32) -> bool {
    matches!(
        npc_id,
        id::VERZIK_P2_ENTRY | id::VERZIK_P2_REGULAR | id::VERZIK_P2_HARD
    )
}

pub fn is_verzik_p3_transition(npc_id: u32) -> bool {
    matches!(
        npc_id,
        id::VERZIK_P3_TRANSITION_ENTRY
            | id::VERZIK_P3_TRANSITION_REGULAR
            | id::VERZIK_P3_TRANSITION_HARD
    )
}

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

pub fn is_verzik(npc_id: u32) -> bool {
    is_verzik_p1(npc_id)
        || is_verzik_p2(npc_id)
        || is_verzik_p3_transition(npc_id)
        || is_verzik_p3(npc_id)
}

pub fn is_verzik_matomenos(npc_id: u32) -> bool {
    matches!(
        npc_id,
        id::VERZIK_MATOMENOS_ENTRY | id::VERZIK_MATOMENOS_REGULAR | id::VERZIK_MATOMENOS_HARD
    )
}

//! OSRS NPC information.

use crate::proto::event::npc::nylo::Style as NyloStyle;

pub mod id {
    pub const ROCKY_SUPPORT: u32 = 7709;

    pub const MAIDEN_ENTRY: u32 = 10814;
    pub const MAIDEN_ENTRY_10815: u32 = 10815;
    pub const MAIDEN_ENTRY_10816: u32 = 10816;
    pub const MAIDEN_ENTRY_10817: u32 = 10817;
    pub const MAIDEN_ENTRY_10818: u32 = 10818;
    pub const MAIDEN_ENTRY_10819: u32 = 10819;
    pub const MAIDEN_REGULAR: u32 = 8360;
    pub const MAIDEN_REGULAR_8361: u32 = 8361;
    pub const MAIDEN_REGULAR_8362: u32 = 8362;
    pub const MAIDEN_REGULAR_8363: u32 = 8363;
    pub const MAIDEN_REGULAR_8364: u32 = 8364;
    pub const MAIDEN_REGULAR_8365: u32 = 8365;
    pub const MAIDEN_HARD: u32 = 10822;
    pub const MAIDEN_HARD_10823: u32 = 10823;
    pub const MAIDEN_HARD_10824: u32 = 10824;
    pub const MAIDEN_HARD_10825: u32 = 10825;
    pub const MAIDEN_HARD_10826: u32 = 10826;
    pub const MAIDEN_HARD_10827: u32 = 10827;

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

    pub const SOTETSEG_IDLE_ENTRY: u32 = 10864;
    pub const SOTETSEG_IDLE_REGULAR: u32 = 8387;
    pub const SOTETSEG_IDLE_HARD: u32 = 10867;
    pub const SOTETSEG_ENTRY: u32 = 10865;
    pub const SOTETSEG_REGULAR: u32 = 8388;
    pub const SOTETSEG_HARD: u32 = 10868;

    pub const XARPUS_IDLE_ENTRY: u32 = 10766;
    pub const XARPUS_IDLE_REGULAR: u32 = 8338;
    pub const XARPUS_IDLE_HARD: u32 = 10770;
    pub const XARPUS_P1_ENTRY: u32 = 10767;
    pub const XARPUS_P1_REGULAR: u32 = 8339;
    pub const XARPUS_P1_HARD: u32 = 10771;
    pub const XARPUS_ENTRY: u32 = 10768;
    pub const XARPUS_REGULAR: u32 = 8340;
    pub const XARPUS_HARD: u32 = 10772;

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

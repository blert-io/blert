//! Player statistics accumulation.

use serde::Serialize;

/// Changes to a player's lifetime stats accumulated over a processing run.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct PlayerStatsDelta {
    pub colosseum_completions: i32,
    pub colosseum_wipes: i32,
    pub colosseum_resets: i32,
    pub inferno_completions: i32,
    pub inferno_wipes: i32,
    pub inferno_resets: i32,
    pub mokhaiotl_completions: i32,
    pub mokhaiotl_wipes: i32,
    pub mokhaiotl_resets: i32,
    pub mokhaiotl_total_delves: i32,
    pub mokhaiotl_delves_completed: i32,
    pub mokhaiotl_deep_delves_completed: i32,
    pub tob_completions: i32,
    pub tob_wipes: i32,
    pub tob_resets: i32,
    pub deaths_total: i32,
    pub deaths_maiden: i32,
    pub deaths_bloat: i32,
    pub deaths_nylocas: i32,
    pub deaths_sotetseg: i32,
    pub deaths_xarpus: i32,
    pub deaths_verzik: i32,
    pub hammer_bops: i32,
    pub bgs_smacks: i32,
    pub chally_pokes: i32,
    pub uncharged_scythe_swings: i32,
    pub ralos_autos: i32,
    pub elder_maul_smacks: i32,
    pub tob_barrages_without_proper_weapon: i32,
    pub tob_verzik_p1_troll_specs: i32,
    pub tob_verzik_p3_melees: i32,
    pub chins_thrown_total: i32,
    pub chins_thrown_black: i32,
    pub chins_thrown_red: i32,
    pub chins_thrown_grey: i32,
    pub chins_thrown_maiden: i32,
    pub chins_thrown_nylocas: i32,
    pub chins_thrown_value: i32,
    pub chins_thrown_incorrectly_maiden: i32,
}

impl PlayerStatsDelta {
    /// Whether no changes occurred.
    pub fn is_empty(&self) -> bool {
        *self == PlayerStatsDelta::default()
    }

    /// Pairs each field's value with its `player_stats` column.
    pub fn columns(&self) -> Vec<(String, i32)> {
        let serde_json::Value::Object(fields) =
            serde_json::to_value(self).expect("stats delta serializes")
        else {
            unreachable!("a struct serializes to a JSON object")
        };
        fields
            .into_iter()
            .map(|(name, value)| {
                let value = value.as_i64().and_then(|v| i32::try_from(v).ok());
                (name, value.expect("stat fields are integers"))
            })
            .collect()
    }
}

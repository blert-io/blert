//! Player statistics accumulation.

use serde::Serialize;

/// Changes to a player's lifetime stats accumulated over a processing run.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[expect(clippy::struct_field_names)]
pub struct PlayerStatsDelta {
    pub mokhaiotl_completions: i32,
    pub mokhaiotl_wipes: i32,
    pub mokhaiotl_resets: i32,
    pub mokhaiotl_total_delves: i32,
    pub mokhaiotl_delves_completed: i32,
    pub mokhaiotl_deep_delves_completed: i32,
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

/// Standard Blert RSN normalization, as in `//common/player.ts`.
#[must_use]
pub fn normalize_rsn(name: &str) -> String {
    name.to_lowercase().replace(['-', ' '], "_")
}

//! OSRS game info.

use crate::lifecycle::core::types::ChallengeMode;

const NATURAL_STALLS: [u32; 31] = [
    4, 4, 4, 4, 16, 4, 12, 4, 12, 8, 8, 8, 8, 8, 8, 4, 12, 8, 12, 16, 8, 12, 8, 8, 8, 4, 8, 4, 4,
    4, 0,
];

fn is_prince_wave(wave: u32) -> bool {
    matches!(wave, 10 | 20 | 30)
}

/// Returns the natural stall duration for a given Nylocas wave.
pub(super) fn natural_stall_for_wave(mode: ChallengeMode, wave: u32) -> u32 {
    if mode == ChallengeMode::TobHard && is_prince_wave(wave) {
        return 16;
    }
    NATURAL_STALLS
        .get(wave as usize - 1)
        .copied()
        .expect("client consistency checks ensure validity")
}

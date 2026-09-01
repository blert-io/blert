//! Challenge split processing utilities.
//!
//! `SplitType` is generated from `challenge_storage.proto`.

use crate::lifecycle::core::types::ChallengeMode;
use crate::merging::{Tick, Ticks};

pub use crate::proto::SplitType;

/// A recorded split whose timer is local to a single stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StageSplit {
    pub tick: Tick,
    pub start: Tick,
    /// Marks a split lasting until the end of its stage, making accuracy
    /// contingent on stage completion.
    pub requires_completion: bool,
}

/// A recorded split whose timer spans the entire challenge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChallengeSplit {
    pub ticks: Ticks,
    /// If set, overrides the default challenge accuracy computation.
    pub accurate: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SavedSplit {
    pub split: SplitType,
    pub ticks: u32,
    pub accurate: bool,
}

pub trait SplitExt {
    /// Converts a split type to a different mode,
    /// For example, `TobEntryNyloBossSpawn` adjusted to `TobHard` becomes
    /// `TobHmNyloBossSpawn`. Splits that lack modes are returned unchanged.
    fn adjust_to(self, mode: ChallengeMode) -> SplitType;

    /// Returns the generic version of a mode-specific split.
    /// Splits of challenges without modes are returned unchanged.
    fn generalize(self) -> SplitType;
}

impl SplitExt for SplitType {
    fn adjust_to(self, mode: ChallengeMode) -> SplitType {
        if !is_tob_split(self) {
            return self;
        }

        let value = self.generalize() as i32;
        let offset = match mode {
            ChallengeMode::TobRegular => 1,
            ChallengeMode::TobHard => 2,
            ChallengeMode::NoMode
            | ChallengeMode::TobEntry
            | ChallengeMode::CoxRegular
            | ChallengeMode::CoxChallenge
            | ChallengeMode::ToaEntry
            | ChallengeMode::ToaNormal
            | ChallengeMode::ToaExpert => 0,
        };

        SplitType::try_from(value + offset).expect("ToB mode splits are consecutive")
    }

    fn generalize(self) -> SplitType {
        if is_tob_split(self) {
            let value = self as i32;
            SplitType::try_from(value - value % 3).expect("ToB mode splits are consecutive")
        } else {
            self
        }
    }
}

fn is_tob_split(split: SplitType) -> bool {
    (SplitType::TobEntryChallenge as i32..=SplitType::TobHmVerzikStart as i32)
        .contains(&(split as i32))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adjust_to_selects_the_mode_variant_of_generic_tob_splits() {
        assert_eq!(
            SplitType::TobEntryChallenge.adjust_to(ChallengeMode::TobRegular),
            SplitType::TobRegChallenge,
        );
        assert_eq!(
            SplitType::TobEntryMaiden.adjust_to(ChallengeMode::TobHard),
            SplitType::TobHmMaiden,
        );
        assert_eq!(
            SplitType::TobEntryVerzikStart.adjust_to(ChallengeMode::TobHard),
            SplitType::TobHmVerzikStart,
        );
        assert_eq!(
            SplitType::TobEntryMaiden.adjust_to(ChallengeMode::TobEntry),
            SplitType::TobEntryMaiden,
        );
        assert_eq!(
            SplitType::TobEntryMaiden.adjust_to(ChallengeMode::NoMode),
            SplitType::TobEntryMaiden,
        );
    }

    #[test]
    fn adjust_to_converts_between_tob_modes() {
        assert_eq!(
            SplitType::TobRegMaiden.adjust_to(ChallengeMode::TobHard),
            SplitType::TobHmMaiden,
        );
        assert_eq!(
            SplitType::TobHmChallenge.adjust_to(ChallengeMode::TobRegular),
            SplitType::TobRegChallenge,
        );
        assert_eq!(
            SplitType::TobHmMaiden.adjust_to(ChallengeMode::NoMode),
            SplitType::TobEntryMaiden,
        );
    }

    #[test]
    fn adjust_to_passes_through_other_challenges() {
        assert_eq!(
            SplitType::ColosseumWave1.adjust_to(ChallengeMode::TobHard),
            SplitType::ColosseumWave1,
        );
        assert_eq!(
            SplitType::MokhaiotlDelve8.adjust_to(ChallengeMode::TobRegular),
            SplitType::MokhaiotlDelve8,
        );
    }

    #[test]
    fn generalize_removes_the_mode_of_tob_splits() {
        assert_eq!(
            SplitType::TobRegChallenge.generalize(),
            SplitType::TobEntryChallenge,
        );
        assert_eq!(
            SplitType::TobHmMaiden.generalize(),
            SplitType::TobEntryMaiden
        );
        assert_eq!(
            SplitType::TobHmVerzikStart.generalize(),
            SplitType::TobEntryVerzikStart,
        );
        assert_eq!(
            SplitType::TobEntryMaiden.generalize(),
            SplitType::TobEntryMaiden,
        );
    }

    #[test]
    fn generalize_passes_through_other_challenges() {
        assert_eq!(
            SplitType::ColosseumWave12.generalize(),
            SplitType::ColosseumWave12,
        );
        assert_eq!(
            SplitType::InfernoWave69Time.generalize(),
            SplitType::InfernoWave69Time,
        );
    }

    #[test]
    fn split_values_support_stage_arithmetic() {
        assert_eq!(
            SplitType::try_from(SplitType::MokhaiotlDelve1 as i32 + 7),
            Ok(SplitType::MokhaiotlDelve8),
        );
        assert_eq!(
            SplitType::try_from(SplitType::MokhaiotlDelve3Start as i32 + 2),
            Ok(SplitType::MokhaiotlDelve5Start),
        );
        assert!(SplitType::try_from(114).is_err());
        assert!(SplitType::try_from(304).is_err());
    }
}

//! Core challenge types.

use core::ops::Add;
use core::time::Duration;

use serde::{Deserialize, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};

pub use uuid::Uuid;

pub use crate::proto::Challenge as ChallengeType;
pub use crate::proto::ChallengeMode;
pub use crate::proto::Stage;
pub use crate::proto::event::stage_update::Status as StageStatus;

/// Milliseconds since a challenge-specific epoch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Timestamp(u64);

impl Timestamp {
    pub const ZERO: Timestamp = Timestamp(0);

    #[must_use]
    pub fn from_millis(ms: u64) -> Self {
        Timestamp(ms)
    }

    #[must_use]
    pub fn as_millis(self) -> u64 {
        self.0
    }
}

impl Add<Duration> for Timestamp {
    type Output = Timestamp;

    fn add(self, rhs: Duration) -> Timestamp {
        let ms = u64::try_from(rhs.as_millis()).unwrap_or(u64::MAX);
        Timestamp(self.0.saturating_add(ms))
    }
}

/// Fencing epoch of one challenge actor incarnation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Epoch(pub u64);

impl Epoch {
    /// The epoch assigned when a challenge is created.
    pub const INITIAL: Epoch = Epoch(1);
}

impl std::fmt::Display for Epoch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Position of a message in a challenge's inbox, assigned in send order.
///
/// Shaped like a Redis stream entry ID, containing a millisecond timestamp and
/// a sequence number within it, ordered by timestamp first.
/// Serializes as the canonical `ms-seq` string.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(into = "String", try_from = "String")]
pub struct MsgId {
    ms: u64,
    seq: u64,
}

impl MsgId {
    /// An id with no timestamp component for in-memory use.
    #[must_use]
    pub const fn sequence(seq: u64) -> Self {
        Self { ms: 0, seq }
    }
}

impl std::fmt::Display for MsgId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}-{}", self.ms, self.seq)
    }
}

impl std::str::FromStr for MsgId {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let invalid = || format!("invalid message id: {s}");
        let (ms, seq) = s.split_once('-').ok_or_else(invalid)?;
        Ok(Self {
            ms: ms.parse().map_err(|_| invalid())?,
            seq: seq.parse().map_err(|_| invalid())?,
        })
    }
}

impl From<MsgId> for String {
    fn from(id: MsgId) -> Self {
        id.to_string()
    }
}

impl TryFrom<String> for MsgId {
    type Error = String;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        s.parse()
    }
}

/// Position of an entry in a challenge journal.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct JournalSeq(pub u64);

/// Unique identifier for a Blert client.
#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ClientId(pub i64);

impl std::fmt::Display for ClientId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Unique identifier for a Blert user.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct UserId(pub i64);

impl std::fmt::Display for UserId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Token authenticating a client's requests within a challenge.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SessionToken(String);

impl std::fmt::Debug for SessionToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SessionToken(..)")
    }
}

impl From<String> for SessionToken {
    fn from(token: String) -> Self {
        SessionToken(token)
    }
}

impl From<&str> for SessionToken {
    fn from(token: &str) -> Self {
        SessionToken(token.to_owned())
    }
}

/// Status of a challenge, matching `ChallengeStatus` in `//common/challenge.ts`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize_repr, Deserialize_repr)]
#[repr(u8)]
pub enum ChallengeStatus {
    #[default]
    InProgress = 0,
    Completed = 1,
    Reset = 2,
    Wiped = 3,
    Abandoned = 4,
}

/// How a user recorded a challenge. Matches `RecordingType` in `//common/user.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize_repr, Deserialize_repr)]
#[repr(u8)]
pub enum RecordingType {
    Spectator = 0,
    Participant = 1,
}

// Compile-time parity checks against the upstream TS values.
const _: () = {
    assert!(ChallengeStatus::InProgress as u8 == 0);
    assert!(ChallengeStatus::Completed as u8 == 1);
    assert!(ChallengeStatus::Reset as u8 == 2);
    assert!(ChallengeStatus::Wiped as u8 == 3);
    assert!(ChallengeStatus::Abandoned as u8 == 4);

    assert!(RecordingType::Spectator as u8 == 0);
    assert!(RecordingType::Participant as u8 == 1);
};

/// Client-reported completion times, in ticks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReportedTimes {
    pub challenge: u32,
    pub overall: u32,
}

/// Result from the stage processing pipeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct StageProcessingOutcome {
    pub status: StageStatus,
    pub ticks: u32,
}

/// Serializable error from the stage processing pipeline.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StageProcessingError {
    pub message: String,
}

pub trait StageExt {
    fn challenge_type(self) -> Option<ChallengeType>;
    // Implemented for the Copy enum Stage, which is always passed by value.
    #[allow(clippy::wrong_self_convention)]
    fn is_retriable(self) -> bool;
    fn later_stages(self) -> Vec<Stage>;
}

pub trait StageStatusExt {
    // Implemented for the Copy enum StageStatus, which is always passed by value.
    #[allow(clippy::wrong_self_convention)]
    fn is_finished(self) -> bool;
}

impl StageStatusExt for StageStatus {
    /// Whether the status indicates the stage is over.
    fn is_finished(self) -> bool {
        self == StageStatus::Completed || self == StageStatus::Wiped
    }
}

impl StageExt for Stage {
    fn challenge_type(self) -> Option<ChallengeType> {
        match self as i32 {
            10..=15 => Some(ChallengeType::Tob),
            20..=32 => Some(ChallengeType::Cox),
            40..=48 => Some(ChallengeType::Toa),
            50..=58 => Some(ChallengeType::Mokhaiotl),
            100..=111 => Some(ChallengeType::Colosseum),
            200..=268 => Some(ChallengeType::Inferno),
            _ => None,
        }
    }

    /// Whether a stage can be re-attempted by sending a new `STARTING` update.
    fn is_retriable(self) -> bool {
        // TODO(frolv): Handle toa
        self == Stage::MokhaiotlDelve8plus
    }

    /// Returns stages that are later than this one in its challenge.
    fn later_stages(self) -> Vec<Stage> {
        match self.challenge_type() {
            // TODO(frolv): Handle toa.
            None | Some(ChallengeType::Toa) => Vec::new(),
            Some(ty) => ((self as i32 + 1)..)
                .map_while(|value| {
                    Stage::try_from(value)
                        .ok()
                        .filter(|stage| stage.challenge_type() == Some(ty))
                })
                .collect(),
        }
    }
}

pub trait ChallengeTypeExt {
    fn first_stage(self) -> Option<Stage>;
    fn last_stage(self) -> Option<Stage>;
}

impl ChallengeTypeExt for ChallengeType {
    /// Returns the initial stage of a challenge.
    fn first_stage(self) -> Option<Stage> {
        match self {
            ChallengeType::Tob => Some(Stage::TobMaiden),
            ChallengeType::Cox => Some(Stage::CoxTekton),
            // TODO(frolv): handle toa
            ChallengeType::Toa => Some(Stage::ToaApmeken),
            ChallengeType::Mokhaiotl => Some(Stage::MokhaiotlDelve1),
            ChallengeType::Colosseum => Some(Stage::ColosseumWave1),
            ChallengeType::Inferno => Some(Stage::InfernoWave1),
            ChallengeType::UnknownChallenge => None,
        }
    }

    /// Stage whose completion results in an overall challenge completion status.
    fn last_stage(self) -> Option<Stage> {
        match self {
            ChallengeType::Tob => Some(Stage::TobVerzik),
            ChallengeType::Cox => Some(Stage::CoxOlm),
            ChallengeType::Toa => Some(Stage::ToaWardens),
            ChallengeType::Mokhaiotl => Some(Stage::MokhaiotlDelve8),
            ChallengeType::Colosseum => Some(Stage::ColosseumWave12),
            ChallengeType::Inferno => Some(Stage::InfernoWave69),
            ChallengeType::UnknownChallenge => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_enums_serialize_by_wire_value() {
        assert_eq!(serde_json::to_string(&Stage::TobVerzik).unwrap(), "15");
        assert_eq!(serde_json::to_string(&StageStatus::Wiped).unwrap(), "3");
        assert_eq!(
            serde_json::to_string(&ChallengeMode::TobRegular).unwrap(),
            "11"
        );
        assert_eq!(
            serde_json::from_str::<ChallengeType>("6").unwrap(),
            ChallengeType::Mokhaiotl
        );
        assert_eq!(
            serde_json::from_str::<Stage>("58").unwrap(),
            Stage::MokhaiotlDelve8plus
        );
    }

    #[test]
    fn stages_map_to_their_challenge_type() {
        let table = [
            (Stage::TobMaiden, Stage::TobVerzik, ChallengeType::Tob),
            (Stage::CoxTekton, Stage::CoxOlm, ChallengeType::Cox),
            (Stage::ToaApmeken, Stage::ToaWardens, ChallengeType::Toa),
            (
                Stage::MokhaiotlDelve1,
                Stage::MokhaiotlDelve8plus,
                ChallengeType::Mokhaiotl,
            ),
            (
                Stage::ColosseumWave1,
                Stage::ColosseumWave12,
                ChallengeType::Colosseum,
            ),
            (
                Stage::InfernoWave1,
                Stage::InfernoWave69,
                ChallengeType::Inferno,
            ),
        ];
        for (first, last, ty) in table {
            assert_eq!(first.challenge_type(), Some(ty));
            assert_eq!(last.challenge_type(), Some(ty));
            assert_eq!(ty.first_stage(), Some(first));
        }
        assert_eq!(Stage::UnknownStage.challenge_type(), None);
        assert_eq!(ChallengeType::UnknownChallenge.first_stage(), None);
    }

    #[test]
    fn later_stages_follow_the_linear_stage_order() {
        assert_eq!(
            Stage::TobSotetseg.later_stages(),
            vec![Stage::TobXarpus, Stage::TobVerzik]
        );
        assert_eq!(Stage::TobVerzik.later_stages(), vec![]);
        assert_eq!(
            Stage::MokhaiotlDelve8.later_stages(),
            vec![Stage::MokhaiotlDelve8plus]
        );
        assert_eq!(Stage::CoxMuttadile.later_stages(), vec![Stage::CoxOlm]);
        assert_eq!(Stage::ColosseumWave12.later_stages(), vec![]);
    }

    #[test]
    fn timestamp_add_duration() {
        let t = Timestamp::from_millis(1_000);
        assert_eq!(
            t + Duration::from_millis(500),
            Timestamp::from_millis(1_500)
        );
        assert_eq!(t + Duration::from_mins(5), Timestamp::from_millis(301_000));
        assert_eq!(
            Timestamp::from_millis(u64::MAX) + Duration::from_millis(1),
            Timestamp::from_millis(u64::MAX)
        );
    }
}

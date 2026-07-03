//! Challenge processing deadlines.
//!
//! Deadlines are not part of challenge state, but derived from it on demand.
//! Advancing the state implicitly cancels or reschedules any pending timer.

use core::time::Duration;

use serde::{Deserialize, Serialize};

use super::state::{ChallengeState, StageState};
use super::types::{ChallengeStatus, Timestamp};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DeadlineKind {
    /// Window for other clients to report a stage end after the first.
    StageEnd,
    /// Grace period after a definitive finish.
    ChallengeEnd,
    /// Reconnection window after the last client disconnects.
    CleanupDisconnect,
    /// Reconnection window after a non-definitive finish.
    CleanupNonDefinitiveFinish,
    /// Inactivity window while every client is idle.
    CleanupAllIdle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Deadline {
    pub kind: DeadlineKind,
    pub at: Timestamp,
}

/// Timing parameters for a challenge's deadlines.
#[derive(Debug, Clone)]
pub struct LifecycleConfig {
    /// Maximum time to wait for every client to report a stage end after the
    /// first client finishes the stage.
    pub stage_end_timeout: Duration,
}

impl Default for LifecycleConfig {
    // Defaults match the production challenge server's values.
    fn default() -> Self {
        LifecycleConfig {
            stage_end_timeout: Duration::from_secs(2),
        }
    }
}

/// Returns the next deadline implied by `state`, if any.
#[must_use]
pub fn next_deadline(state: &ChallengeState, config: &LifecycleConfig) -> Option<Deadline> {
    if state.status != ChallengeStatus::InProgress {
        return None;
    }

    match state.stage_state {
        StageState::Ending { since } => Some(Deadline {
            kind: DeadlineKind::StageEnd,
            at: since + config.stage_end_timeout,
        }),
        StageState::InProgress | StageState::Complete => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lifecycle::core::state::ClientState;
    use crate::lifecycle::core::types::{
        ChallengeType, ClientId, RecordingType, Stage, StageStatus, UserId,
    };

    fn mid_stage_state() -> ChallengeState {
        let client = ClientState {
            user_id: UserId(1),
            session_token: "tok".into(),
            recording_type: RecordingType::Participant,
            active: true,
            stage: Stage::TobMaiden,
            stage_status: StageStatus::Started,
            stage_attempt: None,
        };

        ChallengeState {
            challenge_type: ChallengeType::Tob,
            stage: Stage::TobMaiden,
            clients: [(ClientId(10), client)].into_iter().collect(),
            ..ChallengeState::default()
        }
    }

    #[test]
    fn stage_ending_sets_stage_end_deadline() {
        let state = ChallengeState {
            stage_state: StageState::Ending {
                since: Timestamp::from_millis(5_000),
            },
            ..mid_stage_state()
        };
        let config = LifecycleConfig {
            stage_end_timeout: Duration::from_secs(2),
        };
        assert_eq!(
            next_deadline(&state, &config),
            Some(Deadline {
                kind: DeadlineKind::StageEnd,
                at: Timestamp::from_millis(7_000),
            }),
        );
    }

    #[test]
    fn challenge_with_live_clients_has_no_deadlines() {
        let mut state = mid_stage_state();
        assert_eq!(next_deadline(&state, &LifecycleConfig::default()), None);

        state.stage_state = StageState::Complete;
        assert_eq!(next_deadline(&state, &LifecycleConfig::default()), None);
    }

    #[test]
    fn terminated_challenge_has_no_deadlines() {
        let state = ChallengeState {
            status: ChallengeStatus::Wiped,
            stage_state: StageState::Complete,
            ..mid_stage_state()
        };
        assert_eq!(next_deadline(&state, &LifecycleConfig::default()), None);
    }
}

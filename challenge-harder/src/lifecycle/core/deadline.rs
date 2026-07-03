//! Challenge processing deadlines.
//!
//! Deadlines are not part of challenge state, but derived from it on demand.
//! Advancing the state implicitly cancels or reschedules any pending timer.

use core::time::Duration;

use serde::{Deserialize, Serialize};

use super::state::{ChallengePhase, ChallengeState, StageState};
use super::types::Timestamp;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DeadlineKind {
    /// Window for other clients to report a stage end after the first.
    StageEnd,
    /// Grace period after a definitive finish once stage data is settled.
    ChallengeEnd,
    /// Reconnection window after the last client disconnects.
    CleanupDisconnect,
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
    /// Maximum time to wait for every client to send its finish request after
    /// the first definitive finish.
    pub challenge_end_grace: Duration,
}

impl Default for LifecycleConfig {
    fn default() -> Self {
        LifecycleConfig {
            challenge_end_grace: Duration::from_secs(5),
            stage_end_timeout: Duration::from_secs(2),
        }
    }
}

/// Returns the next deadline implied by `state`, if any.
#[must_use]
pub fn next_deadline(state: &ChallengeState, config: &LifecycleConfig) -> Option<Deadline> {
    if let ChallengePhase::Terminated { .. } = state.phase {
        return None;
    }

    // Stage completions are prioritized before trying to end a challenge.
    if let StageState::Ending { since } = state.stage_state {
        return Some(Deadline {
            kind: DeadlineKind::StageEnd,
            at: since + config.stage_end_timeout,
        });
    }

    if let ChallengePhase::Finishing { since, .. } = state.phase {
        // Start the completion grace period from when the stage was finalized.
        let anchor = match state.stage_state {
            StageState::Complete { since: sealed_at } => since.max(sealed_at),
            StageState::InProgress | StageState::Ending { .. } => since,
        };
        return Some(Deadline {
            kind: DeadlineKind::ChallengeEnd,
            at: anchor + config.challenge_end_grace,
        });
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lifecycle::core::state::ClientState;
    use crate::lifecycle::core::types::{
        ChallengeStatus, ChallengeType, ClientId, RecordingType, Stage, StageStatus, UserId,
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

    fn test_config() -> LifecycleConfig {
        LifecycleConfig {
            stage_end_timeout: Duration::from_secs(2),
            challenge_end_grace: Duration::from_millis(4_500),
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
        assert_eq!(
            next_deadline(&state, &test_config()),
            Some(Deadline {
                kind: DeadlineKind::StageEnd,
                at: Timestamp::from_millis(7_000),
            }),
        );
    }

    #[test]
    fn unsettled_stage_gates_challenge_end() {
        let state = ChallengeState {
            stage_state: StageState::Ending {
                since: Timestamp::from_millis(5_000),
            },
            phase: ChallengePhase::Finishing {
                since: Timestamp::from_millis(5_100),
                status: ChallengeStatus::Wiped,
            },
            ..mid_stage_state()
        };
        assert_eq!(
            next_deadline(&state, &test_config()),
            Some(Deadline {
                kind: DeadlineKind::StageEnd,
                at: Timestamp::from_millis(7_000),
            }),
        );
    }

    #[test]
    fn finishing_grace_runs_from_last_settlement() {
        // The stage sealed after the last finish: grace runs from the seal.
        let mut state = ChallengeState {
            stage_state: StageState::Complete {
                since: Timestamp::from_millis(7_000),
            },
            phase: ChallengePhase::Finishing {
                since: Timestamp::from_millis(5_100),
                status: ChallengeStatus::Wiped,
            },
            ..mid_stage_state()
        };
        assert_eq!(
            next_deadline(&state, &test_config()),
            Some(Deadline {
                kind: DeadlineKind::ChallengeEnd,
                at: Timestamp::from_millis(11_500),
            }),
        );

        // A definitive finish arriving after the seal anchors the grace.
        state.phase = ChallengePhase::Finishing {
            since: Timestamp::from_millis(8_000),
            status: ChallengeStatus::Wiped,
        };
        assert_eq!(
            next_deadline(&state, &test_config()),
            Some(Deadline {
                kind: DeadlineKind::ChallengeEnd,
                at: Timestamp::from_millis(12_500),
            }),
        );
    }

    #[test]
    fn finish_without_stage_report_runs_grace_from_finish() {
        let state = ChallengeState {
            phase: ChallengePhase::Finishing {
                since: Timestamp::from_millis(5_000),
                status: ChallengeStatus::Abandoned,
            },
            ..mid_stage_state()
        };
        assert_eq!(
            next_deadline(&state, &test_config()),
            Some(Deadline {
                kind: DeadlineKind::ChallengeEnd,
                at: Timestamp::from_millis(9_500),
            }),
        );
    }

    #[test]
    fn challenge_with_live_clients_has_no_deadlines() {
        let mut state = mid_stage_state();
        assert_eq!(next_deadline(&state, &LifecycleConfig::default()), None);

        state.stage_state = StageState::Complete {
            since: Timestamp::from_millis(7_000),
        };
        assert_eq!(next_deadline(&state, &LifecycleConfig::default()), None);
    }

    #[test]
    fn terminated_challenge_has_no_deadlines() {
        let state = ChallengeState {
            phase: ChallengePhase::Terminated {
                status: ChallengeStatus::Wiped,
            },
            stage_state: StageState::Complete {
                since: Timestamp::from_millis(7_000),
            },
            ..mid_stage_state()
        };
        assert_eq!(next_deadline(&state, &LifecycleConfig::default()), None);
    }
}

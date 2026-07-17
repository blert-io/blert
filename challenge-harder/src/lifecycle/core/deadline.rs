//! Challenge processing deadlines.
//!
//! Deadlines are not part of challenge state, but derived from it on demand.
//! Advancing the state implicitly cancels or reschedules any pending timer.

use core::time::Duration;

use serde::{Deserialize, Serialize};

use super::state::{ChallengeState, PhaseState, ProcessingConfig, ProcessingState, StageState};
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
    /// Delay before the next attempt of a failed processing run.
    ProcessingRetry,
    /// Cap on the duration of a processing run attempt.
    ProcessingTimeout,
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
    /// Time to wait for a client to reconnect after the last one disconnects.
    pub reconnection_window: Duration,
    /// Time to wait for a client to become active while every connected
    /// client is idle.
    pub inactivity_timeout: Duration,
    /// Interval at which a running challenge renews its lease.
    pub lease_renewal_interval: Duration,
    /// Options for challenge data processing runs.
    pub processing: ProcessingConfig,
}

impl Default for LifecycleConfig {
    fn default() -> Self {
        LifecycleConfig {
            challenge_end_grace: Duration::from_secs(5),
            stage_end_timeout: Duration::from_secs(2),
            reconnection_window: Duration::from_mins(5),
            inactivity_timeout: Duration::from_mins(15),
            lease_renewal_interval: Duration::from_secs(10),
            processing: ProcessingConfig::default(),
        }
    }
}

impl LifecycleConfig {
    /// Divides every window by `factor`, preserving boundary relationships
    /// under accelerated replay. `factor` must be nonzero.
    #[must_use]
    pub fn scaled(self, factor: u32) -> LifecycleConfig {
        LifecycleConfig {
            stage_end_timeout: self.stage_end_timeout / factor,
            challenge_end_grace: self.challenge_end_grace / factor,
            reconnection_window: self.reconnection_window / factor,
            inactivity_timeout: self.inactivity_timeout / factor,
            lease_renewal_interval: self.lease_renewal_interval / factor,
            processing: ProcessingConfig {
                max_attempts: self.processing.max_attempts,
                run_timeout: self.processing.run_timeout / factor,
                retry_backoff: self.processing.retry_backoff / factor,
            },
        }
    }
}

/// Returns the next deadline implied by `state`, if any.
#[must_use]
pub fn next_deadline(state: &ChallengeState, config: &LifecycleConfig) -> Option<Deadline> {
    let lifecycle = lifecycle_deadline(state, config);
    let processing = processing_deadline(state);
    match (lifecycle, processing) {
        (Some(lifecycle), Some(processing)) => Some(if processing.at < lifecycle.at {
            processing
        } else {
            lifecycle
        }),
        (lifecycle, processing) => lifecycle.or(processing),
    }
}

fn lifecycle_deadline(state: &ChallengeState, config: &LifecycleConfig) -> Option<Deadline> {
    if let PhaseState::Terminated = state.phase {
        return None;
    }

    // Stage completions are prioritized before trying to end a challenge.
    if let StageState::Ending { since } = state.stage_state {
        return Some(Deadline {
            kind: DeadlineKind::StageEnd,
            at: since + config.stage_end_timeout,
        });
    }

    if let PhaseState::Finishing { since } = state.phase {
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

    if let Some(since) = state.dormant_since {
        let deadline = if state.clients.is_empty() {
            Deadline {
                kind: DeadlineKind::CleanupDisconnect,
                at: since + config.reconnection_window,
            }
        } else {
            Deadline {
                kind: DeadlineKind::CleanupAllIdle,
                at: since + config.inactivity_timeout,
            }
        };
        return Some(deadline);
    }

    None
}

fn processing_deadline(state: &ChallengeState) -> Option<Deadline> {
    let run = state.processing.active()?;
    let config = state.processing.config();
    match run.state {
        ProcessingState::Running { since } => Some(Deadline {
            kind: DeadlineKind::ProcessingTimeout,
            at: since + config.run_timeout,
        }),
        ProcessingState::Idle { since } => {
            let backoff = if run.attempts == 0 {
                Duration::ZERO
            } else {
                config.retry_backoff
            };
            Some(Deadline {
                kind: DeadlineKind::ProcessingRetry,
                at: since + backoff,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lifecycle::core::state::{ClientState, Processing, Trigger};
    use crate::lifecycle::core::types::{
        ChallengeStatus, ChallengeType, ClientId, JournalSeq, ProcessingError, RecordingType,
        Stage, StageStatus, UserId,
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
            last_completed: None,
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
            reconnection_window: Duration::from_mins(5),
            inactivity_timeout: Duration::from_mins(15),
            lease_renewal_interval: Duration::from_secs(10),
            processing: ProcessingConfig::default(),
        }
    }

    /// A processing run with one trigger queued at `since`.
    fn queued_processing(since: Timestamp) -> Processing {
        let mut processing = Processing::new(ProcessingConfig {
            max_attempts: 3,
            run_timeout: Duration::from_secs(10),
            retry_backoff: Duration::from_secs(3),
        });
        processing.push(
            Trigger::Stage {
                seq: JournalSeq(5),
                stage: Stage::TobMaiden,
                attempt: None,
            },
            since,
        );
        processing
    }

    /// A processing run which has been running since `since`.
    fn running_processing(since: Timestamp) -> Processing {
        let mut processing = queued_processing(since);
        processing.start(JournalSeq(5), since);
        processing
    }

    /// A processing run which failed its first attempt at `since`.
    fn failed_processing(since: Timestamp) -> Processing {
        let mut processing = running_processing(since);
        processing.finish(
            ChallengeType::Tob,
            since,
            Err(ProcessingError {
                message: "scripted".into(),
                retriable: true,
            }),
        );
        processing
    }

    #[test]
    fn scaled_divides_every_window() {
        let config = test_config().scaled(10);
        assert_eq!(config.stage_end_timeout, Duration::from_millis(200));
        assert_eq!(config.challenge_end_grace, Duration::from_millis(450));
        assert_eq!(config.reconnection_window, Duration::from_secs(30));
        assert_eq!(config.inactivity_timeout, Duration::from_secs(90));
        assert_eq!(config.lease_renewal_interval, Duration::from_secs(1));
        assert_eq!(config.processing.run_timeout, Duration::from_secs(3));
        assert_eq!(config.processing.retry_backoff, Duration::from_millis(500));
        assert_eq!(config.processing.max_attempts, 0);
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
            phase: PhaseState::Finishing {
                since: Timestamp::from_millis(5_100),
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
            phase: PhaseState::Finishing {
                since: Timestamp::from_millis(5_100),
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
        state.phase = PhaseState::Finishing {
            since: Timestamp::from_millis(8_000),
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
            phase: PhaseState::Finishing {
                since: Timestamp::from_millis(5_000),
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
    fn dormant_challenge_derives_cleanup() {
        let mut state = mid_stage_state();
        for client in state.clients.values_mut() {
            client.active = false;
        }
        state.dormant_since = Some(Timestamp::from_millis(10_000));
        assert_eq!(
            next_deadline(&state, &test_config()),
            Some(Deadline {
                kind: DeadlineKind::CleanupAllIdle,
                at: Timestamp::from_millis(910_000),
            }),
        );

        // The last idle client disconnects, restarting the window.
        state.clients.clear();
        state.dormant_since = Some(Timestamp::from_millis(20_000));
        assert_eq!(
            next_deadline(&state, &test_config()),
            Some(Deadline {
                kind: DeadlineKind::CleanupDisconnect,
                at: Timestamp::from_millis(320_000),
            }),
        );
    }

    #[test]
    fn settlement_deadlines_precede_cleanup() {
        let mut state = ChallengeState {
            stage_state: StageState::Ending {
                since: Timestamp::from_millis(5_000),
            },
            dormant_since: Some(Timestamp::from_millis(5_050)),
            ..mid_stage_state()
        };
        state.clients.clear();
        assert_eq!(
            next_deadline(&state, &test_config()),
            Some(Deadline {
                kind: DeadlineKind::StageEnd,
                at: Timestamp::from_millis(7_000),
            }),
        );

        state.stage_state = StageState::Complete {
            since: Timestamp::from_millis(7_000),
        };
        state.phase = PhaseState::Finishing {
            since: Timestamp::from_millis(7_100),
        };
        assert_eq!(
            next_deadline(&state, &test_config()),
            Some(Deadline {
                kind: DeadlineKind::ChallengeEnd,
                at: Timestamp::from_millis(11_600),
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
    fn terminated_challenge_without_processing_has_no_deadlines() {
        let state = ChallengeState {
            phase: PhaseState::Terminated,
            stage_state: StageState::Complete {
                since: Timestamp::from_millis(7_000),
            },
            ..mid_stage_state()
        };
        assert_eq!(next_deadline(&state, &LifecycleConfig::default()), None);
    }

    #[test]
    fn queued_processing_run_is_due_immediately() {
        let state = ChallengeState {
            processing: queued_processing(Timestamp::from_millis(5_000)),
            ..mid_stage_state()
        };
        assert_eq!(
            next_deadline(&state, &test_config()),
            Some(Deadline {
                kind: DeadlineKind::ProcessingRetry,
                at: Timestamp::from_millis(5_000),
            }),
        );
    }

    #[test]
    fn failed_processing_run_waits_for_retry() {
        let state = ChallengeState {
            processing: failed_processing(Timestamp::from_millis(5_000)),
            ..mid_stage_state()
        };
        assert_eq!(
            next_deadline(&state, &test_config()),
            Some(Deadline {
                kind: DeadlineKind::ProcessingRetry,
                at: Timestamp::from_millis(8_000),
            }),
        );
    }

    #[test]
    fn active_processing_run_has_a_timeout() {
        let state = ChallengeState {
            processing: running_processing(Timestamp::from_millis(5_000)),
            ..mid_stage_state()
        };
        assert_eq!(
            next_deadline(&state, &test_config()),
            Some(Deadline {
                kind: DeadlineKind::ProcessingTimeout,
                at: Timestamp::from_millis(15_000),
            }),
        );
    }

    #[test]
    fn terminated_challenge_with_active_processing_has_a_timeout() {
        let state = ChallengeState {
            phase: PhaseState::Terminated,
            processing: running_processing(Timestamp::from_millis(5_000)),
            ..mid_stage_state()
        };
        assert_eq!(
            next_deadline(&state, &test_config()),
            Some(Deadline {
                kind: DeadlineKind::ProcessingTimeout,
                at: Timestamp::from_millis(15_000),
            }),
        );
    }

    #[test]
    fn earliest_deadline_wins() {
        // The stage end grace period at 7s beats the processing timeout at 15s.
        let mut state = ChallengeState {
            stage_state: StageState::Ending {
                since: Timestamp::from_millis(5_000),
            },
            processing: running_processing(Timestamp::from_millis(5_000)),
            ..mid_stage_state()
        };
        assert_eq!(
            next_deadline(&state, &test_config()),
            Some(Deadline {
                kind: DeadlineKind::StageEnd,
                at: Timestamp::from_millis(7_000),
            }),
        );

        // A queued run beats the stage end.
        state.processing = queued_processing(Timestamp::from_millis(5_500));
        assert_eq!(
            next_deadline(&state, &test_config()),
            Some(Deadline {
                kind: DeadlineKind::ProcessingRetry,
                at: Timestamp::from_millis(5_500),
            }),
        );
    }
}

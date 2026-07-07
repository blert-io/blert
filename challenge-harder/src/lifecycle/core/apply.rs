//! Journal event handling.
//!
//! This module represents the application half of challenge command processing,
//! building up challenge state from journal decisions.

use super::command::StageProgress;
use super::event::{Cause, JournalEntry, LifecycleEvent};
use super::state::{ChallengeState, ClientState, PhaseState, StageState};
use super::types::{ClientId, StageExt, StageStatus, Timestamp};

// it's an exhaustive enum folks
#[allow(clippy::too_many_lines)]
pub fn apply(state: &mut ChallengeState, entry: JournalEntry) {
    if let Cause::Command(id) = entry.caused_by {
        state.cursor = id;
    }

    let before = Dormancy::of(state);

    match entry.event {
        LifecycleEvent::ChallengeCreated {
            uuid,
            challenge_type,
            mode,
            party,
            stage,
        } => {
            state.uuid = uuid;
            state.challenge_type = challenge_type;
            state.mode = mode;
            state.party = party;
            state.stage = stage;
            state.stage_attempt = None;
            state.stage_status = StageStatus::Entered;
            state.stage_state = StageState::InProgress;
        }
        LifecycleEvent::ClientJoined {
            client_id,
            user_id,
            session_token,
            recording_type,
        } => {
            state.clients.insert(
                client_id,
                ClientState {
                    user_id,
                    session_token,
                    recording_type,
                    active: true,
                    stage: state.stage,
                    stage_status: StageStatus::Entered,
                    stage_attempt: state.stage_attempt,
                },
            );
        }
        LifecycleEvent::ClientStageReported {
            client_id,
            attempt,
            update,
        } => stage_reported(state, entry.at, client_id, attempt, update),
        LifecycleEvent::StageStarted { stage } => {
            state.stage = stage;
            state.stage_attempt = stage.is_retriable().then_some(1);
            state.stage_status = StageStatus::Started;
            state.stage_state = StageState::InProgress;
        }
        LifecycleEvent::StageAttemptStarted { attempt, .. } => {
            state.stage_attempt = Some(attempt);
            state.stage_status = StageStatus::Started;
            state.stage_state = StageState::InProgress;
        }
        LifecycleEvent::StageSealed { .. } => {
            state.stage_state = StageState::Complete { since: entry.at };
        }
        LifecycleEvent::ChallengeFinishing { status } => {
            state.phase = PhaseState::Finishing {
                since: entry.at,
                status,
            };
        }
        LifecycleEvent::ClientFinished {
            client_id, times, ..
        } => {
            state.clients.remove(&client_id);
            state.reported_times = state.reported_times.or(times);
        }
        LifecycleEvent::ClientActivated { client_id } => {
            if let Some(client) = state.clients.get_mut(&client_id) {
                client.active = true;
            }
        }
        LifecycleEvent::ClientIdled { client_id } => {
            if let Some(client) = state.clients.get_mut(&client_id) {
                client.active = false;
            }
        }
        LifecycleEvent::ClientRemoved { client_id } => {
            state.clients.remove(&client_id);
        }
        LifecycleEvent::ChallengeTerminated { status, empty: _ } => {
            state.phase = PhaseState::Terminated { status };
            state.reported_times = None;
        }
        LifecycleEvent::ModeChanged { mode } => {
            state.mode = mode;
        }
        LifecycleEvent::PartyChanged { .. }
        | LifecycleEvent::StageProcessingStarted { .. }
        | LifecycleEvent::StageProcessingFinished { .. }
        | LifecycleEvent::StageProcessingFailed { .. }
        | LifecycleEvent::StageProcessingTimedOut { .. } => todo!(),
    }

    // Check whether the challenge's clients have gone inactive.
    let after = Dormancy::of(state);
    if after == Dormancy::Active {
        state.dormant_since = None;
    } else if after != before {
        state.dormant_since = Some(entry.at);
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Dormancy {
    /// At least one client is connected and active.
    Active,
    /// Clients are connected, but all are idle.
    Idle,
    /// No clients remain.
    Empty,
}

impl Dormancy {
    fn of(state: &ChallengeState) -> Self {
        if state.clients.is_empty() {
            Self::Empty
        } else if state.clients.values().all(|client| !client.active) {
            Self::Idle
        } else {
            Self::Active
        }
    }
}

fn stage_reported(
    state: &mut ChallengeState,
    at: Timestamp,
    client_id: ClientId,
    attempt: Option<u32>,
    update: StageProgress,
) {
    if let Some(client) = state.clients.get_mut(&client_id) {
        client.stage = update.stage;
        client.stage_status = update.status;
        client.stage_attempt = attempt;
        client.active = true;
    }

    let finished = update.status == StageStatus::Completed || update.status == StageStatus::Wiped;
    if finished && attempt == state.stage_attempt && state.stage_state == StageState::InProgress {
        state.stage_status = update.status;
        state.stage_state = StageState::Ending { since: at };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lifecycle::core::command::StageProgress;
    use crate::lifecycle::core::deadline::DeadlineKind;
    use crate::lifecycle::core::types::{
        ChallengeMode, ChallengeStatus, ChallengeType, ClientId, JournalSeq, MsgId, RecordingType,
        ReportedTimes, Stage, Timestamp, UserId, Uuid,
    };

    const CLIENT: ClientId = ClientId(10);

    fn entry(at_ms: u64, msg: u64, event: LifecycleEvent) -> JournalEntry {
        JournalEntry {
            seq: JournalSeq(0),
            at: Timestamp::from_millis(at_ms),
            caused_by: Cause::Command(MsgId::sequence(msg)),
            event,
        }
    }

    fn created_state(
        challenge_type: ChallengeType,
        mode: ChallengeMode,
        stage: Stage,
    ) -> ChallengeState {
        #![allow(clippy::similar_names)]
        let uuid = Uuid::from_u128(0xb1e47);
        let mut state = ChallengeState {
            uuid,
            ..ChallengeState::default()
        };
        apply(
            &mut state,
            entry(
                0,
                1,
                LifecycleEvent::ChallengeCreated {
                    uuid,
                    challenge_type,
                    mode,
                    party: vec!["Skitter".into()],
                    stage,
                },
            ),
        );
        apply(
            &mut state,
            entry(
                0,
                1,
                LifecycleEvent::ClientJoined {
                    client_id: CLIENT,
                    user_id: UserId(1),
                    session_token: "tok".into(),
                    recording_type: RecordingType::Participant,
                },
            ),
        );
        state
    }

    fn created_tob_state() -> ChallengeState {
        created_state(
            ChallengeType::Tob,
            ChallengeMode::TobRegular,
            Stage::TobMaiden,
        )
    }

    fn report(stage: Stage, status: StageStatus) -> LifecycleEvent {
        LifecycleEvent::ClientStageReported {
            client_id: CLIENT,
            attempt: None,
            update: StageProgress { stage, status },
        }
    }

    #[test]
    fn challenge_created_initializes_state() {
        let state = created_tob_state();
        assert_eq!(state.challenge_type, ChallengeType::Tob);
        assert_eq!(state.mode, ChallengeMode::TobRegular);
        assert_eq!(state.party, vec!["Skitter".to_string()]);
        assert_eq!(state.stage, Stage::TobMaiden);
        assert_eq!(state.stage_attempt, None);
        assert_eq!(state.stage_status, StageStatus::Entered);
        assert_eq!(state.stage_state, StageState::InProgress);
        assert_eq!(state.cursor, MsgId::sequence(1));

        let client = &state.clients[&CLIENT];
        assert!(client.active);
        assert_eq!(client.stage, Stage::TobMaiden);
        assert_eq!(client.stage_status, StageStatus::Entered);
        assert_eq!(client.stage_attempt, None);
    }

    #[test]
    fn stage_report_updates_client() {
        let mut state = created_tob_state();
        apply(
            &mut state,
            entry(1_000, 2, report(Stage::TobMaiden, StageStatus::Started)),
        );
        let client = &state.clients[&CLIENT];
        assert_eq!(client.stage_status, StageStatus::Started);
        // A client report alone does not start a stage.
        assert_eq!(state.stage_status, StageStatus::Entered);
        assert_eq!(state.stage_state, StageState::InProgress);
        assert_eq!(state.cursor, MsgId::sequence(2));
    }

    #[test]
    fn finished_report_opens_straggler_window() {
        let mut state = created_tob_state();
        apply(
            &mut state,
            entry(5_000, 2, report(Stage::TobMaiden, StageStatus::Completed)),
        );
        assert_eq!(
            state.stage_state,
            StageState::Ending {
                since: Timestamp::from_millis(5_000)
            }
        );
        assert_eq!(state.stage_status, StageStatus::Completed);

        // The window opens at the first finisher and stays put.
        apply(
            &mut state,
            entry(6_500, 3, report(Stage::TobMaiden, StageStatus::Wiped)),
        );
        assert_eq!(
            state.stage_state,
            StageState::Ending {
                since: Timestamp::from_millis(5_000)
            }
        );
        // The first finisher's view of the stage outcome also stays put.
        assert_eq!(state.stage_status, StageStatus::Completed);
    }

    #[test]
    fn stage_sealed_finalizes_stream() {
        let mut state = created_tob_state();
        apply(
            &mut state,
            entry(5_000, 2, report(Stage::TobMaiden, StageStatus::Completed)),
        );
        apply(
            &mut state,
            entry(
                5_000,
                2,
                LifecycleEvent::StageSealed {
                    stage: Stage::TobMaiden,
                    attempt: None,
                    forced: false,
                },
            ),
        );
        assert_eq!(
            state.stage_state,
            StageState::Complete {
                since: Timestamp::from_millis(5_000)
            }
        );
        assert_eq!(state.stage_status, StageStatus::Completed);
    }

    #[test]
    fn deadline_caused_entry_does_not_advance_cursor() {
        let mut state = created_tob_state();
        apply(
            &mut state,
            entry(5_000, 2, report(Stage::TobMaiden, StageStatus::Completed)),
        );
        apply(
            &mut state,
            JournalEntry {
                seq: JournalSeq(1),
                at: Timestamp::from_millis(7_000),
                caused_by: Cause::Deadline(DeadlineKind::StageEnd),
                event: LifecycleEvent::StageSealed {
                    stage: Stage::TobMaiden,
                    attempt: None,
                    forced: true,
                },
            },
        );
        assert_eq!(
            state.stage_state,
            StageState::Complete {
                since: Timestamp::from_millis(7_000)
            }
        );
        assert_eq!(state.cursor, MsgId::sequence(2));
    }

    #[test]
    fn stage_started_advances_challenge() {
        let mut state = created_tob_state();
        state.stage_state = StageState::Complete {
            since: Timestamp::from_millis(5_000),
        };
        apply(
            &mut state,
            entry(
                9_000,
                4,
                LifecycleEvent::StageStarted {
                    stage: Stage::TobBloat,
                },
            ),
        );
        assert_eq!(state.stage, Stage::TobBloat);
        assert_eq!(state.stage_attempt, None);
        assert_eq!(state.stage_status, StageStatus::Started);
        assert_eq!(state.stage_state, StageState::InProgress);
    }

    #[test]
    fn retriable_stage_starts_at_attempt_one() {
        let mut state = ChallengeState::default();
        apply(
            &mut state,
            entry(
                0,
                1,
                LifecycleEvent::ChallengeCreated {
                    uuid: Uuid::default(),
                    challenge_type: ChallengeType::Mokhaiotl,
                    mode: ChallengeMode::NoMode,
                    party: vec!["Skitter".into()],
                    stage: Stage::MokhaiotlDelve1,
                },
            ),
        );
        apply(
            &mut state,
            entry(
                60_000,
                2,
                LifecycleEvent::StageStarted {
                    stage: Stage::MokhaiotlDelve8plus,
                },
            ),
        );
        assert_eq!(state.stage_attempt, Some(1));
    }

    #[test]
    fn client_joined_inherits_challenge_position() {
        let mut state = created_tob_state();
        apply(
            &mut state,
            entry(
                9_000,
                4,
                LifecycleEvent::StageStarted {
                    stage: Stage::TobBloat,
                },
            ),
        );
        apply(
            &mut state,
            entry(
                10_000,
                5,
                LifecycleEvent::ClientJoined {
                    client_id: ClientId(20),
                    user_id: UserId(1),
                    session_token: "tok".into(),
                    recording_type: RecordingType::Spectator,
                },
            ),
        );
        let client = &state.clients[&ClientId(20)];
        assert!(client.active);
        assert_eq!(client.stage, Stage::TobBloat);
        assert_eq!(client.stage_status, StageStatus::Entered);
        assert_eq!(client.stage_attempt, None);
    }

    #[test]
    fn client_finished_removes_client_and_keeps_first_times() {
        let mut state = created_tob_state();
        for client_id in [ClientId(20), ClientId(30)] {
            apply(
                &mut state,
                entry(
                    0,
                    1,
                    LifecycleEvent::ClientJoined {
                        client_id,
                        user_id: UserId(2),
                        session_token: "tok2".into(),
                        recording_type: RecordingType::Participant,
                    },
                ),
            );
        }

        let times = ReportedTimes {
            challenge: 1_437,
            overall: 1_500,
        };
        apply(
            &mut state,
            entry(
                9_000,
                2,
                LifecycleEvent::ClientFinished {
                    client_id: CLIENT,
                    definitive: true,
                    soft: false,
                    times: Some(times),
                },
            ),
        );
        assert_eq!(state.clients.len(), 2);
        assert_eq!(state.reported_times, Some(times));

        // A later finish without times must not clear the stored ones.
        apply(
            &mut state,
            entry(
                9_500,
                3,
                LifecycleEvent::ClientFinished {
                    client_id: ClientId(20),
                    definitive: false,
                    soft: true,
                    times: None,
                },
            ),
        );
        assert_eq!(state.reported_times, Some(times));

        // A later update does not change stored times.
        apply(
            &mut state,
            entry(
                9_800,
                4,
                LifecycleEvent::ClientFinished {
                    client_id: ClientId(30),
                    definitive: true,
                    soft: false,
                    times: Some(ReportedTimes {
                        challenge: 1_440,
                        overall: 1_503,
                    }),
                },
            ),
        );
        assert!(state.clients.is_empty());
        assert_eq!(state.reported_times, Some(times));
    }

    #[test]
    fn challenge_finishing_enters_finishing_phase() {
        let mut state = created_tob_state();
        apply(
            &mut state,
            entry(
                9_000,
                2,
                LifecycleEvent::ChallengeFinishing {
                    status: ChallengeStatus::Wiped,
                },
            ),
        );
        assert_eq!(
            state.phase,
            PhaseState::Finishing {
                since: Timestamp::from_millis(9_000),
                status: ChallengeStatus::Wiped,
            }
        );
    }

    #[test]
    fn client_removed_drops_client() {
        let mut state = created_tob_state();
        apply(
            &mut state,
            entry(
                0,
                1,
                LifecycleEvent::ClientJoined {
                    client_id: ClientId(20),
                    user_id: UserId(2),
                    session_token: "tok2".into(),
                    recording_type: RecordingType::Participant,
                },
            ),
        );
        assert_eq!(state.clients.len(), 2);

        apply(
            &mut state,
            entry(
                9_000,
                2,
                LifecycleEvent::ClientRemoved {
                    client_id: ClientId(20),
                },
            ),
        );

        assert_eq!(state.clients.len(), 1);
        assert_eq!(state.clients.get(&ClientId(20)), None);
    }

    #[test]
    fn client_status_events_toggle_active() {
        let mut state = created_tob_state();
        apply(
            &mut state,
            entry(1_000, 2, LifecycleEvent::ClientIdled { client_id: CLIENT }),
        );
        assert!(!state.clients[&CLIENT].active);

        apply(
            &mut state,
            entry(
                2_000,
                3,
                LifecycleEvent::ClientActivated { client_id: CLIENT },
            ),
        );
        assert!(state.clients[&CLIENT].active);
    }

    #[test]
    fn challenge_terminated_sets_status() {
        let mut state = created_tob_state();
        apply(
            &mut state,
            entry(
                9_000,
                2,
                LifecycleEvent::ChallengeTerminated {
                    status: ChallengeStatus::Reset,
                    empty: false,
                },
            ),
        );
        assert_eq!(
            state.phase,
            PhaseState::Terminated {
                status: ChallengeStatus::Reset
            }
        );
    }

    #[test]
    fn stage_attempt_started_begins_new_attempt() {
        let mut state = created_state(ChallengeType::Toa, ChallengeMode::NoMode, Stage::ToaBaba);
        apply(
            &mut state,
            entry(
                5_000,
                2,
                LifecycleEvent::StageAttemptStarted {
                    stage: Stage::ToaBaba,
                    attempt: 2,
                },
            ),
        );
        assert_eq!(state.stage, Stage::ToaBaba);
        assert_eq!(state.stage_attempt, Some(2));
        assert_eq!(state.stage_status, StageStatus::Started);
        assert_eq!(state.stage_state, StageState::InProgress);
    }

    #[test]
    fn superseded_attempt_report_does_not_open_window() {
        let mut state = created_state(ChallengeType::Toa, ChallengeMode::NoMode, Stage::ToaBaba);
        apply(
            &mut state,
            entry(
                5_000,
                2,
                LifecycleEvent::StageAttemptStarted {
                    stage: Stage::ToaBaba,
                    attempt: 2,
                },
            ),
        );

        // A late report for the superseded attempt.
        apply(
            &mut state,
            entry(
                6_000,
                3,
                LifecycleEvent::ClientStageReported {
                    client_id: CLIENT,
                    attempt: Some(1),
                    update: StageProgress {
                        stage: Stage::ToaBaba,
                        status: StageStatus::Wiped,
                    },
                },
            ),
        );
        assert_eq!(state.stage_state, StageState::InProgress);
        assert_eq!(state.stage_status, StageStatus::Started);

        apply(
            &mut state,
            entry(
                7_000,
                4,
                LifecycleEvent::ClientStageReported {
                    client_id: CLIENT,
                    attempt: Some(2),
                    update: StageProgress {
                        stage: Stage::ToaBaba,
                        status: StageStatus::Wiped,
                    },
                },
            ),
        );
        assert_eq!(
            state.stage_state,
            StageState::Ending {
                since: Timestamp::from_millis(7_000)
            }
        );
        assert_eq!(state.stage_status, StageStatus::Wiped);
    }
}

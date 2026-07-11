//! Challenge command handling.
//!
//! This module represents the decision half of challenge command processing,
//! converting incoming commands to a set of intended actions that are later
//! applied.

use super::command::{ClientStatus, ClientStatusChange, Command, Create, Finish, Join, Update};
use super::deadline::{Deadline, DeadlineKind, LifecycleConfig, next_deadline};
use super::event::LifecycleEvent;
use super::state::{ChallengeState, ClientState, PhaseState, StageState};
use super::types::{
    ChallengeMode, ChallengeStatus, ChallengeType, ChallengeTypeExt, RecordingType, Stage,
    StageExt, StageStatus,
};

/// Produces a series of journal events from a received command, detailing the
/// actions the challenge should take in response to the command.
pub fn decide(
    state: &ChallengeState,
    config: &LifecycleConfig,
    cmd: &Command,
) -> Vec<LifecycleEvent> {
    if let PhaseState::Terminated { .. } = state.phase {
        todo!("commands after termination");
    }

    match cmd {
        Command::Create(c) => create(state, c),
        Command::Join(j) => join(state, j),
        Command::Update(u) => update(state, u),
        Command::Finish(f) => finish(state, f),
        Command::ClientStatus(c) => client_status(state, c),
        Command::DeadlineFired(d) => deadline_fired(state, config, *d),
        Command::StageProcessed(_) => todo!(),
    }
}

fn is_finished(status: StageStatus) -> bool {
    status == StageStatus::Completed || status == StageStatus::Wiped
}

fn create(state: &ChallengeState, c: &Create) -> Vec<LifecycleEvent> {
    if state.challenge_type != ChallengeType::UnknownChallenge {
        todo!("duplicate create");
    }

    vec![
        LifecycleEvent::ChallengeCreated {
            uuid: state.uuid,
            challenge_type: c.challenge_type,
            mode: c.mode,
            party: c.party.clone(),
            stage: c.stage,
        },
        LifecycleEvent::ClientJoined {
            client_id: c.client_id,
            user_id: c.user_id,
            session_token: c.session_token.clone(),
            recording_type: c.recording_type,
        },
    ]
}

fn join(state: &ChallengeState, join: &Join) -> Vec<LifecycleEvent> {
    if state.clients.contains_key(&join.client_id) {
        // A replacement connection can join before its predecessor's death is
        // detected. Refresh the existing session token.
        return vec![LifecycleEvent::ClientRejoined {
            client_id: join.client_id,
            session_token: join.session_token.clone(),
        }];
    }

    vec![LifecycleEvent::ClientJoined {
        client_id: join.client_id,
        user_id: join.user_id,
        session_token: join.session_token.clone(),
        recording_type: join.recording_type,
    }]
}

fn update(state: &ChallengeState, update: &Update) -> Vec<LifecycleEvent> {
    let mut events = Vec::new();

    if let Some(mode) = update.mode
        && mode != ChallengeMode::NoMode
        && mode != state.mode
    {
        events.push(LifecycleEvent::ModeChanged { mode });
    }
    if update.party.as_ref().is_some_and(|p| *p != state.party) {
        todo!("party changes");
    }

    let Some(progress) = &update.stage else {
        return events;
    };

    if progress.stage < state.stage {
        todo!("late reports for earlier stages");
    }

    let Some(client) = state.clients.get(&update.client_id) else {
        todo!("reports from unknown clients");
    };

    match progress.status {
        StageStatus::Completed | StageStatus::Wiped => {
            events.push(LifecycleEvent::ClientStageReported {
                client_id: update.client_id,
                attempt: client.stage_attempt,
                update: *progress,
            });

            // Seal the stage when every client has finished it.
            let finished = |stage: Stage, status: StageStatus, attempt: Option<u32>| {
                stage > state.stage // TODO(frolv): handle toa
                    || (is_finished(status) && attempt.max(state.stage_attempt) == attempt)
            };
            let all_finished = state.clients.iter().all(|(id, c)| {
                if *id == update.client_id {
                    finished(progress.stage, progress.status, client.stage_attempt)
                } else {
                    finished(c.stage, c.stage_status, c.stage_attempt)
                }
            });

            if all_finished && !matches!(state.stage_state, StageState::Complete { .. }) {
                events.push(LifecycleEvent::StageSealed {
                    stage: progress.stage,
                    attempt: client.stage_attempt,
                    forced: false,
                });
            }
        }
        StageStatus::Started => {
            if progress.stage != state.stage || state.stage_status == StageStatus::Entered {
                events.push(LifecycleEvent::StageStarted {
                    stage: progress.stage,
                });
                events.push(LifecycleEvent::ClientStageReported {
                    client_id: update.client_id,
                    attempt: progress.stage.is_retriable().then_some(1),
                    update: *progress,
                });
            } else {
                match state.stage_attempt {
                    // The first client to restart the stage's current attempt
                    // begins a new one.
                    Some(attempt)
                        if client.stage == state.stage && client.stage_attempt == Some(attempt) =>
                    {
                        if !matches!(state.stage_state, StageState::Complete { .. }) {
                            // Seal the last stage now that a new one has begun.
                            events.push(LifecycleEvent::StageSealed {
                                stage: state.stage,
                                attempt: Some(attempt),
                                forced: true,
                            });
                        }
                        events.push(LifecycleEvent::StageAttemptStarted {
                            stage: state.stage,
                            attempt: attempt + 1,
                        });
                        events.push(LifecycleEvent::ClientStageReported {
                            client_id: update.client_id,
                            attempt: Some(attempt + 1),
                            update: *progress,
                        });
                    }
                    _ => {
                        // The client is syncing to the challenge's current
                        // stage and attempt.
                        events.push(LifecycleEvent::ClientStageReported {
                            client_id: update.client_id,
                            attempt: state.stage_attempt,
                            update: *progress,
                        });
                    }
                }
            }
        }
        StageStatus::Entered => {
            // Entering a stage only updates the client's own record; the stage
            // starts when a client reports STARTED.
            events.push(LifecycleEvent::ClientStageReported {
                client_id: update.client_id,
                attempt: client.stage_attempt,
                update: *progress,
            });
        }
    }

    events
}

fn client_status(state: &ChallengeState, change: &ClientStatusChange) -> Vec<LifecycleEvent> {
    let Some(client) = state.clients.get(&change.client_id) else {
        // The client has already finished or been removed.
        return Vec::new();
    };

    // Ensure that this connection still owns the client state instead of a stale report.
    if client.session_token != change.session_token {
        return Vec::new();
    }

    match change.status {
        ClientStatus::Active if !client.active => vec![LifecycleEvent::ClientActivated {
            client_id: change.client_id,
        }],
        ClientStatus::Idle if client.active => vec![LifecycleEvent::ClientIdled {
            client_id: change.client_id,
        }],
        ClientStatus::Active | ClientStatus::Idle => Vec::new(),
        ClientStatus::Disconnected => vec![LifecycleEvent::ClientRemoved {
            client_id: change.client_id,
        }],
    }
}

fn deadline_fired(
    state: &ChallengeState,
    config: &LifecycleConfig,
    fired: Deadline,
) -> Vec<LifecycleEvent> {
    // Check if the deadline is still valid for the current state or if it has
    // been implicitly superseded or canceled.
    if next_deadline(state, config) != Some(fired) {
        return Vec::new();
    }

    match fired.kind {
        DeadlineKind::StageEnd => vec![LifecycleEvent::StageSealed {
            stage: state.stage,
            attempt: state.stage_attempt,
            forced: true,
        }],
        DeadlineKind::ChallengeEnd => {
            let PhaseState::Finishing { status, .. } = state.phase else {
                unreachable!("ChallengeEnd is only derivable when finishing");
            };

            // Clients which never sent their finish requests are cut off.
            let mut events: Vec<LifecycleEvent> = state
                .clients
                .keys()
                .map(|&client_id| LifecycleEvent::ClientRemoved { client_id })
                .collect();
            events.push(LifecycleEvent::ChallengeTerminated {
                status,
                // TODO(frolv): Set based on recorded data once stage processing exists.
                empty: false,
            });
            events
        }
        DeadlineKind::CleanupDisconnect => vec![LifecycleEvent::ChallengeTerminated {
            status: terminal_status(state.challenge_type, state.stage, state.stage_status),
            // TODO(frolv): Set based on recorded data once stage processing exists.
            empty: false,
        }],
        DeadlineKind::CleanupAllIdle => {
            let mut events: Vec<LifecycleEvent> = state
                .clients
                .keys()
                .map(|&client_id| LifecycleEvent::ClientRemoved { client_id })
                .collect();
            events.push(LifecycleEvent::ChallengeTerminated {
                status: terminal_status(state.challenge_type, state.stage, state.stage_status),
                // TODO(frolv): Set based on recorded data once stage processing exists.
                empty: false,
            });
            events
        }
    }
}

fn finish(state: &ChallengeState, finish: &Finish) -> Vec<LifecycleEvent> {
    let Some(client) = state.clients.get(&finish.client_id) else {
        todo!("finishes from unknown clients");
    };

    // Spectators may leave a challenge early before it has actually finished,
    // so their finish events don't count as definitive.
    let definitive = (!finish.soft && client.recording_type == RecordingType::Participant)
        || finish.times.is_some();

    let finished = LifecycleEvent::ClientFinished {
        client_id: finish.client_id,
        definitive,
        soft: finish.soft,
        times: finish.times,
    };

    if state.clients.len() > 1 {
        // Wait for other clients to report their finishes.
        let mut events = Vec::new();
        if definitive && matches!(state.phase, PhaseState::Active) {
            events.push(LifecycleEvent::ChallengeFinishing {
                status: terminal_status(state.challenge_type, client.stage, client.stage_status),
            });
        }
        events.push(finished);
        return events;
    }

    let mut events = vec![finished];
    if let StageState::Ending { .. } = state.stage_state {
        // Once the last client leaves, there is no longer a state end to
        // receive, so finalize the stage if it is still open.
        events.push(LifecycleEvent::StageSealed {
            stage: state.stage,
            attempt: state.stage_attempt,
            forced: true,
        });
    }

    let status = if let PhaseState::Finishing { status, .. } = state.phase {
        status
    } else {
        terminal_status(state.challenge_type, client.stage, client.stage_status)
    };
    events.push(LifecycleEvent::ChallengeTerminated {
        status,
        // TODO(frolv): Set based on recorded data once stage processing exists.
        empty: false,
    });
    events
}

// TODO(frolv): Temporary until stage processing exists. Callers pass either a
// client's view of the challenge or the challenge's own last known progress.
fn terminal_status(
    challenge_type: ChallengeType,
    stage: Stage,
    stage_status: StageStatus,
) -> ChallengeStatus {
    let last_stage = challenge_type.last_stage();

    // Some challenges can continue past their last stage. They should always
    // count as completed as long as the last stage is completed.
    if last_stage.is_some_and(|last| stage > last) {
        return ChallengeStatus::Completed;
    }

    match stage_status {
        StageStatus::Started => ChallengeStatus::Abandoned,
        StageStatus::Entered => ChallengeStatus::Reset,
        StageStatus::Wiped => ChallengeStatus::Wiped,
        StageStatus::Completed => {
            if last_stage.is_some_and(|last| stage == last) {
                ChallengeStatus::Completed
            } else {
                ChallengeStatus::Reset
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lifecycle::core::command::StageProgress;
    use crate::lifecycle::core::state::ClientState;
    use crate::lifecycle::core::types::{
        ClientId, RecordingType, ReportedTimes, Timestamp, UserId, Uuid,
    };

    const CLIENT_A: ClientId = ClientId(10);
    const CLIENT_B: ClientId = ClientId(20);

    fn client(stage: Stage, status: StageStatus, attempt: Option<u32>) -> ClientState {
        ClientState {
            user_id: UserId(1),
            session_token: "tok".into(),
            recording_type: RecordingType::Participant,
            active: true,
            stage,
            stage_status: status,
            stage_attempt: attempt,
        }
    }

    fn tob_state(clients: Vec<(ClientId, ClientState)>) -> ChallengeState {
        ChallengeState {
            uuid: Uuid::from_u128(0xb1e47),
            challenge_type: ChallengeType::Tob,
            mode: ChallengeMode::TobRegular,
            party: vec!["Skitter".into()],
            stage: Stage::TobMaiden,
            stage_status: StageStatus::Started,
            clients: clients.into_iter().collect(),
            ..ChallengeState::default()
        }
    }

    fn stage_update(client_id: ClientId, stage: Stage, status: StageStatus) -> Command {
        Command::Update(super::Update {
            user_id: UserId(1),
            client_id,
            session_token: "tok".into(),
            mode: Some(ChallengeMode::TobRegular),
            stage: Some(StageProgress { stage, status }),
            party: None,
        })
    }

    fn report(client_id: ClientId, stage: Stage, status: StageStatus) -> LifecycleEvent {
        LifecycleEvent::ClientStageReported {
            client_id,
            attempt: None,
            update: StageProgress { stage, status },
        }
    }

    #[test]
    fn create_emits_creation_and_creator_join() {
        let state = ChallengeState {
            uuid: Uuid::from_u128(0xb1e47),
            ..ChallengeState::default()
        };
        let create = Command::Create(super::Create {
            user_id: UserId(1),
            client_id: CLIENT_A,
            session_token: "tok".into(),
            plugin_version: "0.9.14".into(),
            runelite_version: "1.12.31.1".into(),
            challenge_type: ChallengeType::Tob,
            mode: ChallengeMode::TobRegular,
            party: vec!["Skitter".into()],
            stage: Stage::TobMaiden,
            recording_type: RecordingType::Participant,
        });
        assert_eq!(
            decide(&state, &LifecycleConfig::default(), &create),
            vec![
                LifecycleEvent::ChallengeCreated {
                    uuid: state.uuid,
                    challenge_type: ChallengeType::Tob,
                    mode: ChallengeMode::TobRegular,
                    party: vec!["Skitter".into()],
                    stage: Stage::TobMaiden,
                },
                LifecycleEvent::ClientJoined {
                    client_id: CLIENT_A,
                    user_id: UserId(1),
                    session_token: "tok".into(),
                    recording_type: RecordingType::Participant,
                },
            ],
        );
    }

    #[test]
    fn same_stage_start_syncs_client_without_advancing() {
        let state = tob_state(vec![(
            CLIENT_A,
            client(Stage::TobMaiden, StageStatus::Entered, None),
        )]);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &stage_update(CLIENT_A, Stage::TobMaiden, StageStatus::Started),
            ),
            vec![report(CLIENT_A, Stage::TobMaiden, StageStatus::Started)],
        );
    }

    #[test]
    fn creation_stage_start_begins_stage() {
        let state = ChallengeState {
            stage_status: StageStatus::Entered,
            ..tob_state(vec![(
                CLIENT_A,
                client(Stage::TobMaiden, StageStatus::Entered, None),
            )])
        };
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &stage_update(CLIENT_A, Stage::TobMaiden, StageStatus::Started),
            ),
            vec![
                LifecycleEvent::StageStarted {
                    stage: Stage::TobMaiden,
                },
                report(CLIENT_A, Stage::TobMaiden, StageStatus::Started),
            ],
        );
    }

    #[test]
    fn new_stage_start_advances_challenge() {
        let state = tob_state(vec![(
            CLIENT_A,
            client(Stage::TobMaiden, StageStatus::Completed, None),
        )]);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &stage_update(CLIENT_A, Stage::TobBloat, StageStatus::Started),
            ),
            vec![
                LifecycleEvent::StageStarted {
                    stage: Stage::TobBloat,
                },
                report(CLIENT_A, Stage::TobBloat, StageStatus::Started),
            ],
        );
    }

    #[test]
    fn lone_client_completion_seals() {
        let state = tob_state(vec![(
            CLIENT_A,
            client(Stage::TobMaiden, StageStatus::Started, None),
        )]);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &stage_update(CLIENT_A, Stage::TobMaiden, StageStatus::Completed),
            ),
            vec![
                report(CLIENT_A, Stage::TobMaiden, StageStatus::Completed),
                LifecycleEvent::StageSealed {
                    stage: Stage::TobMaiden,
                    attempt: None,
                    forced: false,
                },
            ],
        );
    }

    #[test]
    fn completion_with_straggler_does_not_seal() {
        let state = tob_state(vec![
            (
                CLIENT_A,
                client(Stage::TobMaiden, StageStatus::Started, None),
            ),
            (
                CLIENT_B,
                client(Stage::TobMaiden, StageStatus::Started, None),
            ),
        ]);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &stage_update(CLIENT_A, Stage::TobMaiden, StageStatus::Completed),
            ),
            vec![report(CLIENT_A, Stage::TobMaiden, StageStatus::Completed)],
        );
    }

    #[test]
    fn last_straggler_completion_seals() {
        let state = tob_state(vec![
            (
                CLIENT_A,
                client(Stage::TobMaiden, StageStatus::Completed, None),
            ),
            (
                CLIENT_B,
                client(Stage::TobMaiden, StageStatus::Started, None),
            ),
        ]);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &stage_update(CLIENT_B, Stage::TobMaiden, StageStatus::Wiped),
            ),
            vec![
                report(CLIENT_B, Stage::TobMaiden, StageStatus::Wiped),
                LifecycleEvent::StageSealed {
                    stage: Stage::TobMaiden,
                    attempt: None,
                    forced: false,
                },
            ],
        );
    }

    #[test]
    fn client_past_the_stage_counts_as_finished() {
        let state = tob_state(vec![
            (
                CLIENT_A,
                client(Stage::TobMaiden, StageStatus::Started, None),
            ),
            (
                CLIENT_B,
                client(Stage::TobBloat, StageStatus::Entered, None),
            ),
        ]);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &stage_update(CLIENT_A, Stage::TobMaiden, StageStatus::Completed),
            ),
            vec![
                report(CLIENT_A, Stage::TobMaiden, StageStatus::Completed),
                LifecycleEvent::StageSealed {
                    stage: Stage::TobMaiden,
                    attempt: None,
                    forced: false,
                },
            ],
        );
    }

    #[test]
    fn completion_after_seal_does_not_reseal() {
        let mut state = tob_state(vec![(
            CLIENT_A,
            client(Stage::TobMaiden, StageStatus::Completed, None),
        )]);
        state.stage_state = StageState::Complete {
            since: Timestamp::from_millis(5_000),
        };
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &stage_update(CLIENT_A, Stage::TobMaiden, StageStatus::Completed),
            ),
            vec![report(CLIENT_A, Stage::TobMaiden, StageStatus::Completed)],
        );
    }

    fn toa_state(clients: Vec<(ClientId, ClientState)>) -> ChallengeState {
        ChallengeState {
            uuid: Uuid::from_u128(0xb1e47),
            challenge_type: ChallengeType::Toa,
            mode: ChallengeMode::ToaNormal,
            party: vec!["715".into(), "WWWWWWWWWWQQ".into()],
            stage: Stage::ToaKephri,
            stage_attempt: Some(1),
            stage_status: StageStatus::Started,
            clients: clients.into_iter().collect(),
            ..ChallengeState::default()
        }
    }

    fn toa_update(client_id: ClientId, stage: Stage, status: StageStatus) -> Command {
        Command::Update(super::Update {
            user_id: UserId(1),
            client_id,
            session_token: "tok".into(),
            mode: None,
            stage: Some(StageProgress { stage, status }),
            party: None,
        })
    }

    fn report_attempt(
        client_id: ClientId,
        stage: Stage,
        status: StageStatus,
        attempt: u32,
    ) -> LifecycleEvent {
        LifecycleEvent::ClientStageReported {
            client_id,
            attempt: Some(attempt),
            update: StageProgress { stage, status },
        }
    }

    #[test]
    fn restart_during_stage_end_window_seals_previous_attempt() {
        let mut state = toa_state(vec![
            (
                CLIENT_A,
                client(Stage::ToaKephri, StageStatus::Wiped, Some(1)),
            ),
            (
                CLIENT_B,
                client(Stage::ToaKephri, StageStatus::Started, Some(1)),
            ),
        ]);
        state.stage_state = StageState::Ending {
            since: Timestamp::from_millis(5_000),
        };
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &toa_update(CLIENT_A, Stage::ToaKephri, StageStatus::Started),
            ),
            vec![
                LifecycleEvent::StageSealed {
                    stage: Stage::ToaKephri,
                    attempt: Some(1),
                    forced: true,
                },
                LifecycleEvent::StageAttemptStarted {
                    stage: Stage::ToaKephri,
                    attempt: 2,
                },
                report_attempt(CLIENT_A, Stage::ToaKephri, StageStatus::Started, 2),
            ],
        );
    }

    #[test]
    fn stale_attempt_start_syncs_to_current() {
        let mut state = toa_state(vec![
            (
                CLIENT_A,
                client(Stage::ToaKephri, StageStatus::Started, Some(2)),
            ),
            (
                CLIENT_B,
                client(Stage::ToaKephri, StageStatus::Wiped, Some(1)),
            ),
        ]);
        state.stage_attempt = Some(2);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &toa_update(CLIENT_B, Stage::ToaKephri, StageStatus::Started),
            ),
            vec![report_attempt(
                CLIENT_B,
                Stage::ToaKephri,
                StageStatus::Started,
                2
            )],
        );
    }

    #[test]
    fn stale_attempt_wipe_does_not_seal_current_attempt() {
        let mut state = toa_state(vec![
            (
                CLIENT_A,
                client(Stage::ToaKephri, StageStatus::Started, Some(2)),
            ),
            (
                CLIENT_B,
                client(Stage::ToaKephri, StageStatus::Started, Some(1)),
            ),
        ]);
        state.stage_attempt = Some(2);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &toa_update(CLIENT_B, Stage::ToaKephri, StageStatus::Wiped),
            ),
            vec![report_attempt(
                CLIENT_B,
                Stage::ToaKephri,
                StageStatus::Wiped,
                1
            )],
        );
    }

    #[test]
    fn catchup_start_with_matching_attempt_syncs() {
        // B's last report is a stage behind, but its stale attempt number
        // happens to equal the new stage's; it should not be treated as a
        // restart of the current stage.
        let state = toa_state(vec![
            (
                CLIENT_A,
                client(Stage::ToaKephri, StageStatus::Started, Some(1)),
            ),
            (
                CLIENT_B,
                client(Stage::ToaCrondis, StageStatus::Completed, Some(1)),
            ),
        ]);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &toa_update(CLIENT_B, Stage::ToaKephri, StageStatus::Started),
            ),
            vec![report_attempt(
                CLIENT_B,
                Stage::ToaKephri,
                StageStatus::Started,
                1
            )],
        );
    }

    fn finish_cmd(client_id: ClientId, soft: bool, times: Option<ReportedTimes>) -> Command {
        Command::Finish(super::Finish {
            user_id: UserId(1),
            client_id,
            session_token: "tok".into(),
            times,
            soft,
        })
    }

    #[test]
    fn spectator_leaving_mid_stage_abandons() {
        let mut spectator = client(Stage::TobMaiden, StageStatus::Started, None);
        spectator.recording_type = RecordingType::Spectator;
        let state = tob_state(vec![(CLIENT_A, spectator)]);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &finish_cmd(CLIENT_A, true, None)
            ),
            vec![
                LifecycleEvent::ClientFinished {
                    client_id: CLIENT_A,
                    definitive: false,
                    soft: true,
                    times: None,
                },
                LifecycleEvent::ChallengeTerminated {
                    status: ChallengeStatus::Abandoned,
                    empty: false,
                },
            ],
        );
    }

    #[test]
    fn finish_after_wipe_wipes() {
        let state = tob_state(vec![(
            CLIENT_A,
            client(Stage::TobMaiden, StageStatus::Wiped, None),
        )]);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &finish_cmd(CLIENT_A, false, None)
            ),
            vec![
                LifecycleEvent::ClientFinished {
                    client_id: CLIENT_A,
                    definitive: true,
                    soft: false,
                    times: None,
                },
                LifecycleEvent::ChallengeTerminated {
                    status: ChallengeStatus::Wiped,
                    empty: false,
                },
            ],
        );
    }

    #[test]
    fn finish_after_early_completion_resets() {
        let state = tob_state(vec![(
            CLIENT_A,
            client(Stage::TobMaiden, StageStatus::Completed, None),
        )]);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &finish_cmd(CLIENT_A, false, None)
            ),
            vec![
                LifecycleEvent::ClientFinished {
                    client_id: CLIENT_A,
                    definitive: true,
                    soft: false,
                    times: None,
                },
                LifecycleEvent::ChallengeTerminated {
                    status: ChallengeStatus::Reset,
                    empty: false,
                },
            ],
        );
    }

    #[test]
    fn finish_after_final_stage_completes() {
        let times = ReportedTimes {
            challenge: 1_437,
            overall: 1_500,
        };
        let state = tob_state(vec![(
            CLIENT_A,
            client(Stage::TobVerzik, StageStatus::Completed, None),
        )]);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &finish_cmd(CLIENT_A, false, Some(times))
            ),
            vec![
                LifecycleEvent::ClientFinished {
                    client_id: CLIENT_A,
                    definitive: true,
                    soft: false,
                    times: Some(times),
                },
                LifecycleEvent::ChallengeTerminated {
                    status: ChallengeStatus::Completed,
                    empty: false,
                },
            ],
        );
    }

    #[test]
    fn finish_after_deep_delve_wipe_completes() {
        let state = ChallengeState {
            uuid: Uuid::from_u128(0xb1e47),
            challenge_type: ChallengeType::Mokhaiotl,
            mode: ChallengeMode::NoMode,
            party: vec!["Plondreim".into()],
            stage: Stage::MokhaiotlDelve8plus,
            stage_attempt: Some(4),
            clients: [(
                CLIENT_A,
                client(Stage::MokhaiotlDelve8plus, StageStatus::Wiped, Some(4)),
            )]
            .into_iter()
            .collect(),
            ..ChallengeState::default()
        };
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &finish_cmd(CLIENT_A, false, None)
            ),
            vec![
                LifecycleEvent::ClientFinished {
                    client_id: CLIENT_A,
                    definitive: true,
                    soft: false,
                    times: None,
                },
                LifecycleEvent::ChallengeTerminated {
                    status: ChallengeStatus::Completed,
                    empty: false,
                },
            ],
        );
    }

    #[test]
    fn terminal_status_reflects_stage_position_and_outcome() {
        let cases = [
            (
                ChallengeType::Tob,
                Stage::TobMaiden,
                StageStatus::Started,
                ChallengeStatus::Abandoned,
            ),
            (
                ChallengeType::Tob,
                Stage::TobMaiden,
                StageStatus::Wiped,
                ChallengeStatus::Wiped,
            ),
            (
                ChallengeType::Tob,
                Stage::TobBloat,
                StageStatus::Completed,
                ChallengeStatus::Reset,
            ),
            (
                ChallengeType::Tob,
                Stage::TobNylocas,
                StageStatus::Entered,
                ChallengeStatus::Reset,
            ),
            (
                ChallengeType::Tob,
                Stage::TobVerzik,
                StageStatus::Completed,
                ChallengeStatus::Completed,
            ),
            (
                ChallengeType::Mokhaiotl,
                Stage::MokhaiotlDelve8,
                StageStatus::Started,
                ChallengeStatus::Abandoned,
            ),
            (
                ChallengeType::Mokhaiotl,
                Stage::MokhaiotlDelve8plus,
                StageStatus::Started,
                ChallengeStatus::Completed,
            ),
            (
                ChallengeType::Mokhaiotl,
                Stage::MokhaiotlDelve8plus,
                StageStatus::Wiped,
                ChallengeStatus::Completed,
            ),
        ];
        for (challenge_type, stage, stage_status, expected) in cases {
            assert_eq!(
                terminal_status(challenge_type, stage, stage_status),
                expected,
                "{challenge_type:?} at {stage:?} with {stage_status:?}",
            );
        }
    }

    fn status_change(client_id: ClientId, status: ClientStatus) -> Command {
        Command::ClientStatus(ClientStatusChange {
            user_id: UserId(1),
            client_id,
            session_token: "tok".into(),
            status,
        })
    }

    fn idle_client(stage: Stage, status: StageStatus, attempt: Option<u32>) -> ClientState {
        ClientState {
            active: false,
            ..client(stage, status, attempt)
        }
    }

    #[test]
    fn status_active_reactivates_idle_client() {
        let state = tob_state(vec![(
            CLIENT_A,
            idle_client(Stage::TobMaiden, StageStatus::Started, None),
        )]);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &status_change(CLIENT_A, ClientStatus::Active),
            ),
            vec![LifecycleEvent::ClientActivated {
                client_id: CLIENT_A
            }],
        );
    }

    #[test]
    fn status_idle_idles_active_client() {
        let state = tob_state(vec![(
            CLIENT_A,
            client(Stage::TobMaiden, StageStatus::Started, None),
        )]);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &status_change(CLIENT_A, ClientStatus::Idle),
            ),
            vec![LifecycleEvent::ClientIdled {
                client_id: CLIENT_A
            }],
        );
    }

    #[test]
    fn status_matching_client_state_is_a_noop() {
        let state = tob_state(vec![(
            CLIENT_A,
            client(Stage::TobMaiden, StageStatus::Started, None),
        )]);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &status_change(CLIENT_A, ClientStatus::Active),
            ),
            vec![],
        );

        let state = tob_state(vec![(
            CLIENT_A,
            idle_client(Stage::TobMaiden, StageStatus::Started, None),
        )]);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &status_change(CLIENT_A, ClientStatus::Idle),
            ),
            vec![],
        );
    }

    #[test]
    fn status_disconnected_removes_client() {
        let state = tob_state(vec![(
            CLIENT_A,
            client(Stage::TobMaiden, StageStatus::Started, None),
        )]);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &status_change(CLIENT_A, ClientStatus::Disconnected),
            ),
            vec![LifecycleEvent::ClientRemoved {
                client_id: CLIENT_A
            }],
        );
    }

    #[test]
    fn status_with_stale_token_is_ignored() {
        let state = tob_state(vec![(
            CLIENT_A,
            client(Stage::TobMaiden, StageStatus::Started, None),
        )]);
        let from_old_socket = Command::ClientStatus(ClientStatusChange {
            user_id: UserId(1),
            client_id: CLIENT_A,
            session_token: "stale".into(),
            status: ClientStatus::Disconnected,
        });
        assert_eq!(
            decide(&state, &LifecycleConfig::default(), &from_old_socket),
            vec![],
        );
    }

    #[test]
    fn status_for_unknown_client_is_ignored() {
        let state = tob_state(vec![(
            CLIENT_A,
            client(Stage::TobMaiden, StageStatus::Started, None),
        )]);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &status_change(CLIENT_B, ClientStatus::Disconnected),
            ),
            vec![],
        );
    }

    #[test]
    fn due_cleanup_disconnect_terminates_challenge() {
        let state = ChallengeState {
            stage: Stage::TobBloat,
            dormant_since: Some(Timestamp::from_millis(700)),
            ..tob_state(vec![])
        };
        let fired = Deadline {
            kind: DeadlineKind::CleanupDisconnect,
            at: Timestamp::from_millis(300_700),
        };
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &Command::DeadlineFired(fired),
            ),
            vec![LifecycleEvent::ChallengeTerminated {
                status: ChallengeStatus::Abandoned,
                empty: false,
            }],
        );
    }

    #[test]
    fn due_cleanup_all_idle_removes_clients_and_terminates() {
        let state = ChallengeState {
            dormant_since: Some(Timestamp::from_millis(5_000)),
            ..tob_state(vec![
                (
                    CLIENT_A,
                    idle_client(Stage::TobMaiden, StageStatus::Started, None),
                ),
                (
                    CLIENT_B,
                    idle_client(Stage::TobMaiden, StageStatus::Started, None),
                ),
            ])
        };
        let fired = Deadline {
            kind: DeadlineKind::CleanupAllIdle,
            at: Timestamp::from_millis(905_000),
        };
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &Command::DeadlineFired(fired),
            ),
            vec![
                LifecycleEvent::ClientRemoved {
                    client_id: CLIENT_A
                },
                LifecycleEvent::ClientRemoved {
                    client_id: CLIENT_B
                },
                LifecycleEvent::ChallengeTerminated {
                    status: ChallengeStatus::Abandoned,
                    empty: false,
                },
            ],
        );
    }

    #[test]
    fn mode_change_is_recorded_alongside_stage_report() {
        let state = tob_state(vec![(
            CLIENT_A,
            client(Stage::TobMaiden, StageStatus::Entered, None),
        )]);

        let mut cmd = Command::Update(super::Update {
            user_id: UserId(1),
            client_id: CLIENT_A,
            session_token: "tok".into(),
            mode: Some(ChallengeMode::TobHard),
            stage: Some(StageProgress {
                stage: Stage::TobMaiden,
                status: StageStatus::Started,
            }),
            party: None,
        });
        assert_eq!(
            decide(&state, &LifecycleConfig::default(), &cmd),
            vec![
                LifecycleEvent::ModeChanged {
                    mode: ChallengeMode::TobHard,
                },
                report(CLIENT_A, Stage::TobMaiden, StageStatus::Started),
            ],
        );

        // Re-sending the current mode is not a change.
        if let Command::Update(u) = &mut cmd {
            u.mode = Some(ChallengeMode::TobRegular);
        }
        assert_eq!(
            decide(&state, &LifecycleConfig::default(), &cmd),
            vec![report(CLIENT_A, Stage::TobMaiden, StageStatus::Started)],
        );

        // Nor is NO_MODE, which means no update.
        if let Command::Update(u) = &mut cmd {
            u.mode = Some(ChallengeMode::NoMode);
        }
        assert_eq!(
            decide(&state, &LifecycleConfig::default(), &cmd),
            vec![report(CLIENT_A, Stage::TobMaiden, StageStatus::Started)],
        );
    }

    #[test]
    fn entering_a_stage_updates_the_client_only() {
        let state = tob_state(vec![(
            CLIENT_A,
            client(Stage::TobMaiden, StageStatus::Completed, None),
        )]);

        // Walking into the next room before it starts must not advance the
        // challenge's stage.
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &stage_update(CLIENT_A, Stage::TobBloat, StageStatus::Entered),
            ),
            vec![report(CLIENT_A, Stage::TobBloat, StageStatus::Entered)],
        );
    }

    #[test]
    fn join_adds_new_client() {
        let state = tob_state(vec![(
            CLIENT_A,
            client(Stage::TobMaiden, StageStatus::Started, None),
        )]);
        let join = Command::Join(super::Join {
            user_id: UserId(2),
            client_id: CLIENT_B,
            session_token: "tok2".into(),
            plugin_version: "0.9.14".into(),
            runelite_version: "1.12.31.1".into(),
            recording_type: RecordingType::Spectator,
        });
        assert_eq!(
            decide(&state, &LifecycleConfig::default(), &join),
            vec![LifecycleEvent::ClientJoined {
                client_id: CLIENT_B,
                user_id: UserId(2),
                session_token: "tok2".into(),
                recording_type: RecordingType::Spectator,
            }],
        );
    }

    #[test]
    fn join_of_present_client_refreshes_it() {
        let state = tob_state(vec![(
            CLIENT_A,
            client(Stage::TobMaiden, StageStatus::Started, None),
        )]);
        let join = Command::Join(super::Join {
            user_id: UserId(1),
            client_id: CLIENT_A,
            session_token: "tok2".into(),
            plugin_version: "0.9.14".into(),
            runelite_version: "1.12.31.1".into(),
            recording_type: RecordingType::Participant,
        });
        assert_eq!(
            decide(&state, &LifecycleConfig::default(), &join),
            vec![LifecycleEvent::ClientRejoined {
                client_id: CLIENT_A,
                session_token: "tok2".into(),
            }],
        );
    }

    #[test]
    fn rejoin_during_finishing_is_accepted() {
        let mut state = tob_state(vec![
            (
                CLIENT_A,
                client(Stage::TobVerzik, StageStatus::Completed, None),
            ),
            (
                CLIENT_B,
                client(Stage::TobVerzik, StageStatus::Completed, None),
            ),
        ]);
        state.phase = PhaseState::Finishing {
            since: Timestamp::from_millis(1_000),
            status: ChallengeStatus::Completed,
        };
        let join = Command::Join(super::Join {
            user_id: UserId(1),
            client_id: CLIENT_A,
            session_token: "tok2".into(),
            plugin_version: "0.9.14".into(),
            runelite_version: "1.12.31.1".into(),
            recording_type: RecordingType::Participant,
        });
        assert_eq!(
            decide(&state, &LifecycleConfig::default(), &join),
            vec![LifecycleEvent::ClientRejoined {
                client_id: CLIENT_A,
                session_token: "tok2".into(),
            }],
        );
    }

    #[test]
    fn due_stage_end_deadline_forces_a_seal() {
        let mut state = tob_state(vec![
            (
                CLIENT_A,
                client(Stage::TobMaiden, StageStatus::Completed, None),
            ),
            (
                CLIENT_B,
                client(Stage::TobMaiden, StageStatus::Started, None),
            ),
        ]);
        state.stage_state = StageState::Ending {
            since: Timestamp::from_millis(5_000),
        };

        let fired = next_deadline(&state, &LifecycleConfig::default())
            .expect("stage ending implies a deadline");
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &Command::DeadlineFired(fired),
            ),
            vec![LifecycleEvent::StageSealed {
                stage: Stage::TobMaiden,
                attempt: None,
                forced: true,
            }],
        );
    }

    #[test]
    fn superseded_deadline_fire_is_ignored() {
        let mut state = tob_state(vec![
            (
                CLIENT_A,
                client(Stage::TobMaiden, StageStatus::Completed, None),
            ),
            (
                CLIENT_B,
                client(Stage::TobMaiden, StageStatus::Started, None),
            ),
        ]);

        // A fire armed for an earlier stage end than the current one.
        state.stage_state = StageState::Ending {
            since: Timestamp::from_millis(5_000),
        };
        let stale_deadline = Deadline {
            kind: DeadlineKind::StageEnd,
            at: Timestamp::from_millis(2_000),
        };
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &Command::DeadlineFired(stale_deadline),
            ),
            vec![],
        );

        // A fire for a stage that has since been sealed normally.
        state.stage_state = StageState::Complete {
            since: Timestamp::from_millis(6_000),
        };
        let sealed = Deadline {
            kind: DeadlineKind::StageEnd,
            at: Timestamp::from_millis(7_000),
        };
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &Command::DeadlineFired(sealed),
            ),
            vec![],
        );
    }

    #[test]
    fn finish_with_other_clients_remaining_does_not_terminate() {
        let state = tob_state(vec![
            (CLIENT_A, client(Stage::TobMaiden, StageStatus::Wiped, None)),
            (
                CLIENT_B,
                client(Stage::TobMaiden, StageStatus::Started, None),
            ),
        ]);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &finish_cmd(CLIENT_A, false, None),
            ),
            vec![
                LifecycleEvent::ChallengeFinishing {
                    status: ChallengeStatus::Wiped,
                },
                LifecycleEvent::ClientFinished {
                    client_id: CLIENT_A,
                    definitive: true,
                    soft: false,
                    times: None,
                },
            ],
        );
    }

    #[test]
    fn spectator_finish_with_others_remaining_is_not_definitive() {
        let mut spectator = client(Stage::TobMaiden, StageStatus::Wiped, None);
        spectator.recording_type = RecordingType::Spectator;
        let state = tob_state(vec![
            (CLIENT_A, spectator),
            (
                CLIENT_B,
                client(Stage::TobMaiden, StageStatus::Started, None),
            ),
        ]);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &finish_cmd(CLIENT_A, true, None),
            ),
            vec![LifecycleEvent::ClientFinished {
                client_id: CLIENT_A,
                definitive: false,
                soft: true,
                times: None,
            }],
        );
    }

    #[test]
    fn second_definitive_finish_does_not_reenter_finishing() {
        let mut state = tob_state(vec![
            (CLIENT_A, client(Stage::TobMaiden, StageStatus::Wiped, None)),
            (CLIENT_B, client(Stage::TobMaiden, StageStatus::Wiped, None)),
        ]);
        state.phase = PhaseState::Finishing {
            since: Timestamp::from_millis(5_000),
            status: ChallengeStatus::Wiped,
        };
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &finish_cmd(CLIENT_A, false, None),
            ),
            vec![LifecycleEvent::ClientFinished {
                client_id: CLIENT_A,
                definitive: true,
                soft: false,
                times: None,
            }],
        );
    }

    #[test]
    fn last_finish_seals_an_open_stage() {
        let mut state = tob_state(vec![(
            CLIENT_A,
            client(Stage::TobMaiden, StageStatus::Wiped, None),
        )]);
        state.stage_state = StageState::Ending {
            since: Timestamp::from_millis(5_000),
        };
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &finish_cmd(CLIENT_A, false, None),
            ),
            vec![
                LifecycleEvent::ClientFinished {
                    client_id: CLIENT_A,
                    definitive: true,
                    soft: false,
                    times: None,
                },
                LifecycleEvent::StageSealed {
                    stage: Stage::TobMaiden,
                    attempt: None,
                    forced: true,
                },
                LifecycleEvent::ChallengeTerminated {
                    status: ChallengeStatus::Wiped,
                    empty: false,
                },
            ],
        );
    }

    #[test]
    fn challenge_end_deadline_cuts_off_remaining_clients() {
        let mut state = tob_state(vec![(
            CLIENT_B,
            client(Stage::TobMaiden, StageStatus::Started, None),
        )]);
        state.phase = PhaseState::Finishing {
            since: Timestamp::from_millis(5_000),
            status: ChallengeStatus::Wiped,
        };
        state.stage_state = StageState::Complete {
            since: Timestamp::from_millis(5_500),
        };

        let fired = next_deadline(&state, &LifecycleConfig::default())
            .expect("finishing phase implies a deadline");
        assert_eq!(fired.kind, DeadlineKind::ChallengeEnd);
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &Command::DeadlineFired(fired),
            ),
            vec![
                LifecycleEvent::ClientRemoved {
                    client_id: CLIENT_B,
                },
                LifecycleEvent::ChallengeTerminated {
                    status: ChallengeStatus::Wiped,
                    empty: false,
                },
            ],
        );
    }

    #[test]
    fn challenge_end_does_not_fire_with_an_open_stage() {
        let mut state = tob_state(vec![
            (CLIENT_A, client(Stage::TobMaiden, StageStatus::Wiped, None)),
            (
                CLIENT_B,
                client(Stage::TobMaiden, StageStatus::Started, None),
            ),
        ]);
        state.phase = PhaseState::Finishing {
            since: Timestamp::from_millis(5_100),
            status: ChallengeStatus::Wiped,
        };
        state.stage_state = StageState::Ending {
            since: Timestamp::from_millis(5_000),
        };

        let premature = Deadline {
            kind: DeadlineKind::ChallengeEnd,
            at: Timestamp::from_millis(9_600),
        };
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &Command::DeadlineFired(premature),
            ),
            vec![],
        );
    }
}

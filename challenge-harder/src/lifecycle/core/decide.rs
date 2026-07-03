//! Challenge command handling.
//!
//! This module represents the decision half of challenge command processing,
//! converting incoming commands to a set of intended actions that are later
//! applied.

use super::command::{Command, Create, Finish, Update};
use super::deadline::{Deadline, DeadlineKind, LifecycleConfig, next_deadline};
use super::event::LifecycleEvent;
use super::state::{ChallengeState, StageState};
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
    if state.status != ChallengeStatus::InProgress {
        todo!("commands after termination");
    }

    match cmd {
        Command::Create(c) => create(state, c),
        Command::Update(u) => update(state, u),
        Command::Finish(f) => finish(state, f),
        Command::DeadlineFired(d) => deadline_fired(state, config, *d),
        Command::Join(_) | Command::ClientStatus(_) | Command::StageProcessed(_) => todo!(),
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

            if all_finished && state.stage_state != StageState::Complete {
                events.push(LifecycleEvent::StageSealed {
                    stage: progress.stage,
                    attempt: client.stage_attempt,
                    forced: false,
                });
            }
        }
        StageStatus::Started => {
            if progress.stage == state.stage {
                if state.stage_attempt.is_some() && client.stage_attempt == state.stage_attempt {
                    todo!("stage retries");
                }
                // The client is syncing to the challenge's current stage.
                events.push(LifecycleEvent::ClientStageReported {
                    client_id: update.client_id,
                    attempt: state.stage_attempt,
                    update: *progress,
                });
            } else {
                events.push(LifecycleEvent::StageStarted {
                    stage: progress.stage,
                });
                events.push(LifecycleEvent::ClientStageReported {
                    client_id: update.client_id,
                    attempt: progress.stage.is_retriable().then_some(1),
                    update: *progress,
                });
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
        DeadlineKind::ChallengeEnd
        | DeadlineKind::CleanupDisconnect
        | DeadlineKind::CleanupNonDefinitiveFinish
        | DeadlineKind::CleanupAllIdle => todo!(),
    }
}

fn finish(state: &ChallengeState, finish: &Finish) -> Vec<LifecycleEvent> {
    let Some(client) = state.clients.get(&finish.client_id) else {
        todo!("finishes from unknown clients");
    };
    if state.clients.len() > 1 {
        todo!("finishes with other clients still connected");
    }

    // TODO(frolv): If there are still clients connected, set a timeout to allow
    // their own finish requests to complete.
    //
    // Spectators may just leave a challenge early before it has actually
    // finished, so don't count their finish events as definitive.
    // TODO(frolv): Instead, start a longer cleanup timer which will end the challenge
    // unless other activity is detected.
    let definitive = (!finish.soft && client.recording_type == RecordingType::Participant)
        || finish.times.is_some();

    // TODO(frolv): This should come from the result of processing, not a client.
    let status = match client.stage_status {
        StageStatus::Started | StageStatus::Entered => ChallengeStatus::Abandoned,
        StageStatus::Wiped => ChallengeStatus::Wiped,
        StageStatus::Completed => {
            let past_last = state
                .challenge_type
                .last_stage()
                .is_some_and(|last| client.stage >= last);
            if past_last {
                ChallengeStatus::Completed
            } else {
                ChallengeStatus::Reset
            }
        }
    };

    vec![
        LifecycleEvent::ClientFinished {
            client_id: finish.client_id,
            definitive,
            soft: finish.soft,
            times: finish.times,
        },
        LifecycleEvent::ChallengeTerminated {
            status,
            // TODO(frolv): Set based on recorded data once stage processing exists.
            empty: false,
        },
    ]
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
        state.stage_state = StageState::Complete;
        assert_eq!(
            decide(
                &state,
                &LifecycleConfig::default(),
                &stage_update(CLIENT_A, Stage::TobMaiden, StageStatus::Completed),
            ),
            vec![report(CLIENT_A, Stage::TobMaiden, StageStatus::Completed)],
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
        state.stage_state = StageState::Complete;
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
}

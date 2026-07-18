//! Direct reconnection scenarios through the rejoin endpoint.

use super::*;
use crate::lifecycle::core::command::ClientStatus;
use crate::lifecycle::core::types::ChallengeStatus;
use crate::lifecycle::sim::{Scenario, run};

fn solo_tob_start() -> Action {
    Action::Start {
        challenge_type: ChallengeType::Tob,
        mode: ChallengeMode::TobRegular,
        party: vec!["WWWWWWWWWWQQ".into()],
        stage: Stage::TobMaiden,
    }
}

fn disconnect() -> Action {
    Action::Status(ClientStatus::Disconnected)
}

fn stage_started(stage: Stage) -> LifecycleEvent {
    LifecycleEvent::StageStarted { stage }
}

fn sealed(stage: Stage, attempt: Option<u32>, forced: bool) -> LifecycleEvent {
    LifecycleEvent::StageSealed {
        stage,
        attempt,
        forced,
    }
}

fn removed(client: i64) -> LifecycleEvent {
    LifecycleEvent::ClientRemoved {
        client_id: client_id(client),
    }
}

fn client_rejoined(client: i64, token: &str) -> LifecycleEvent {
    LifecycleEvent::ClientRejoined {
        client_id: client_id(client),
        session_token: token.into(),
    }
}

fn joined_with_token(client: i64, token: &str) -> LifecycleEvent {
    LifecycleEvent::ClientJoined {
        client_id: client_id(client),
        user_id: UserId(client),
        session_token: token.into(),
        recording_type: RecordingType::Participant,
    }
}

fn client_finished(client: i64) -> LifecycleEvent {
    LifecycleEvent::ClientFinished {
        client_id: client_id(client),
        definitive: true,
        soft: false,
        times: None,
    }
}

fn terminated() -> LifecycleEvent {
    LifecycleEvent::ChallengeTerminated { empty: false }
}

#[tokio::test(start_paused = true)]
async fn overlapping_socket_rejoin_fences_the_old_socket() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, solo_tob_start())
                .at(10, report(Stage::TobMaiden, StageStatus::Started))
                .at(5_000, Action::Reconnect { token: "tok1b" })
                .at(5_500, Action::StatusAs(ClientStatus::Disconnected, "tok1"))
                .at(8_000, report(Stage::TobMaiden, StageStatus::Completed))
                .at(9_000, finish(false)),
        ],
        run_until: 10_000,
    })
    .await;

    // The reconnect response resyncs the new socket to the current stage.
    let resync = result
        .outcomes
        .iter()
        .find(|o| o.at == 5_000)
        .and_then(|o| o.response.as_ref())
        .expect("reconnect should resync");
    assert_eq!(resync.stage, Stage::TobMaiden);

    let (_, journal) = result.only_challenge();
    assert_eq!(
        journal[1..],
        vec![
            entry(1, 0, cmd(1), joined(1, RecordingType::Participant)),
            entry(2, 10, cmd(2), stage_started(Stage::TobMaiden)),
            entry(
                3,
                10,
                cmd(2),
                reported(1, Stage::TobMaiden, StageStatus::Started)
            ),
            entry(4, 5_000, cmd(3), client_rejoined(1, "tok1b")),
            // The old socket's disconnect is ignored following the token update.
            entry(
                5,
                8_000,
                cmd(5),
                reported(1, Stage::TobMaiden, StageStatus::Completed)
            ),
            entry(6, 8_000, cmd(5), sealed(Stage::TobMaiden, None, false)),
            entry(7, 9_000, cmd(6), client_finished(1)),
            entry(8, 9_000, cmd(6), terminated()),
        ],
    );
    assert_eq!(result.only_status(), ChallengeStatus::Reset);
}

#[tokio::test(start_paused = true)]
async fn removed_client_rejoins_inside_the_window() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, solo_tob_start())
                .at(10, report(Stage::TobMaiden, StageStatus::Started))
                .at(700, disconnect())
                .at(60_000, Action::Reconnect { token: "tok1b" })
                .at(60_100, report(Stage::TobMaiden, StageStatus::Started))
                .at(60_500, report(Stage::TobMaiden, StageStatus::Wiped))
                .at(60_600, finish(false)),
        ],
        run_until: 320_000,
    })
    .await;

    let (_, journal) = result.only_challenge();
    assert_eq!(
        journal[1..],
        vec![
            entry(1, 0, cmd(1), joined(1, RecordingType::Participant)),
            entry(2, 10, cmd(2), stage_started(Stage::TobMaiden)),
            entry(
                3,
                10,
                cmd(2),
                reported(1, Stage::TobMaiden, StageStatus::Started)
            ),
            entry(4, 700, cmd(3), removed(1)),
            entry(5, 60_000, cmd(4), joined_with_token(1, "tok1b")),
            entry(
                6,
                60_100,
                cmd(5),
                reported(1, Stage::TobMaiden, StageStatus::Started)
            ),
            entry(
                7,
                60_500,
                cmd(6),
                reported(1, Stage::TobMaiden, StageStatus::Wiped)
            ),
            entry(8, 60_500, cmd(6), sealed(Stage::TobMaiden, None, false)),
            entry(9, 60_600, cmd(7), client_finished(1)),
            entry(10, 60_600, cmd(7), terminated()),
        ],
    );
    assert_eq!(result.only_status(), ChallengeStatus::Wiped);
}

#[tokio::test(start_paused = true)]
async fn rejoin_after_termination_is_refused() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, solo_tob_start())
                .at(500, finish(false))
                .at(2_000, Action::Reconnect { token: "tok1b" }),
        ],
        run_until: 3_000,
    })
    .await;

    // The rejoin finds no live challenge and no new challenge is created.
    let reconnect = result
        .outcomes
        .iter()
        .find(|o| o.at == 2_000)
        .expect("reconnect outcome recorded");
    assert!(reconnect.response.is_none());

    let (_, journal) = result.only_challenge();
    assert_eq!(
        journal[1..],
        vec![
            entry(1, 0, cmd(1), joined(1, RecordingType::Participant)),
            entry(2, 500, cmd(2), client_finished(1)),
            entry(3, 500, cmd(2), terminated()),
        ],
    );
    assert_eq!(result.only_status(), ChallengeStatus::Reset);
}

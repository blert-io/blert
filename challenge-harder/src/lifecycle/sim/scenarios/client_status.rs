//! Client connection status and cleanup deadline scenarios.

use super::*;
use crate::lifecycle::core::command::ClientStatus;
use crate::lifecycle::core::deadline::DeadlineKind;
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

fn inferno_start() -> Action {
    Action::Start {
        challenge_type: ChallengeType::Inferno,
        mode: ChallengeMode::NoMode,
        party: vec!["Plondreim".into()],
        stage: Stage::InfernoWave1,
    }
}

fn mokhaiotl_start() -> Action {
    Action::Start {
        challenge_type: ChallengeType::Mokhaiotl,
        mode: ChallengeMode::NoMode,
        party: vec!["Prom Wizy".into()],
        stage: Stage::MokhaiotlDelve8,
    }
}

fn idle() -> Action {
    Action::Status(ClientStatus::Idle)
}

fn active() -> Action {
    Action::Status(ClientStatus::Active)
}

fn disconnect() -> Action {
    Action::Status(ClientStatus::Disconnected)
}

fn fired(kind: DeadlineKind) -> Cause {
    Cause::Deadline(kind)
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

fn idled(client: i64) -> LifecycleEvent {
    LifecycleEvent::ClientIdled {
        client_id: client_id(client),
    }
}

fn activated(client: i64) -> LifecycleEvent {
    LifecycleEvent::ClientActivated {
        client_id: client_id(client),
    }
}

fn removed(client: i64) -> LifecycleEvent {
    LifecycleEvent::ClientRemoved {
        client_id: client_id(client),
    }
}

fn rejoined(client: i64, user: i64) -> LifecycleEvent {
    LifecycleEvent::ClientJoined {
        client_id: client_id(client),
        user_id: UserId(user),
        session_token: format!("tok{client}").into(),
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

fn terminated(status: ChallengeStatus) -> LifecycleEvent {
    LifecycleEvent::ChallengeTerminated {
        status,
        empty: false,
    }
}

#[tokio::test(start_paused = true)]
async fn disconnect_without_finish_cleans_up_after_reconnection_window() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, solo_tob_start())
                .at(10, report(Stage::TobMaiden, StageStatus::Started))
                .at(500, report(Stage::TobMaiden, StageStatus::Completed))
                .at(600, report(Stage::TobBloat, StageStatus::Started))
                .at(900, disconnect()),
        ],
        run_until: 302_000,
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
            entry(
                4,
                500,
                cmd(3),
                reported(1, Stage::TobMaiden, StageStatus::Completed)
            ),
            entry(5, 500, cmd(3), sealed(Stage::TobMaiden, None, false)),
            entry(6, 600, cmd(4), stage_started(Stage::TobBloat)),
            entry(
                7,
                600,
                cmd(4),
                reported(1, Stage::TobBloat, StageStatus::Started)
            ),
            entry(8, 900, cmd(5), removed(1)),
            entry(
                9,
                300_900,
                fired(DeadlineKind::CleanupDisconnect),
                terminated(ChallengeStatus::Abandoned)
            ),
        ],
    );
}

#[tokio::test(start_paused = true)]
async fn rejoin_within_window_resumes_challenge() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, solo_tob_start())
                .at(10, report(Stage::TobMaiden, StageStatus::Started))
                .at(500, report(Stage::TobMaiden, StageStatus::Completed))
                .at(600, report(Stage::TobBloat, StageStatus::Started))
                .at(900, disconnect()),
            Client::participant("a2", 2)
                .with_user(1)
                .at(60_900, solo_tob_start())
                .at(61_000, report(Stage::TobBloat, StageStatus::Started))
                .at(61_500, report(Stage::TobBloat, StageStatus::Completed))
                .at(61_600, report(Stage::TobNylocas, StageStatus::Started))
                .at(62_000, report(Stage::TobNylocas, StageStatus::Wiped))
                .at(62_100, finish(false)),
        ],
        run_until: 400_000,
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
            entry(
                4,
                500,
                cmd(3),
                reported(1, Stage::TobMaiden, StageStatus::Completed)
            ),
            entry(5, 500, cmd(3), sealed(Stage::TobMaiden, None, false)),
            entry(6, 600, cmd(4), stage_started(Stage::TobBloat)),
            entry(
                7,
                600,
                cmd(4),
                reported(1, Stage::TobBloat, StageStatus::Started)
            ),
            entry(8, 900, cmd(5), removed(1)),
            entry(9, 60_900, cmd(6), rejoined(2, 1)),
            entry(
                10,
                61_000,
                cmd(7),
                reported(2, Stage::TobBloat, StageStatus::Started)
            ),
            entry(
                11,
                61_500,
                cmd(8),
                reported(2, Stage::TobBloat, StageStatus::Completed)
            ),
            entry(12, 61_500, cmd(8), sealed(Stage::TobBloat, None, false)),
            entry(13, 61_600, cmd(9), stage_started(Stage::TobNylocas)),
            entry(
                14,
                61_600,
                cmd(9),
                reported(2, Stage::TobNylocas, StageStatus::Started)
            ),
            entry(
                15,
                62_000,
                cmd(10),
                reported(2, Stage::TobNylocas, StageStatus::Wiped)
            ),
            entry(16, 62_000, cmd(10), sealed(Stage::TobNylocas, None, false)),
            entry(17, 62_100, cmd(11), client_finished(2)),
            entry(18, 62_100, cmd(11), terminated(ChallengeStatus::Wiped)),
        ],
    );
}

#[tokio::test(start_paused = true)]
async fn logout_without_return_cleans_up_after_inactivity_window() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, inferno_start())
                .at(10, report(Stage::InfernoWave1, StageStatus::Started))
                .at(500, report(Stage::InfernoWave1, StageStatus::Completed))
                .at(600, report(Stage::InfernoWave2, StageStatus::Started))
                .at(5_000, idle()),
        ],
        run_until: 910_000,
    })
    .await;

    let (_, journal) = result.only_challenge();
    assert_eq!(
        journal[1..],
        vec![
            entry(1, 0, cmd(1), joined(1, RecordingType::Participant)),
            entry(2, 10, cmd(2), stage_started(Stage::InfernoWave1)),
            entry(
                3,
                10,
                cmd(2),
                reported(1, Stage::InfernoWave1, StageStatus::Started)
            ),
            entry(
                4,
                500,
                cmd(3),
                reported(1, Stage::InfernoWave1, StageStatus::Completed)
            ),
            entry(5, 500, cmd(3), sealed(Stage::InfernoWave1, None, false)),
            entry(6, 600, cmd(4), stage_started(Stage::InfernoWave2)),
            entry(
                7,
                600,
                cmd(4),
                reported(1, Stage::InfernoWave2, StageStatus::Started)
            ),
            entry(8, 5_000, cmd(5), idled(1)),
            entry(9, 905_000, fired(DeadlineKind::CleanupAllIdle), removed(1)),
            entry(
                10,
                905_000,
                fired(DeadlineKind::CleanupAllIdle),
                terminated(ChallengeStatus::Abandoned)
            ),
        ],
    );
}

#[tokio::test(start_paused = true)]
async fn logout_and_return_resumes_challenge() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, inferno_start())
                .at(10, report(Stage::InfernoWave1, StageStatus::Started))
                .at(500, report(Stage::InfernoWave1, StageStatus::Completed))
                .at(1_000, idle())
                .at(10_000, active())
                .at(10_100, report(Stage::InfernoWave2, StageStatus::Started))
                .at(10_400, report(Stage::InfernoWave2, StageStatus::Wiped))
                .at(10_500, finish(false)),
        ],
        run_until: 1_000_000,
    })
    .await;

    let (_, journal) = result.only_challenge();
    assert_eq!(
        journal[1..],
        vec![
            entry(1, 0, cmd(1), joined(1, RecordingType::Participant)),
            entry(2, 10, cmd(2), stage_started(Stage::InfernoWave1)),
            entry(
                3,
                10,
                cmd(2),
                reported(1, Stage::InfernoWave1, StageStatus::Started)
            ),
            entry(
                4,
                500,
                cmd(3),
                reported(1, Stage::InfernoWave1, StageStatus::Completed)
            ),
            entry(5, 500, cmd(3), sealed(Stage::InfernoWave1, None, false)),
            entry(6, 1_000, cmd(4), idled(1)),
            entry(7, 10_000, cmd(5), activated(1)),
            entry(8, 10_100, cmd(6), stage_started(Stage::InfernoWave2)),
            entry(
                9,
                10_100,
                cmd(6),
                reported(1, Stage::InfernoWave2, StageStatus::Started)
            ),
            entry(
                10,
                10_400,
                cmd(7),
                reported(1, Stage::InfernoWave2, StageStatus::Wiped)
            ),
            entry(11, 10_400, cmd(7), sealed(Stage::InfernoWave2, None, false)),
            entry(12, 10_500, cmd(8), client_finished(1)),
            entry(13, 10_500, cmd(8), terminated(ChallengeStatus::Wiped)),
        ],
    );
}

#[tokio::test(start_paused = true)]
async fn wipe_then_crash_before_finish_is_wiped() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, solo_tob_start())
                .at(10, report(Stage::TobMaiden, StageStatus::Started))
                .at(500, report(Stage::TobMaiden, StageStatus::Wiped))
                .at(700, disconnect()),
        ],
        run_until: 302_000,
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
            entry(
                4,
                500,
                cmd(3),
                reported(1, Stage::TobMaiden, StageStatus::Wiped)
            ),
            entry(5, 500, cmd(3), sealed(Stage::TobMaiden, None, false)),
            entry(6, 700, cmd(4), removed(1)),
            entry(
                7,
                300_700,
                fired(DeadlineKind::CleanupDisconnect),
                terminated(ChallengeStatus::Wiped)
            ),
        ],
    );
}

#[tokio::test(start_paused = true)]
async fn deep_delve_disconnect_completes() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, mokhaiotl_start())
                .at(10, report(Stage::MokhaiotlDelve8, StageStatus::Started))
                .at(500, report(Stage::MokhaiotlDelve8, StageStatus::Completed))
                .at(
                    600,
                    report(Stage::MokhaiotlDelve8plus, StageStatus::Started),
                )
                .at(
                    900,
                    report(Stage::MokhaiotlDelve8plus, StageStatus::Completed),
                )
                .at(
                    1_000,
                    report(Stage::MokhaiotlDelve8plus, StageStatus::Started),
                )
                .at(1_200, disconnect()),
        ],
        run_until: 302_000,
    })
    .await;

    let (_, journal) = result.only_challenge();
    assert_eq!(
        journal[1..],
        vec![
            entry(1, 0, cmd(1), joined(1, RecordingType::Participant)),
            entry(2, 10, cmd(2), stage_started(Stage::MokhaiotlDelve8)),
            entry(
                3,
                10,
                cmd(2),
                reported(1, Stage::MokhaiotlDelve8, StageStatus::Started)
            ),
            entry(
                4,
                500,
                cmd(3),
                reported(1, Stage::MokhaiotlDelve8, StageStatus::Completed)
            ),
            entry(5, 500, cmd(3), sealed(Stage::MokhaiotlDelve8, None, false)),
            entry(6, 600, cmd(4), stage_started(Stage::MokhaiotlDelve8plus)),
            entry(
                7,
                600,
                cmd(4),
                reported_attempt(1, Stage::MokhaiotlDelve8plus, StageStatus::Started, 1)
            ),
            entry(
                8,
                900,
                cmd(5),
                reported_attempt(1, Stage::MokhaiotlDelve8plus, StageStatus::Completed, 1)
            ),
            entry(
                9,
                900,
                cmd(5),
                sealed(Stage::MokhaiotlDelve8plus, Some(1), false)
            ),
            entry(
                10,
                1_000,
                cmd(6),
                LifecycleEvent::StageAttemptStarted {
                    stage: Stage::MokhaiotlDelve8plus,
                    attempt: 2,
                }
            ),
            entry(
                11,
                1_000,
                cmd(6),
                reported_attempt(1, Stage::MokhaiotlDelve8plus, StageStatus::Started, 2)
            ),
            entry(12, 1_200, cmd(7), removed(1)),
            entry(
                13,
                301_200,
                fired(DeadlineKind::CleanupDisconnect),
                terminated(ChallengeStatus::Completed)
            ),
        ],
    );
}

#[tokio::test(start_paused = true)]
async fn partner_finish_between_idle_and_return() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, tob_start())
                .at(10, report(Stage::TobMaiden, StageStatus::Started))
                .at(500, report(Stage::TobMaiden, StageStatus::Wiped))
                .at(1_000, idle())
                .at(8_100, active())
                .at(8_200, finish(false)),
            Client::participant("b", 2)
                .at(5, tob_start())
                .at(15, report(Stage::TobMaiden, StageStatus::Started))
                .at(520, report(Stage::TobMaiden, StageStatus::Wiped))
                .at(8_000, finish(false)),
        ],
        run_until: 20_000,
    })
    .await;

    let (_, journal) = result.only_challenge();
    assert_eq!(
        journal[1..],
        vec![
            entry(1, 0, cmd(1), joined(1, RecordingType::Participant)),
            entry(2, 5, cmd(2), joined(2, RecordingType::Participant)),
            entry(3, 10, cmd(3), stage_started(Stage::TobMaiden)),
            entry(
                4,
                10,
                cmd(3),
                reported(1, Stage::TobMaiden, StageStatus::Started)
            ),
            entry(
                5,
                15,
                cmd(4),
                reported(2, Stage::TobMaiden, StageStatus::Started)
            ),
            entry(
                6,
                500,
                cmd(5),
                reported(1, Stage::TobMaiden, StageStatus::Wiped)
            ),
            entry(
                7,
                520,
                cmd(6),
                reported(2, Stage::TobMaiden, StageStatus::Wiped)
            ),
            entry(8, 520, cmd(6), sealed(Stage::TobMaiden, None, false)),
            entry(9, 1_000, cmd(7), idled(1)),
            entry(
                10,
                8_000,
                cmd(8),
                LifecycleEvent::ChallengeFinishing {
                    status: ChallengeStatus::Wiped,
                }
            ),
            entry(11, 8_000, cmd(8), client_finished(2)),
            entry(12, 8_100, cmd(9), activated(1)),
            entry(13, 8_200, cmd(10), client_finished(1)),
            entry(14, 8_200, cmd(10), terminated(ChallengeStatus::Wiped)),
        ],
    );
}

#[tokio::test(start_paused = true)]
async fn partial_disconnect_does_not_arm_cleanup() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, tob_start())
                .at(10, report(Stage::TobMaiden, StageStatus::Started))
                .at(700, disconnect()),
            Client::participant("b", 2)
                .at(5, tob_start())
                .at(15, report(Stage::TobMaiden, StageStatus::Started))
                .at(340_000, report(Stage::TobMaiden, StageStatus::Completed))
                .at(341_000, report(Stage::TobBloat, StageStatus::Started))
                .at(345_000, report(Stage::TobBloat, StageStatus::Wiped))
                .at(345_500, finish(false)),
        ],
        run_until: 350_000,
    })
    .await;

    let (_, journal) = result.only_challenge();
    assert_eq!(
        journal[1..],
        vec![
            entry(1, 0, cmd(1), joined(1, RecordingType::Participant)),
            entry(2, 5, cmd(2), joined(2, RecordingType::Participant)),
            entry(3, 10, cmd(3), stage_started(Stage::TobMaiden)),
            entry(
                4,
                10,
                cmd(3),
                reported(1, Stage::TobMaiden, StageStatus::Started)
            ),
            entry(
                5,
                15,
                cmd(4),
                reported(2, Stage::TobMaiden, StageStatus::Started)
            ),
            entry(6, 700, cmd(5), removed(1)),
            entry(
                7,
                340_000,
                cmd(6),
                reported(2, Stage::TobMaiden, StageStatus::Completed)
            ),
            entry(8, 340_000, cmd(6), sealed(Stage::TobMaiden, None, false)),
            entry(9, 341_000, cmd(7), stage_started(Stage::TobBloat)),
            entry(
                10,
                341_000,
                cmd(7),
                reported(2, Stage::TobBloat, StageStatus::Started)
            ),
            entry(
                11,
                345_000,
                cmd(8),
                reported(2, Stage::TobBloat, StageStatus::Wiped)
            ),
            entry(12, 345_000, cmd(8), sealed(Stage::TobBloat, None, false)),
            entry(13, 345_500, cmd(9), client_finished(2)),
            entry(14, 345_500, cmd(9), terminated(ChallengeStatus::Wiped)),
        ],
    );
}

#[tokio::test(start_paused = true)]
async fn rejoin_after_window_starts_fresh() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, solo_tob_start())
                .at(10, report(Stage::TobMaiden, StageStatus::Started))
                .at(700, disconnect()),
            Client::participant("a2", 2)
                .with_user(1)
                .at(400_000, solo_tob_start())
                .at(400_010, report(Stage::TobMaiden, StageStatus::Started))
                .at(400_500, report(Stage::TobMaiden, StageStatus::Wiped))
                .at(400_600, finish(false)),
        ],
        run_until: 402_000,
    })
    .await;

    assert_eq!(result.journals.len(), 2);
    let start_uuid = |at: u64| {
        result
            .outcomes
            .iter()
            .find(|o| o.at == at)
            .and_then(|o| o.response.as_ref())
            .map(|p| p.uuid)
            .expect("start should produce a challenge")
    };
    let first = start_uuid(0);
    let second = start_uuid(400_000);
    assert_ne!(first, second);

    assert_eq!(
        result.journals[&first][1..],
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
            entry(
                5,
                300_700,
                fired(DeadlineKind::CleanupDisconnect),
                terminated(ChallengeStatus::Abandoned)
            ),
        ],
    );

    // The second challenge's journal runs on its own clock.
    assert_eq!(
        result.journals[&second][1..],
        vec![
            entry(1, 0, cmd(1), rejoined(2, 1)),
            entry(2, 10, cmd(2), stage_started(Stage::TobMaiden)),
            entry(
                3,
                10,
                cmd(2),
                reported(2, Stage::TobMaiden, StageStatus::Started)
            ),
            entry(
                4,
                500,
                cmd(3),
                reported(2, Stage::TobMaiden, StageStatus::Wiped)
            ),
            entry(5, 500, cmd(3), sealed(Stage::TobMaiden, None, false)),
            entry(6, 600, cmd(4), client_finished(2)),
            entry(7, 600, cmd(4), terminated(ChallengeStatus::Wiped)),
        ],
    );
}

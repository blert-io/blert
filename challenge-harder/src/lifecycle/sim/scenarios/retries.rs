//! Stage retry scenarios.

use super::*;
use crate::lifecycle::core::types::ChallengeStatus;
use crate::lifecycle::sim::{Scenario, run};

fn mokhaiotl_start(stage: Stage) -> Action {
    Action::Start {
        challenge_type: ChallengeType::Mokhaiotl,
        mode: ChallengeMode::NoMode,
        party: vec!["Prom Wizy".into()],
        stage,
    }
}

fn stage_started(stage: Stage) -> LifecycleEvent {
    LifecycleEvent::StageStarted { stage }
}

fn deep_delve(attempt: u32) -> LifecycleEvent {
    LifecycleEvent::StageAttemptStarted {
        stage: Stage::MokhaiotlDelve8plus,
        attempt,
    }
}

fn sealed(stage: Stage, attempt: Option<u32>, forced: bool) -> LifecycleEvent {
    LifecycleEvent::StageSealed {
        stage,
        attempt,
        forced,
    }
}

fn client_finished(seq: u64, at_ms: u64, caused_by: Cause) -> JournalEntry {
    entry(
        seq,
        at_ms,
        caused_by,
        LifecycleEvent::ClientFinished {
            client_id: client_id(1),
            definitive: true,
            soft: false,
            times: None,
        },
    )
}

fn completed(seq: u64, at_ms: u64, caused_by: Cause) -> JournalEntry {
    entry(
        seq,
        at_ms,
        caused_by,
        LifecycleEvent::ChallengeTerminated {
            status: ChallengeStatus::Completed,
            empty: false,
        },
    )
}

#[tokio::test(start_paused = true)]
async fn deep_delve_progression_retries_each_delve() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, mokhaiotl_start(Stage::MokhaiotlDelve8))
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
                .at(
                    1_300,
                    report(Stage::MokhaiotlDelve8plus, StageStatus::Completed),
                )
                .at(
                    1_400,
                    report(Stage::MokhaiotlDelve8plus, StageStatus::Started),
                )
                .at(
                    1_700,
                    report(Stage::MokhaiotlDelve8plus, StageStatus::Wiped),
                )
                .at(1_750, finish(false)),
        ],
        run_until: 2_000,
    })
    .await;

    let (_, journal) = result.only_challenge();
    assert_eq!(
        journal[5..],
        vec![
            entry(5, 600, cmd(4), stage_started(Stage::MokhaiotlDelve8plus)),
            entry(
                6,
                600,
                cmd(4),
                reported_attempt(1, Stage::MokhaiotlDelve8plus, StageStatus::Started, 1)
            ),
            entry(
                7,
                900,
                cmd(5),
                reported_attempt(1, Stage::MokhaiotlDelve8plus, StageStatus::Completed, 1)
            ),
            entry(
                8,
                900,
                cmd(5),
                sealed(Stage::MokhaiotlDelve8plus, Some(1), false)
            ),
            entry(9, 1_000, cmd(6), deep_delve(2)),
            entry(
                10,
                1_000,
                cmd(6),
                reported_attempt(1, Stage::MokhaiotlDelve8plus, StageStatus::Started, 2)
            ),
            entry(
                11,
                1_300,
                cmd(7),
                reported_attempt(1, Stage::MokhaiotlDelve8plus, StageStatus::Completed, 2)
            ),
            entry(
                12,
                1_300,
                cmd(7),
                sealed(Stage::MokhaiotlDelve8plus, Some(2), false)
            ),
            entry(13, 1_400, cmd(8), deep_delve(3)),
            entry(
                14,
                1_400,
                cmd(8),
                reported_attempt(1, Stage::MokhaiotlDelve8plus, StageStatus::Started, 3)
            ),
            entry(
                15,
                1_700,
                cmd(9),
                reported_attempt(1, Stage::MokhaiotlDelve8plus, StageStatus::Wiped, 3)
            ),
            entry(
                16,
                1_700,
                cmd(9),
                sealed(Stage::MokhaiotlDelve8plus, Some(3), false)
            ),
            client_finished(17, 1_750, cmd(10)),
            completed(18, 1_750, cmd(10)),
        ],
    );
}

#[tokio::test(start_paused = true)]
async fn start_after_missed_stage_end_seals_previous_attempt() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, mokhaiotl_start(Stage::MokhaiotlDelve8))
                .at(10, report(Stage::MokhaiotlDelve8, StageStatus::Started))
                .at(500, report(Stage::MokhaiotlDelve8, StageStatus::Completed))
                .at(
                    600,
                    report(Stage::MokhaiotlDelve8plus, StageStatus::Started),
                )
                .at(
                    1_500,
                    report(Stage::MokhaiotlDelve8plus, StageStatus::Started),
                )
                .at(
                    1_800,
                    report(Stage::MokhaiotlDelve8plus, StageStatus::Wiped),
                )
                .at(1_900, finish(false)),
        ],
        run_until: 2_400,
    })
    .await;

    let (_, journal) = result.only_challenge();
    assert!(
        journal
            .iter()
            .all(|e| matches!(e.caused_by, Cause::Command(_))),
    );
    assert_eq!(
        journal[5..],
        vec![
            entry(5, 600, cmd(4), stage_started(Stage::MokhaiotlDelve8plus)),
            entry(
                6,
                600,
                cmd(4),
                reported_attempt(1, Stage::MokhaiotlDelve8plus, StageStatus::Started, 1)
            ),
            entry(
                7,
                1_500,
                cmd(5),
                sealed(Stage::MokhaiotlDelve8plus, Some(1), true)
            ),
            entry(8, 1_500, cmd(5), deep_delve(2)),
            entry(
                9,
                1_500,
                cmd(5),
                reported_attempt(1, Stage::MokhaiotlDelve8plus, StageStatus::Started, 2)
            ),
            entry(
                10,
                1_800,
                cmd(6),
                reported_attempt(1, Stage::MokhaiotlDelve8plus, StageStatus::Wiped, 2)
            ),
            entry(
                11,
                1_800,
                cmd(6),
                sealed(Stage::MokhaiotlDelve8plus, Some(2), false)
            ),
            client_finished(12, 1_900, cmd(7)),
            completed(13, 1_900, cmd(7)),
        ],
    );
}

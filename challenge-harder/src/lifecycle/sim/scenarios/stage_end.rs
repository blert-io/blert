//! Stage end window scenarios.

use super::*;
use crate::lifecycle::core::deadline::DeadlineKind;
use crate::lifecycle::sim::{Scenario, run};

#[tokio::test(start_paused = true)]
async fn all_reports_inside_window_seals_normally() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, tob_start())
                .at(100, report(Stage::TobMaiden, StageStatus::Started))
                .at(1_000, report(Stage::TobMaiden, StageStatus::Wiped)),
            Client::participant("b", 2)
                .at(0, tob_start())
                .at(100, report(Stage::TobMaiden, StageStatus::Started))
                .at(2_999, report(Stage::TobMaiden, StageStatus::Wiped)),
        ],
        run_until: 3_500,
    })
    .await;

    let (_, journal) = result.only_challenge();
    assert!(
        journal
            .iter()
            .all(|e| matches!(e.caused_by, Cause::Command(_))),
        "no deadline should have fired",
    );
    assert_eq!(
        journal[6..],
        vec![
            entry(
                6,
                2_999,
                cmd(6),
                reported(2, Stage::TobMaiden, StageStatus::Wiped),
            ),
            entry(
                7,
                2_999,
                cmd(6),
                LifecycleEvent::StageSealed {
                    stage: Stage::TobMaiden,
                    attempt: None,
                    forced: false,
                },
            ),
        ],
    );
}

#[tokio::test(start_paused = true)]
async fn window_expiry_forces_seal() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, tob_start())
                .at(100, report(Stage::TobMaiden, StageStatus::Started))
                .at(1_000, report(Stage::TobMaiden, StageStatus::Wiped)),
            Client::participant("b", 2)
                .at(0, tob_start())
                .at(100, report(Stage::TobMaiden, StageStatus::Started)),
        ],
        run_until: 3_500,
    })
    .await;

    let (_, journal) = result.only_challenge();
    assert_eq!(
        journal[6..],
        vec![entry(
            6,
            3_000,
            Cause::Deadline(DeadlineKind::StageEnd),
            LifecycleEvent::StageSealed {
                stage: Stage::TobMaiden,
                attempt: None,
                forced: true,
            },
        )],
    );
}

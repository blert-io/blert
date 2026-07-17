//! Challenge finish grace period scenarios.

use super::*;
use crate::lifecycle::core::deadline::DeadlineKind;
use crate::lifecycle::core::types::ChallengeStatus;
use crate::lifecycle::sim::{Scenario, run};

#[tokio::test(start_paused = true)]
async fn each_finish_extends_the_grace_period() {
    // The third finish arrives inside the window anchored at the second
    // finish, past where a grace anchored at the first would have cut it.
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, tob_start())
                .at(100, report(Stage::TobMaiden, StageStatus::Started))
                .at(1_000, report(Stage::TobMaiden, StageStatus::Wiped))
                .at(1_100, finish(false)),
            Client::participant("b", 2)
                .at(0, tob_start())
                .at(100, report(Stage::TobMaiden, StageStatus::Started))
                .at(4_000, finish(false)),
            Client::participant("c", 3)
                .at(0, tob_start())
                .at(100, report(Stage::TobMaiden, StageStatus::Started))
                .at(8_500, finish(false)),
        ],
        run_until: 10_000,
    })
    .await;

    let (_, journal) = result.only_challenge();
    assert_eq!(
        journal[9..],
        vec![
            entry(9, 1_100, cmd(8), LifecycleEvent::ChallengeFinishing,),
            entry(
                10,
                1_100,
                cmd(8),
                LifecycleEvent::ClientFinished {
                    client_id: client_id(1),
                    definitive: true,
                    soft: false,
                    times: None,
                },
            ),
            entry(
                11,
                3_000,
                Cause::Deadline(DeadlineKind::StageEnd),
                LifecycleEvent::StageSealed {
                    stage: Stage::TobMaiden,
                    attempt: None,
                    forced: true,
                },
            ),
            entry(
                12,
                4_000,
                cmd(9),
                LifecycleEvent::ClientFinished {
                    client_id: client_id(2),
                    definitive: true,
                    soft: false,
                    times: None,
                },
            ),
            entry(
                13,
                8_500,
                cmd(10),
                LifecycleEvent::ClientFinished {
                    client_id: client_id(3),
                    definitive: true,
                    soft: false,
                    times: None,
                },
            ),
            entry(
                14,
                8_500,
                cmd(10),
                LifecycleEvent::ChallengeTerminated { empty: false },
            ),
        ],
    );
}

#[tokio::test(start_paused = true)]
async fn unfinished_client_cut_off_after_grace_period() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, tob_start())
                .at(100, report(Stage::TobMaiden, StageStatus::Started))
                .at(1_000, report(Stage::TobMaiden, StageStatus::Wiped))
                .at(1_100, finish(false)),
            Client::participant("b", 2)
                .at(0, tob_start())
                .at(100, report(Stage::TobMaiden, StageStatus::Started)),
        ],
        run_until: 8_500,
    })
    .await;

    let (_, journal) = result.only_challenge();
    assert_eq!(
        journal[7..],
        vec![
            entry(7, 1_100, cmd(6), LifecycleEvent::ChallengeFinishing,),
            entry(
                8,
                1_100,
                cmd(6),
                LifecycleEvent::ClientFinished {
                    client_id: client_id(1),
                    definitive: true,
                    soft: false,
                    times: None,
                },
            ),
            entry(
                9,
                3_000,
                Cause::Deadline(DeadlineKind::StageEnd),
                LifecycleEvent::StageSealed {
                    stage: Stage::TobMaiden,
                    attempt: None,
                    forced: true,
                },
            ),
            entry(
                10,
                8_000,
                Cause::Deadline(DeadlineKind::ChallengeEnd),
                LifecycleEvent::ClientRemoved {
                    client_id: client_id(2),
                },
            ),
            entry(
                11,
                8_000,
                Cause::Deadline(DeadlineKind::ChallengeEnd),
                LifecycleEvent::ChallengeTerminated { empty: false },
            ),
        ],
    );
}

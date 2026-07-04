//! Challenge finish grace period scenarios.

use super::*;
use crate::lifecycle::core::deadline::DeadlineKind;
use crate::lifecycle::core::state::ChallengePhase;
use crate::lifecycle::core::types::ChallengeStatus;
use crate::lifecycle::sim::{Scenario, run};

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

    let (uuid, journal) = result.only_challenge();
    assert_eq!(
        journal[6..],
        vec![
            entry(
                6,
                1_100,
                cmd(6),
                LifecycleEvent::ChallengeFinishing {
                    status: ChallengeStatus::Wiped,
                },
            ),
            entry(
                7,
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
                8,
                3_000,
                Cause::Deadline(DeadlineKind::StageEnd),
                LifecycleEvent::StageSealed {
                    stage: Stage::TobMaiden,
                    attempt: None,
                    forced: true,
                },
            ),
            entry(
                9,
                8_000,
                Cause::Deadline(DeadlineKind::ChallengeEnd),
                LifecycleEvent::ClientRemoved {
                    client_id: client_id(2),
                },
            ),
            entry(
                10,
                8_000,
                Cause::Deadline(DeadlineKind::ChallengeEnd),
                LifecycleEvent::ChallengeTerminated {
                    status: ChallengeStatus::Wiped,
                    empty: false,
                },
            ),
        ],
    );
    assert_eq!(
        result.snapshots[&uuid].phase,
        ChallengePhase::Terminated {
            status: ChallengeStatus::Wiped
        },
    );
}

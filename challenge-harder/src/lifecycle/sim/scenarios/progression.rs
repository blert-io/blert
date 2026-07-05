//! Normal stage progression scenarios.

use super::*;
use crate::lifecycle::core::types::ChallengeStatus;
use crate::lifecycle::sim::run;

#[tokio::test(start_paused = true)]
async fn solo_colosseum_wipe_full_trace() {
    let result = run(solo_colosseum()).await;

    let (uuid, journal) = result.only_challenge();
    assert_eq!(
        journal,
        vec![
            entry(
                0,
                0,
                cmd(1),
                LifecycleEvent::ChallengeCreated {
                    uuid,
                    challenge_type: ChallengeType::Colosseum,
                    mode: ChallengeMode::NoMode,
                    party: vec!["aSaradomin".into()],
                    stage: Stage::ColosseumWave1,
                },
            ),
            entry(1, 0, cmd(1), joined(1, RecordingType::Participant)),
            entry(
                2,
                10,
                cmd(2),
                LifecycleEvent::StageStarted {
                    stage: Stage::ColosseumWave1,
                },
            ),
            entry(
                3,
                10,
                cmd(2),
                reported(1, Stage::ColosseumWave1, StageStatus::Started),
            ),
            entry(
                4,
                500,
                cmd(3),
                reported(1, Stage::ColosseumWave1, StageStatus::Completed),
            ),
            entry(
                5,
                500,
                cmd(3),
                LifecycleEvent::StageSealed {
                    stage: Stage::ColosseumWave1,
                    attempt: None,
                    forced: false,
                },
            ),
            entry(
                6,
                600,
                cmd(4),
                LifecycleEvent::StageStarted {
                    stage: Stage::ColosseumWave2,
                },
            ),
            entry(
                7,
                600,
                cmd(4),
                reported(1, Stage::ColosseumWave2, StageStatus::Started),
            ),
            entry(
                8,
                900,
                cmd(5),
                reported(1, Stage::ColosseumWave2, StageStatus::Wiped),
            ),
            entry(
                9,
                900,
                cmd(5),
                LifecycleEvent::StageSealed {
                    stage: Stage::ColosseumWave2,
                    attempt: None,
                    forced: false,
                },
            ),
            entry(
                10,
                1_000,
                cmd(6),
                LifecycleEvent::ClientFinished {
                    client_id: client_id(1),
                    definitive: true,
                    soft: false,
                    times: None,
                },
            ),
            entry(
                11,
                1_000,
                cmd(6),
                LifecycleEvent::ChallengeTerminated {
                    status: ChallengeStatus::Wiped,
                    empty: false,
                },
            ),
        ],
    );
}

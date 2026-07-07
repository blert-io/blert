//! Scenarios ruling on challenge creation, joining, and supersession.

use super::*;
use crate::lifecycle::core::deadline::DeadlineKind;
use crate::lifecycle::core::types::{ChallengeStatus, Uuid};
use crate::lifecycle::sim::{Scenario, run};

#[tokio::test(start_paused = true)]
async fn simultaneous_starts_yield_one_challenge() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1).at(0, tob_start()),
            Client::participant("b", 2).at(0, tob_start()),
        ],
        run_until: 100,
    })
    .await;

    let uuids: Vec<Uuid> = result
        .outcomes
        .iter()
        .map(|o| o.response.as_ref().expect("start should succeed").uuid)
        .collect();
    assert_eq!(uuids[0], uuids[1]);

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
                    challenge_type: ChallengeType::Tob,
                    mode: ChallengeMode::TobRegular,
                    party: duo(),
                    stage: Stage::TobMaiden,
                },
            ),
            entry(1, 0, cmd(1), joined(1, RecordingType::Participant)),
            entry(2, 0, cmd(2), joined(2, RecordingType::Participant)),
        ],
    );
}

#[tokio::test(start_paused = true)]
async fn simultaneous_starts_reversed_order() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("b", 2).at(0, tob_start()),
            Client::participant("a", 1).at(0, tob_start()),
        ],
        run_until: 100,
    })
    .await;

    let uuids: Vec<Uuid> = result
        .outcomes
        .iter()
        .map(|o| o.response.as_ref().expect("start should succeed").uuid)
        .collect();
    assert_eq!(uuids[0], uuids[1]);

    let (_, journal) = result.only_challenge();
    let created = journal
        .iter()
        .filter(|e| matches!(e.event, LifecycleEvent::ChallengeCreated { .. }))
        .count();
    assert_eq!(created, 1);
    assert_eq!(journal.len(), 3);
}

#[tokio::test(start_paused = true)]
async fn earlier_stage_start_supersedes_a_live_challenge() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, tob_start())
                .at(100, report(Stage::TobMaiden, StageStatus::Started))
                .at(500, report(Stage::TobMaiden, StageStatus::Completed))
                .at(600, report(Stage::TobBloat, StageStatus::Started)),
            Client::participant("b", 2).at(700, tob_start()),
        ],
        run_until: 1_000,
    })
    .await;

    assert_eq!(result.journals.len(), 2);
    let first = result.outcomes[0].response.as_ref().unwrap().uuid;
    let start_response = result
        .outcomes
        .iter()
        .find(|o| o.client == "b" && o.at == 700)
        .and_then(|o| o.response.as_ref())
        .expect("b's start should succeed");
    let second = start_response.uuid;
    assert_ne!(second, first);
    assert_eq!(start_response.stage, Stage::TobMaiden);

    assert_eq!(
        result.journals[&second],
        vec![
            entry(
                0,
                0,
                cmd(1),
                LifecycleEvent::ChallengeCreated {
                    uuid: second,
                    challenge_type: ChallengeType::Tob,
                    mode: ChallengeMode::TobRegular,
                    party: duo(),
                    stage: Stage::TobMaiden,
                },
            ),
            entry(1, 0, cmd(1), joined(2, RecordingType::Participant)),
        ],
    );

    // The live challenge never saw b.
    assert!(result.journals[&first].iter().all(|e| {
        !matches!(
            e.event,
            LifecycleEvent::ClientJoined { client_id: joiner, .. } if joiner == client_id(2)
        )
    }));
}

#[tokio::test(start_paused = true)]
async fn terminated_incumbent_is_superseded() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, tob_start())
                .at(100, finish(true))
                .at(200, tob_start()),
        ],
        run_until: 300,
    })
    .await;

    assert_eq!(result.journals.len(), 2);
    let first = result.outcomes[0].response.as_ref().unwrap().uuid;
    let second = result.outcomes[2].response.as_ref().unwrap().uuid;
    assert_ne!(first, second);

    // First challenge ended before any stage began.
    assert!(result.journals[&first].iter().any(|e| matches!(
        e.event,
        LifecycleEvent::ChallengeTerminated {
            status: ChallengeStatus::Reset,
            ..
        },
    )));
}

#[tokio::test(start_paused = true)]
async fn finishing_challenge_is_not_joined() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, tob_start())
                .at(100, finish(false)),
            Client::participant("b", 2).at(0, tob_start()),
            Client::participant("c", 3).at(150, tob_start()),
        ],
        run_until: 5_500,
    })
    .await;

    assert_eq!(result.journals.len(), 2);
    let original = result.outcomes[0].response.as_ref().unwrap().uuid;
    let successor = result
        .outcomes
        .iter()
        .find(|o| o.client == "c")
        .and_then(|o| o.response.as_ref())
        .expect("c's start should succeed")
        .uuid;
    assert_ne!(original, successor);

    // The old challenge terminates after its end grace period.
    let original_journal = &result.journals[&original];
    assert_eq!(
        original_journal[original_journal.len() - 2..],
        vec![
            entry(
                5,
                5_100,
                Cause::Deadline(DeadlineKind::ChallengeEnd),
                LifecycleEvent::ClientRemoved {
                    client_id: client_id(2),
                },
            ),
            entry(
                6,
                5_100,
                Cause::Deadline(DeadlineKind::ChallengeEnd),
                LifecycleEvent::ChallengeTerminated {
                    status: ChallengeStatus::Reset,
                    empty: false,
                },
            ),
        ],
    );
}

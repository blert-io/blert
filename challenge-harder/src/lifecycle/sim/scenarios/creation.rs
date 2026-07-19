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
    assert!(
        result.journals[&first]
            .iter()
            .any(|e| matches!(e.event, LifecycleEvent::ChallengeTerminated { .. },))
    );
    assert_eq!(result.projections[&first].status, ChallengeStatus::Reset);
}

fn solo_start(name: &str) -> Action {
    Action::Start {
        challenge_type: ChallengeType::Tob,
        mode: ChallengeMode::TobRegular,
        party: vec![name.into()],
        stage: Stage::TobMaiden,
    }
}

#[tokio::test(start_paused = true)]
async fn start_for_another_party_leaves_the_recorded_challenge() {
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, solo_start("715"))
                .at(1_000, tob_start()),
        ],
        run_until: 302_000,
    })
    .await;

    assert_eq!(result.journals.len(), 2);
    let first = result.outcomes[0].response.as_ref().unwrap().uuid;
    let second = result.outcomes[1].response.as_ref().unwrap().uuid;
    assert_ne!(first, second);

    // The first challenge loses its client and dies after the reconnection window.
    assert_eq!(
        result.journals[&first],
        vec![
            entry(
                0,
                0,
                cmd(1),
                LifecycleEvent::ChallengeCreated {
                    uuid: first,
                    challenge_type: ChallengeType::Tob,
                    mode: ChallengeMode::TobRegular,
                    party: vec!["715".into()],
                    stage: Stage::TobMaiden,
                },
            ),
            entry(1, 0, cmd(1), joined(1, RecordingType::Participant)),
            entry(
                2,
                1_000,
                cmd(2),
                LifecycleEvent::ClientRemoved {
                    client_id: client_id(1),
                },
            ),
            entry(
                3,
                301_000,
                Cause::Deadline(DeadlineKind::CleanupDisconnect),
                LifecycleEvent::ChallengeTerminated { empty: false },
            ),
        ],
    );
    assert!(result.deleted.contains(&first));
    assert_eq!(result.projections[&first].status, ChallengeStatus::Reset);

    assert!(!result.deleted.contains(&second));
}

#[tokio::test(start_paused = true)]
async fn start_joins_the_left_challenge_within_its_window() {
    // A spectator watching a duo hops to watching 1Ogp instead, then comes back
    // within the reconnection window. The duo challenge continues and the 1Ogp
    // challenge dies in its place.
    let result = run(Scenario {
        clients: vec![
            Client::spectator("s", 1)
                .at(0, tob_start())
                .at(1_000, solo_start("1Ogp"))
                .at(60_000, tob_start()),
        ],
        run_until: 400_000,
    })
    .await;

    assert_eq!(result.journals.len(), 2);
    let duo_watch = result.outcomes[0].response.as_ref().unwrap().uuid;
    let solo_watch = result.outcomes[1].response.as_ref().unwrap().uuid;
    let returned = result.outcomes[2].response.as_ref().unwrap().uuid;
    assert_eq!(returned, duo_watch);

    assert!(
        result.journals[&duo_watch]
            .iter()
            .all(|e| !matches!(e.event, LifecycleEvent::ChallengeTerminated { .. }))
    );
    assert!(!result.deleted.contains(&duo_watch));
    assert!(result.deleted.contains(&solo_watch));
}

#[tokio::test(start_paused = true)]
async fn start_after_finishing_leaves_nothing() {
    let result = run(Scenario {
        clients: vec![
            Client::spectator("s", 1)
                .at(0, solo_start("1Ogp"))
                .at(100, finish(true))
                .at(200, tob_start()),
        ],
        run_until: 1_000,
    })
    .await;

    assert_eq!(result.journals.len(), 2);
    let first = result.outcomes[0].response.as_ref().unwrap().uuid;

    assert_eq!(result.inboxes[&first].len(), 2);
    assert!(
        result.journals[&first]
            .iter()
            .all(|e| !matches!(e.event, LifecycleEvent::ClientRemoved { .. }))
    );
}

#[tokio::test(start_paused = true)]
async fn start_attaching_to_an_incumbent_leaves_the_recorded_challenge() {
    // 715 starts a solo, then starts a duo with WWWWWWWWWWQQ's raid without
    // sending a finish for the solo. WWWWWWWWWWQQ's create event arrives first,
    // starts, so the start attaches to it and the solo is left to expire.
    let result = run(Scenario {
        clients: vec![
            Client::participant("a", 1).at(0, solo_start("715")),
            Client::participant("b", 2).at(1_000, tob_start()),
            Client::participant("a", 1).at(1_005, tob_start()),
        ],
        run_until: 302_000,
    })
    .await;

    assert_eq!(result.journals.len(), 2);
    let solo = result.outcomes[0].response.as_ref().unwrap().uuid;
    let duo = result
        .outcomes
        .iter()
        .find(|o| o.client == "b")
        .and_then(|o| o.response.as_ref())
        .expect("b's start should succeed")
        .uuid;
    let attached = result
        .outcomes
        .iter()
        .find(|o| o.client == "a" && o.at == 1_005)
        .and_then(|o| o.response.as_ref())
        .expect("a's second start should succeed")
        .uuid;
    assert_eq!(attached, duo);

    assert!(result.journals[&duo].iter().any(|e| {
        matches!(
            e.event,
            LifecycleEvent::ClientJoined { client_id: joiner, .. } if joiner == client_id(1)
        )
    }));
    assert!(result.journals[&solo].iter().any(|e| {
        matches!(
            e.event,
            LifecycleEvent::ClientRemoved { client_id: removed } if removed == client_id(1)
        )
    }));
    assert!(
        result.journals[&solo]
            .iter()
            .any(|e| matches!(e.event, LifecycleEvent::ChallengeTerminated { .. }))
    );
    assert!(result.deleted.contains(&solo));
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
                LifecycleEvent::ChallengeTerminated { empty: false },
            ),
        ],
    );
}

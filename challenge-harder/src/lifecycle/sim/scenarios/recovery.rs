//! Tests challenge crash recovery.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::watch;

use super::super::Collector;
use crate::lifecycle::challenge::{ChallengeStore, Claim, run_challenge};
use crate::lifecycle::coordinator::Coordinator;
use crate::lifecycle::core::command::{ClientStatus, ClientStatusChange, Command, Create, Finish};
use crate::lifecycle::core::deadline::{DeadlineKind, LifecycleConfig};
use crate::lifecycle::core::event::{Cause, JournalEntry, LifecycleEvent};
use crate::lifecycle::core::types::{
    ChallengeMode, ChallengeStatus, ChallengeType, ClientId, JournalSeq, MsgId, RecordingType,
    Stage, Timestamp, UserId, Uuid,
};

fn config() -> LifecycleConfig {
    LifecycleConfig {
        reconnection_window: Duration::from_mins(1),
        ..LifecycleConfig::default()
    }
}

/// A fresh runtime starting with a paused clock. Dropping it kills every
/// spawned actor, as a server crash would.
fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .start_paused(true)
        .build()
        .expect("runtime builds")
}

fn create() -> Create {
    Create {
        user_id: UserId(1),
        client_id: ClientId(10),
        session_token: "tok1".into(),
        plugin_version: "0.9.14".into(),
        runelite_version: "1.12.31.1".into(),
        challenge_type: ChallengeType::Tob,
        mode: ChallengeMode::TobRegular,
        party: vec!["WWWWWWWWWWQQ".into()],
        stage: Stage::TobMaiden,
        recording_type: RecordingType::Participant,
    }
}

fn created_entries(uuid: Uuid) -> Vec<JournalEntry> {
    vec![
        JournalEntry {
            seq: JournalSeq(0),
            at: Timestamp::ZERO,
            caused_by: Cause::Command(MsgId::sequence(1)),
            event: LifecycleEvent::ChallengeCreated {
                uuid,
                challenge_type: ChallengeType::Tob,
                mode: ChallengeMode::TobRegular,
                party: vec!["WWWWWWWWWWQQ".into()],
                stage: Stage::TobMaiden,
            },
        },
        JournalEntry {
            seq: JournalSeq(1),
            at: Timestamp::ZERO,
            caused_by: Cause::Command(MsgId::sequence(1)),
            event: LifecycleEvent::ClientJoined {
                client_id: ClientId(10),
                user_id: UserId(1),
                session_token: "tok1".into(),
                recording_type: RecordingType::Participant,
            },
        },
    ]
}

fn journal(collector: &Collector, uuid: Uuid) -> Vec<JournalEntry> {
    collector
        .journals
        .lock()
        .expect("collector lock poisoned")
        .journals
        .get(&uuid)
        .cloned()
        .unwrap_or_default()
}

fn deleted(collector: &Collector, uuid: Uuid) -> bool {
    collector
        .routing
        .lock()
        .expect("collector lock poisoned")
        .deleted
        .contains(&uuid)
}

async fn expect_claimable(store: &Collector, uuid: Uuid) -> Claim {
    let mut claims = store
        .claim_unowned(2, &[])
        .await
        .expect("claim should succeed");
    assert_eq!(claims.len(), 1, "expected exactly one claimable challenge");
    let claim = claims.remove(0);
    assert_eq!(claim.uuid(), uuid);
    claim
}

#[test]
fn killed_server_resumes_windows_with_time_to_run() {
    let collector = Collector::default();
    let (_tx, rx) = watch::channel(false);

    // A client creates a challenge and disconnects a second in, arming the
    // reconnection window. The server dies halfway through it.
    let store = collector.clone();
    let r1 = rx.clone();
    let uuid = runtime().block_on(async move {
        let coordinator = Coordinator::with_store(Arc::new(store), r1).with_config(config());
        let snapshot = coordinator
            .create_or_join_challenge(create())
            .await
            .expect("create should apply");
        tokio::time::sleep(Duration::from_secs(1)).await;
        coordinator
            .update_client_status(ClientStatusChange {
                user_id: UserId(1),
                client_id: ClientId(10),
                session_token: "tok1".into(),
                status: ClientStatus::Disconnected,
            })
            .await
            .expect("status should apply");
        tokio::time::sleep(Duration::from_secs(30)).await;
        snapshot.uuid
    });

    let removed = JournalEntry {
        seq: JournalSeq(2),
        at: Timestamp::from_millis(1_000),
        caused_by: Cause::Command(MsgId::sequence(2)),
        event: LifecycleEvent::ClientRemoved {
            client_id: ClientId(10),
        },
    };
    let mut expected = created_entries(uuid);
    expected.push(removed);
    assert_eq!(journal(&collector, uuid), expected);

    // A new server claims and resumes the challenge, and the window continues
    // from where it left off.
    let store = collector.clone();
    let r2 = rx.clone();
    runtime().block_on(async {
        tokio::spawn(run_challenge(
            config(),
            expect_claimable(&store, uuid).await,
            None,
            r2,
        ));

        tokio::time::sleep(Duration::from_secs(59)).await;
        assert_eq!(
            journal(&store, uuid).len(),
            3,
            "window fired before its full regrant elapsed",
        );

        tokio::time::sleep(Duration::from_secs(2)).await;
    });

    expected.push(JournalEntry {
        seq: JournalSeq(3),
        at: Timestamp::from_millis(61_000),
        caused_by: Cause::Deadline(DeadlineKind::CleanupDisconnect),
        event: LifecycleEvent::ChallengeTerminated { empty: false },
    });
    assert_eq!(journal(&collector, uuid), expected);
    assert!(deleted(&collector, uuid));
}

fn finish() -> Command {
    Command::Finish(Finish {
        user_id: UserId(1),
        client_id: ClientId(10),
        session_token: "tok1".into(),
        times: None,
        soft: false,
    })
}

/// The journal of a challenge finished by a backlogged finish command at
/// `finish_id`, applied at the challenge clock's zero.
fn finished_entries(uuid: Uuid, finish_id: MsgId) -> Vec<JournalEntry> {
    let mut entries = created_entries(uuid);
    entries.push(JournalEntry {
        seq: JournalSeq(2),
        at: Timestamp::ZERO,
        caused_by: Cause::Command(finish_id),
        event: LifecycleEvent::ClientFinished {
            client_id: ClientId(10),
            definitive: true,
            soft: false,
            times: None,
        },
    });
    entries.push(JournalEntry {
        seq: JournalSeq(3),
        at: Timestamp::ZERO,
        caused_by: Cause::Command(finish_id),
        event: LifecycleEvent::ChallengeTerminated { empty: false },
    });
    entries
}

#[test]
fn killed_server_drains_backlogged_commands_on_resume() {
    let collector = Collector::default();
    let (_tx, rx) = watch::channel(false);

    // The server dies right after applying the create.
    let store = collector.clone();
    let r1 = rx.clone();
    let uuid = runtime().block_on(async move {
        let coordinator = Coordinator::with_store(Arc::new(store), r1).with_config(config());
        let snapshot = coordinator
            .create_or_join_challenge(create())
            .await
            .expect("create should apply");
        snapshot.uuid
    });
    assert_eq!(journal(&collector, uuid), created_entries(uuid));

    // A finish arrives while nothing is running; it queues durably.
    let store = collector.clone();
    let finish_id = runtime().block_on(async {
        store
            .send(uuid, &finish())
            .await
            .expect("send should succeed")
            .expect("challenge should exist")
    });

    // The resumed challenge replays past the applied create and consumes
    // only the backlogged finish.
    let store = collector.clone();
    let r2 = rx.clone();
    runtime().block_on(async {
        run_challenge(config(), expect_claimable(&store, uuid).await, None, r2).await;
    });

    assert_eq!(journal(&collector, uuid), finished_entries(uuid, finish_id));
    assert!(deleted(&collector, uuid));
}

#[test]
fn shutdown_server_hands_over_resumable_state() {
    let collector = Collector::default();

    // The server shuts down nine seconds into a reconnection window.
    let store = collector.clone();
    let uuid = runtime().block_on(async move {
        let (tx, rx) = watch::channel(false);
        let coordinator = Coordinator::with_store(Arc::new(store), rx).with_config(config());
        let snapshot = coordinator
            .create_or_join_challenge(create())
            .await
            .expect("create should apply");
        tokio::time::sleep(Duration::from_secs(1)).await;
        coordinator
            .update_client_status(ClientStatusChange {
                user_id: UserId(1),
                client_id: ClientId(10),
                session_token: "tok1".into(),
                status: ClientStatus::Disconnected,
            })
            .await
            .expect("status should apply");
        tokio::time::sleep(Duration::from_secs(9)).await;
        tx.send(true).expect("coordinator should be listening");
        coordinator.drained().await;
        snapshot.uuid
    });

    let mut expected = created_entries(uuid);
    expected.push(JournalEntry {
        seq: JournalSeq(2),
        at: Timestamp::from_millis(1_000),
        caused_by: Cause::Command(MsgId::sequence(2)),
        event: LifecycleEvent::ClientRemoved {
            client_id: ClientId(10),
        },
    });
    assert_eq!(journal(&collector, uuid), expected);
    assert!(!deleted(&collector, uuid));

    // A new coordinator resumes the challenge.
    let store = collector.clone();
    runtime().block_on(async move {
        let (_tx, rx) = watch::channel(false);
        let coordinator = Coordinator::with_store(Arc::new(store), rx).with_config(config());
        coordinator.start_scan(Duration::from_secs(5));
        tokio::time::sleep(Duration::from_secs(70)).await;
    });

    expected.push(JournalEntry {
        seq: JournalSeq(3),
        at: Timestamp::from_millis(61_000),
        caused_by: Cause::Deadline(DeadlineKind::CleanupDisconnect),
        event: LifecycleEvent::ChallengeTerminated { empty: false },
    });
    assert_eq!(journal(&collector, uuid), expected);
    assert!(deleted(&collector, uuid));
}

#[test]
fn killed_server_challenges_resume_through_the_boot_scan() {
    let collector = Collector::default();
    let (_tx, rx) = watch::channel(false);

    // Original challenge created and released.
    let store = collector.clone();
    let r1 = rx.clone();
    let uuid = runtime().block_on(async move {
        let coordinator = Coordinator::with_store(Arc::new(store), r1).with_config(config());
        let snapshot = coordinator
            .create_or_join_challenge(create())
            .await
            .expect("create should apply");
        snapshot.uuid
    });

    // Client sends command while inactive.
    let store = collector.clone();
    let finish_id = runtime().block_on(async {
        store
            .send(uuid, &finish())
            .await
            .expect("send should succeed")
            .expect("challenge should exist")
    });

    // New coordinator coming online reclaims the challenge and processes it.
    let store = collector.clone();
    let r2 = rx.clone();
    runtime().block_on(async move {
        let coordinator = Coordinator::with_store(Arc::new(store), r2).with_config(config());
        coordinator.start_scan(Duration::from_secs(5));
        tokio::time::sleep(Duration::from_secs(1)).await;
    });

    assert_eq!(journal(&collector, uuid), finished_entries(uuid, finish_id));
    assert!(deleted(&collector, uuid));
}

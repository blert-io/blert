//! Integration tests against the Redis instance at `BLERT_TEST_REDIS_URI`,
//! skipped when it is unset. The database it names must be dedicated to
//! tests, as it is flushed once per run.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use futures_util::StreamExt;
use redis::AsyncCommands;

use super::*;
use crate::lifecycle::core::command::{Finish, Update};
use crate::lifecycle::core::event::{Cause, LifecycleEvent};
use crate::lifecycle::core::state::{ChallengePhase, LastCompleted, PhaseState};
use crate::lifecycle::core::types::{
    ChallengeMode, ChallengeStatus, ChallengeType, ClientId, JournalSeq, MsgId, RecordingType,
    Stage, StageStatus, Timestamp, UserId,
};

/// Returns a unique client ID on every call. Tests share a Redis instance and
/// run in parallel, so this avoids key collisions.
fn test_client() -> ClientId {
    static NEXT_CLIENT: AtomicI64 = AtomicI64::new(7_000);
    ClientId(NEXT_CLIENT.fetch_add(1, Ordering::Relaxed))
}

/// Unique party names for commands sent by `client` to avoid Redis collisions.
fn test_party_members(client: ClientId) -> Vec<String> {
    vec![format!("1Ogp {client}"), format!("WQ {client}")]
}

/// The directory identity of a create request's party.
fn party_of(create: &Create) -> String {
    party_key(create.challenge_type, &create.party)
}

#[test]
fn party_key_normalizes_then_sorts_names() {
    let key = party_key(
        ChallengeType::Tob,
        &[
            "WWWWWWWWWWQQ".into(),
            "715".into(),
            "1Ogp".into(),
            "Caps lock13".into(),
        ],
    );
    assert_eq!(key, "1-1ogp-715-caps_lock13-wwwwwwwwwwqq");

    let key = party_key(ChallengeType::Tob, &["AB".into(), "Aa".into()]);
    assert_eq!(key, "1-aa-ab");
}

fn create_request(client: ClientId) -> Create {
    Create {
        user_id: UserId(client.0),
        client_id: client,
        session_token: format!("tok{client}").into(),
        plugin_version: "0.9.14".into(),
        runelite_version: "1.12.31.1".into(),
        challenge_type: ChallengeType::Tob,
        mode: ChallengeMode::TobRegular,
        party: test_party_members(client),
        stage: Stage::TobMaiden,
        recording_type: RecordingType::Participant,
    }
}

fn create_request_at(client: ClientId, stage: Stage) -> Create {
    Create {
        stage,
        ..create_request(client)
    }
}

const TEST_IDENTITY: &str = "test-server";

static TEST_DB_FLUSHED: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();

async fn test_store() -> Option<Store> {
    let Ok(uri) = std::env::var("BLERT_TEST_REDIS_URI") else {
        eprintln!("BLERT_TEST_REDIS_URI is not set; skipping Redis tests");
        return None;
    };
    let store = Store::connect(&uri, TEST_IDENTITY.into())
        .await
        .expect("test redis unreachable");

    // The default database may hold dev data, so don't flush it.
    assert_ne!(
        store.client.get_connection_info().redis_settings().db(),
        0,
        "BLERT_TEST_REDIS_URI must name a dedicated test database, e.g. redis://localhost:6379/15",
    );

    TEST_DB_FLUSHED
        .get_or_init(|| async {
            let mut connection = store.connection.clone();
            let _: () = redis::cmd("FLUSHDB")
                .query_async(&mut connection)
                .await
                .expect("flush should succeed");
        })
        .await;
    Some(store)
}

/// Returns a dedicated connection to the test Redis, subscribed to `channel`.
/// Only valid after a `test_store` guard has checked the environment.
async fn test_pubsub(channel: &str) -> redis::aio::PubSub {
    let uri = std::env::var("BLERT_TEST_REDIS_URI").expect("checked by test_store");
    let mut pubsub = redis::Client::open(uri)
        .unwrap()
        .get_async_pubsub()
        .await
        .unwrap();
    pubsub.subscribe(channel).await.unwrap();
    pubsub
}

fn entry(seq: u64, event: LifecycleEvent) -> JournalEntry {
    JournalEntry {
        seq: JournalSeq(seq),
        at: Timestamp::from_millis(seq * 100),
        caused_by: Cause::Command(MsgId::sequence(1)),
        event,
    }
}

/// The same store, claiming under a different identity.
fn as_identity(store: &Store, identity: &str) -> Store {
    Store {
        identity: identity.into(),
        ..store.clone()
    }
}

/// Establishes a fresh challenge's lease as a start would, returning its
/// claim at the initial epoch.
async fn stub_claim(store: &Store, uuid: Uuid) -> RedisClaim {
    let mut connection = store.connection.clone();
    let _: () = connection
        .hset_multiple(
            lease_key(uuid),
            &[
                ("fence", Epoch::INITIAL.to_string()),
                ("owner", TEST_IDENTITY.to_string()),
            ],
        )
        .await
        .unwrap();
    let _: () = connection
        .zadd(LEASES_KEY, uuid.to_string(), lease_deadline())
        .await
        .unwrap();
    store.redis_claim(uuid, Epoch::INITIAL)
}

/// Serializes tests that hold lapsed or foreign-identity leases in the shared
/// index, as a concurrent claim sweep would take them over mid-test.
static SWEEP_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn clean_up(store: &Store, uuid: Uuid) {
    let mut connection = store.connection.clone();
    let _: () = connection.zrem(LEASES_KEY, uuid.to_string()).await.unwrap();
    let _: () = connection
        .del(
            &[
                journal_key(uuid),
                lease_key(uuid),
                challenge_key(uuid),
                inbox_key(uuid),
            ][..],
        )
        .await
        .unwrap();
}

/// Cleans up keys related to a challenge start. Best effort as anything missed
/// is isolated by key uniqueness and dies at the next test run's flush.
async fn clean_up_start(store: &Store, party: &str, clients: &[ClientId], uuids: &[Uuid]) {
    let mut connection = store.connection.clone();
    let mut keys = vec![directory_key(party)];
    keys.extend(clients.iter().map(|client| client_key(*client)));
    let _: () = connection.del(keys).await.unwrap();
    for uuid in uuids {
        clean_up(store, *uuid).await;
    }
}

/// Reads a challenge's full journal stream as `(epoch, batch)` pairs, with each
/// batch parsed back into its entries.
async fn read_journal(store: &Store, uuid: Uuid) -> Vec<(String, Vec<JournalEntry>)> {
    let mut connection = store.connection.clone();
    let entries: Vec<(String, Vec<(String, String)>)> = redis::cmd("XRANGE")
        .arg(journal_key(uuid))
        .arg("-")
        .arg("+")
        .query_async(&mut connection)
        .await
        .unwrap();
    entries
        .into_iter()
        .map(|(_, fields)| {
            let [(epoch_field, epoch), (batch_field, batch)] = &fields[..] else {
                panic!("unexpected journal entry fields: {fields:?}");
            };
            assert_eq!(epoch_field, "epoch");
            assert_eq!(batch_field, "batch");
            (epoch.clone(), serde_json::from_str(batch).unwrap())
        })
        .collect()
}

/// Reads a challenge's full inbox as `(id, fields)` pairs, with command
/// payloads parsed.
async fn read_inbox(store: &Store, uuid: Uuid) -> Vec<(MsgId, Vec<(String, Command)>)> {
    let mut connection = store.connection.clone();
    let entries: Vec<(String, Vec<(String, String)>)> = redis::cmd("XRANGE")
        .arg(inbox_key(uuid))
        .arg("-")
        .arg("+")
        .query_async(&mut connection)
        .await
        .unwrap();
    entries
        .into_iter()
        .map(|(id, fields)| {
            let fields = fields
                .into_iter()
                .map(|(name, value)| (name, serde_json::from_str(&value).unwrap()))
                .collect();
            (id.parse().unwrap(), fields)
        })
        .collect()
}

fn snapshot(uuid: Uuid, cursor: u64) -> Snapshot {
    Snapshot {
        uuid,
        challenge_type: ChallengeType::Tob,
        mode: ChallengeMode::TobRegular,
        stage: Stage::TobMaiden,
        stage_attempt: None,
        party: vec!["1Ogp".into(), "WWWWWWWWWWQQ".into()],
        phase: ChallengePhase::Active,
        status: ChallengeStatus::InProgress,
        cursor: MsgId::sequence(cursor),
    }
}

#[tokio::test]
async fn appends_land_under_a_held_fence() {
    let Some(store) = test_store().await else {
        return;
    };
    let uuid = Uuid::new_v4();
    let claim = stub_claim(&store, uuid).await;

    let first = vec![
        entry(
            0,
            LifecycleEvent::ModeChanged {
                mode: ChallengeMode::TobRegular,
            },
        ),
        entry(
            1,
            LifecycleEvent::StageStarted {
                stage: Stage::TobMaiden,
            },
        ),
    ];
    let second = vec![entry(
        2,
        LifecycleEvent::StageStarted {
            stage: Stage::TobBloat,
        },
    )];
    claim.append(&first).await.expect("append should succeed");
    claim.append(&second).await.expect("append should succeed");

    assert_eq!(
        read_journal(&store, uuid).await,
        vec![("1".into(), first.clone()), ("1".into(), second.clone())],
    );
    // The claim reads the same entries back, batches flattened.
    assert_eq!(claim.load().await, Ok([first, second].concat()));

    clean_up(&store, uuid).await;
}

#[tokio::test]
async fn bumped_fence_rejects_stale_epoch() {
    let Some(store) = test_store().await else {
        return;
    };
    let uuid = Uuid::new_v4();
    let claim = stub_claim(&store, uuid).await;

    let first = vec![entry(
        0,
        LifecycleEvent::StageStarted {
            stage: Stage::TobMaiden,
        },
    )];
    claim.append(&first).await.expect("append should succeed");

    let mut connection = store.connection.clone();
    let _: () = connection.hset(lease_key(uuid), "fence", 2).await.unwrap();

    let second = vec![entry(
        1,
        LifecycleEvent::StageStarted {
            stage: Stage::TobBloat,
        },
    )];
    assert_eq!(claim.append(&second).await, Err(StoreError::Fenced));
    assert_eq!(read_journal(&store, uuid).await, vec![("1".into(), first)]);

    clean_up(&store, uuid).await;
}

#[tokio::test]
async fn expired_leases_are_claimed_and_fenced() {
    let Some(store) = test_store().await else {
        return;
    };
    let _guard = SWEEP_LOCK.lock().await;
    let client = test_client();
    let create = create_request(client);
    let party = party_of(&create);

    let Ok(Start::Created { claim, .. }) = store.start(create.clone()).await else {
        panic!("expected a creation");
    };
    let uuid = claim.uuid();
    let journal = vec![entry(
        0,
        LifecycleEvent::StageStarted {
            stage: Stage::TobMaiden,
        },
    )];
    claim.append(&journal).await.expect("append should succeed");

    // The owning server dies.
    let mut connection = store.connection.clone();
    let _: () = connection
        .zadd(LEASES_KEY, uuid.to_string(), 500)
        .await
        .unwrap();

    // A new server claims the challenge and gets exclusive ownership.
    let claims = as_identity(&store, "reclaimer")
        .claim_unowned(10, &[])
        .await
        .expect("sweep should succeed");
    let [reclaimed] = claims.as_slice() else {
        panic!("expected exactly one claim, got {}", claims.len());
    };
    assert_eq!(reclaimed.uuid(), uuid);

    assert_eq!(reclaimed.load().await, Ok(journal));
    let second = vec![entry(
        1,
        LifecycleEvent::StageStarted {
            stage: Stage::TobBloat,
        },
    )];
    reclaimed
        .append(&second)
        .await
        .expect("append should succeed");
    assert_eq!(claim.append(&second).await, Err(StoreError::Fenced));

    let lease: BTreeMap<String, String> = connection.hgetall(lease_key(uuid)).await.unwrap();
    assert_eq!(lease["fence"], "2");
    assert_eq!(lease["owner"], "reclaimer");
    let deadline: Option<u64> = connection
        .zscore(LEASES_KEY, uuid.to_string())
        .await
        .unwrap();
    assert!(deadline.expect("challenge should stay indexed") > unix_millis());

    clean_up_start(&store, &party, &[client], &[uuid]).await;
}

#[tokio::test]
async fn held_leases_are_reclaimable_only_by_their_owner() {
    let Some(store) = test_store().await else {
        return;
    };
    let _guard = SWEEP_LOCK.lock().await;
    let owner = as_identity(&store, "crashed-server");
    let client = test_client();
    let create = create_request(client);
    let party = party_of(&create);

    let Ok(Start::Created { claim, .. }) = owner.start(create.clone()).await else {
        panic!("expected a creation");
    };
    let uuid = claim.uuid();

    // The lease is still live, so only its recorded owner may take it over.
    let strangers = as_identity(&store, "other-server")
        .claim_unowned(10, &[])
        .await
        .expect("sweep should succeed");
    assert!(strangers.is_empty(), "a held lease was claimed away");

    let claims = owner
        .claim_unowned(10, &[])
        .await
        .expect("sweep should succeed");
    let [reclaimed] = claims.as_slice() else {
        panic!("expected exactly one claim, got {}", claims.len());
    };
    assert_eq!(reclaimed.uuid(), uuid);

    let mut connection = store.connection.clone();
    let fence: String = connection.hget(lease_key(uuid), "fence").await.unwrap();
    assert_eq!(fence, "2");

    clean_up_start(&store, &party, &[client], &[uuid]).await;
}

#[tokio::test]
async fn running_challenges_are_not_swept() {
    let Some(store) = test_store().await else {
        return;
    };
    let _guard = SWEEP_LOCK.lock().await;
    let owner = as_identity(&store, "restarted-server");
    let client = test_client();
    let create = create_request(client);
    let party = party_of(&create);

    let Ok(Start::Created { claim, .. }) = owner.start(create.clone()).await else {
        panic!("expected a creation");
    };
    let uuid = claim.uuid();

    let running = [uuid];
    let claims = owner
        .claim_unowned(10, &running)
        .await
        .expect("sweep should succeed");
    assert!(claims.is_empty(), "a running challenge was swept");

    let mut connection = store.connection.clone();
    let _: () = connection
        .zadd(LEASES_KEY, uuid.to_string(), 500)
        .await
        .unwrap();
    let claims = owner
        .claim_unowned(10, &running)
        .await
        .expect("sweep should succeed");
    assert!(claims.is_empty(), "a running challenge was swept");

    let fence: String = connection.hget(lease_key(uuid), "fence").await.unwrap();
    assert_eq!(fence, "1");

    clean_up_start(&store, &party, &[client], &[uuid]).await;
}

#[tokio::test]
async fn claim_sweeps_respect_the_batch_size() {
    let Some(store) = test_store().await else {
        return;
    };
    let _guard = SWEEP_LOCK.lock().await;
    let mut connection = store.connection.clone();

    // Three lapsed challenges, oldest lease first.
    let mut challenges = Vec::new();
    for deadline in [100, 200, 300] {
        let client = test_client();
        let create = create_request(client);
        let party = party_of(&create);
        let Ok(Start::Created { claim, .. }) = store.start(create).await else {
            panic!("expected a creation");
        };
        let _: () = connection
            .zadd(LEASES_KEY, claim.uuid().to_string(), deadline)
            .await
            .unwrap();
        challenges.push((party, client, claim.uuid()));
    }

    let claims = as_identity(&store, "batcher")
        .claim_unowned(2, &[])
        .await
        .expect("sweep should succeed");
    let claimed: Vec<Uuid> = claims.iter().map(Claim::uuid).collect();
    assert_eq!(claimed, vec![challenges[0].2, challenges[1].2]);

    let fence: String = connection
        .hget(lease_key(challenges[2].2), "fence")
        .await
        .unwrap();
    assert_eq!(fence, "1");

    for (party, client, uuid) in &challenges {
        clean_up_start(&store, party, &[*client], &[*uuid]).await;
    }
}

#[tokio::test]
async fn renewal_extends_a_held_lease() {
    let Some(store) = test_store().await else {
        return;
    };
    let _guard = SWEEP_LOCK.lock().await;
    let uuid = Uuid::new_v4();
    let claim = stub_claim(&store, uuid).await;

    let mut connection = store.connection.clone();
    let _: () = connection
        .zadd(LEASES_KEY, uuid.to_string(), 500)
        .await
        .unwrap();

    claim.renew().await.expect("renew should succeed");
    let renewed: Option<u64> = connection
        .zscore(LEASES_KEY, uuid.to_string())
        .await
        .unwrap();
    let renewed = renewed.expect("challenge should stay indexed");
    assert!(renewed > unix_millis());

    // If claimed away, the extension fails.
    let _: () = connection.hset(lease_key(uuid), "fence", 2).await.unwrap();
    assert_eq!(claim.renew().await, Err(StoreError::Fenced));
    let unchanged: Option<u64> = connection
        .zscore(LEASES_KEY, uuid.to_string())
        .await
        .unwrap();
    assert_eq!(unchanged, Some(renewed));

    clean_up(&store, uuid).await;
}

#[tokio::test]
async fn release_makes_a_lease_immediately_claimable() {
    let Some(store) = test_store().await else {
        return;
    };
    let _guard = SWEEP_LOCK.lock().await;
    let uuid = Uuid::new_v4();
    let claim = stub_claim(&store, uuid).await;

    claim.release().await.expect("release should succeed");
    let mut connection = store.connection.clone();
    let released: Option<u64> = connection
        .zscore(LEASES_KEY, uuid.to_string())
        .await
        .unwrap();
    assert_eq!(released, Some(0));

    // Any instance may pick the challenge up without waiting.
    let claims = as_identity(&store, "successor")
        .claim_unowned(10, &[])
        .await
        .expect("sweep should succeed");
    let [succeeded] = claims.as_slice() else {
        panic!("expected exactly one claim, got {}", claims.len());
    };
    assert_eq!(succeeded.uuid(), uuid);

    // The releaser can no longer reclaim.
    assert_eq!(claim.release().await, Err(StoreError::Fenced));
    let deadline: Option<u64> = connection
        .zscore(LEASES_KEY, uuid.to_string())
        .await
        .unwrap();
    assert!(deadline.expect("challenge should stay indexed") > unix_millis());

    clean_up(&store, uuid).await;
}

#[tokio::test]
async fn projection_writes_hash_and_signals() {
    let Some(store) = test_store().await else {
        return;
    };
    let uuid = Uuid::new_v4();
    assert_eq!(store.read(uuid).await, Ok(None));
    let claim = stub_claim(&store, uuid).await;

    let mut pubsub = test_pubsub(SIGNAL_CHANNEL).await;
    let mut messages = pubsub.on_message();

    claim
        .project(&snapshot(uuid, 4), &[])
        .await
        .expect("project should succeed");
    assert_eq!(store.read(uuid).await, Ok(Some(snapshot(uuid, 4))));

    let mut connection = store.connection.clone();
    let hash: BTreeMap<String, String> = connection.hgetall(challenge_key(uuid)).await.unwrap();
    let expected: BTreeMap<String, String> = [
        ("type", "1"),
        ("mode", "11"),
        ("status", "0"),
        ("stage", "10"),
        ("party", "1Ogp,WWWWWWWWWWQQ"),
        ("phase", "ACTIVE"),
        ("cursor", "0-4"),
    ]
    .into_iter()
    .map(|(field, value)| (field.to_string(), value.to_string()))
    .collect();
    assert_eq!(hash, expected);

    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    let cursor = loop {
        let message = tokio::time::timeout_at(deadline, messages.next())
            .await
            .expect("signal should arrive within the timeout")
            .expect("pubsub stream should stay open");
        let payload: String = message.get_payload().unwrap();
        let signal: ChallengeSignal = serde_json::from_str(&payload).unwrap();
        if let ChallengeSignal::Updated { uuid: id, cursor } = signal
            && id == uuid
        {
            break cursor;
        }
    };
    assert_eq!(cursor, MsgId::sequence(4));

    // A later projection overwrites the previous snapshot and publishes
    // the challenge's clients.
    let updated = Snapshot {
        stage_attempt: Some(3),
        ..snapshot(uuid, 5)
    };
    let client = PublishedClient {
        user_id: UserId(435),
        client_id: ClientId(286),
        recording_type: RecordingType::Participant,
        active: true,
        stage: Stage::TobMaiden,
        stage_attempt: Some(3),
        stage_status: StageStatus::Completed,
        last_completed: LastCompleted {
            stage: Stage::TobMaiden,
            attempt: Some(2),
        },
    };
    claim
        .project(&updated, std::slice::from_ref(&client))
        .await
        .expect("project should succeed");
    let hash: BTreeMap<String, String> = connection.hgetall(challenge_key(uuid)).await.unwrap();
    assert_eq!(hash["stageAttempt"], "3");
    assert_eq!(hash["cursor"], "0-5");
    assert_eq!(store.read(uuid).await, Ok(Some(updated)));

    // The clients hash holds the wire form the old contract's readers parse.
    let clients: BTreeMap<String, String> = connection.hgetall(clients_key(uuid)).await.unwrap();
    assert_eq!(
        clients,
        [(
            "286".to_string(),
            concat!(
                r#"{"userId":435,"clientId":286,"type":1,"active":true,"#,
                r#""stage":10,"stageAttempt":3,"stageStatus":2,"#,
                r#""lastCompleted":{"stage":10,"attempt":2}}"#,
            )
            .to_string(),
        )]
        .into_iter()
        .collect(),
    );

    // Moving to a stage without attempt tracking removes the field, and a
    // projection without clients removes the clients hash.
    claim
        .project(&snapshot(uuid, 6), &[])
        .await
        .expect("project should succeed");
    let hash: BTreeMap<String, String> = connection.hgetall(challenge_key(uuid)).await.unwrap();
    assert!(!hash.contains_key("stageAttempt"), "{hash:?}");
    assert_eq!(store.read(uuid).await, Ok(Some(snapshot(uuid, 6))));
    let clients: bool = connection.exists(clients_key(uuid)).await.unwrap();
    assert!(!clients);

    clean_up(&store, uuid).await;
}

#[tokio::test]
async fn subscriber_delivers_update_signals() {
    let Some(store) = test_store().await else {
        return;
    };
    let uuid = Uuid::new_v4();
    let claim = stub_claim(&store, uuid).await;

    let (tx, mut rx) = mpsc::channel(16);

    store.subscribe(tx);

    // The subscription races the first projections; keep projecting until
    // one of this challenge's signals comes through.
    let mut cursor = 0;
    let received = 'projecting: loop {
        cursor += 1;
        assert!(cursor < 10, "no signal after {cursor} projections");
        claim
            .project(&snapshot(uuid, cursor), &[])
            .await
            .expect("project should succeed");
        let deadline = tokio::time::Instant::now() + Duration::from_millis(250);
        loop {
            match tokio::time::timeout_at(deadline, rx.recv()).await {
                Ok(Some(ChallengeSignal::Updated { uuid: id, cursor })) if id == uuid => {
                    break 'projecting cursor;
                }
                Ok(Some(_)) => {}
                Ok(None) => panic!("signal channel closed"),
                Err(_) => break,
            }
        }
    };
    assert!(received >= MsgId::sequence(1) && received <= MsgId::sequence(cursor));

    clean_up(&store, uuid).await;
}

#[tokio::test]
async fn bumped_fence_rejects_projection() {
    let Some(store) = test_store().await else {
        return;
    };
    let uuid = Uuid::new_v4();
    let claim = stub_claim(&store, uuid).await;

    let mut connection = store.connection.clone();
    let _: () = connection.hset(lease_key(uuid), "fence", 2).await.unwrap();

    assert_eq!(
        claim.project(&snapshot(uuid, 1), &[]).await,
        Err(StoreError::Fenced),
    );
    let exists: bool = connection.exists(challenge_key(uuid)).await.unwrap();
    assert!(!exists);

    clean_up(&store, uuid).await;
}

#[tokio::test]
async fn announce_publishes_finish() {
    let Some(store) = test_store().await else {
        return;
    };
    let uuid = Uuid::new_v4();
    let claim = stub_claim(&store, uuid).await;

    let mut pubsub = test_pubsub(CHALLENGE_UPDATES_CHANNEL).await;
    let mut messages = pubsub.on_message();

    claim
        .announce(&ChallengeServerUpdate::Finish)
        .await
        .expect("announce should succeed");

    let message = tokio::time::timeout(Duration::from_secs(5), messages.next())
        .await
        .expect("update should arrive within the timeout")
        .expect("pubsub stream should stay open");
    let payload: String = message.get_payload().unwrap();
    assert_eq!(payload, format!(r#"{{"action":"FINISH","id":"{uuid}"}}"#));

    clean_up(&store, uuid).await;
}

#[tokio::test]
async fn bumped_fence_rejects_announcements() {
    let Some(store) = test_store().await else {
        return;
    };
    let uuid = Uuid::new_v4();
    let claim = stub_claim(&store, uuid).await;

    let mut connection = store.connection.clone();
    let _: () = connection.hset(lease_key(uuid), "fence", 2).await.unwrap();

    assert_eq!(
        claim.announce(&ChallengeServerUpdate::Finish).await,
        Err(StoreError::Fenced),
    );

    clean_up(&store, uuid).await;
}

#[tokio::test]
async fn missing_fence_rejects_appends() {
    let Some(store) = test_store().await else {
        return;
    };
    let uuid = Uuid::new_v4();
    let claim = stub_claim(&store, uuid).await;

    let mut connection = store.connection.clone();
    let _: () = connection.del(lease_key(uuid)).await.unwrap();

    let batch = vec![entry(
        0,
        LifecycleEvent::StageStarted {
            stage: Stage::TobMaiden,
        },
    )];
    assert_eq!(claim.append(&batch).await, Err(StoreError::Fenced));
    assert_eq!(read_journal(&store, uuid).await, vec![]);

    clean_up(&store, uuid).await;
}

fn update_command() -> Command {
    Command::Update(Update {
        user_id: UserId(1),
        client_id: ClientId(10),
        session_token: "tok1".into(),
        mode: Some(ChallengeMode::TobRegular),
        stage: None,
        party: None,
    })
}

fn finish_command() -> Command {
    Command::Finish(Finish {
        user_id: UserId(1),
        client_id: ClientId(10),
        session_token: "tok1".into(),
        times: None,
        soft: false,
    })
}

/// Receives the next envelope from an inbox feed within a timeout.
async fn next_envelope(rx: &mut mpsc::Receiver<Envelope>) -> Envelope {
    tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("inbox entry should arrive within the timeout")
        .expect("inbox feed should stay open")
}

/// Registers `uuid` in the existence index so that sends to it land. The
/// lease deadline is set in the future so that concurrent claim sweeps from
/// other tests leave the challenge alone.
async fn register(store: &Store, uuid: Uuid) {
    let mut connection = store.connection.clone();
    let _: () = connection
        .zadd(LEASES_KEY, uuid.to_string(), lease_deadline())
        .await
        .unwrap();
}

/// Sends a command, expecting it to be queued.
async fn send(store: &Store, uuid: Uuid, cmd: &Command) -> MsgId {
    store
        .send(uuid, cmd)
        .await
        .expect("send should succeed")
        .expect("challenge should exist")
}

#[tokio::test]
async fn send_appends_commands_to_the_inbox() {
    let Some(store) = test_store().await else {
        return;
    };
    let uuid = Uuid::new_v4();
    register(&store, uuid).await;

    let update = update_command();
    let finish = finish_command();
    let first = send(&store, uuid, &update).await;
    let second = send(&store, uuid, &finish).await;
    assert!(first < second);

    assert_eq!(
        read_inbox(&store, uuid).await,
        vec![
            (first, vec![("cmd".to_string(), update)]),
            (second, vec![("cmd".to_string(), finish)]),
        ],
    );

    clean_up(&store, uuid).await;
}

#[tokio::test]
async fn follow_delivers_backlog_then_live_entries() {
    let Some(store) = test_store().await else {
        return;
    };
    let uuid = Uuid::new_v4();
    let claim = stub_claim(&store, uuid).await;
    register(&store, uuid).await;

    let update = update_command();
    let backlogged = send(&store, uuid, &update).await;

    let (tx, mut rx) = mpsc::channel(8);
    claim.follow(MsgId::default(), tx);
    assert_eq!(
        next_envelope(&mut rx).await,
        Envelope {
            id: backlogged,
            cmd: update,
        },
    );

    let finish = finish_command();
    let live = send(&store, uuid, &finish).await;
    assert_eq!(
        next_envelope(&mut rx).await,
        Envelope {
            id: live,
            cmd: finish,
        },
    );

    clean_up(&store, uuid).await;
}

#[tokio::test]
async fn follow_skips_entries_at_or_before_its_position() {
    let Some(store) = test_store().await else {
        return;
    };
    let uuid = Uuid::new_v4();
    let claim = stub_claim(&store, uuid).await;
    register(&store, uuid).await;

    let update = update_command();
    let finish = finish_command();
    let consumed = send(&store, uuid, &update).await;
    let pending = send(&store, uuid, &finish).await;

    let (tx, mut rx) = mpsc::channel(8);
    claim.follow(consumed, tx);
    assert_eq!(
        next_envelope(&mut rx).await,
        Envelope {
            id: pending,
            cmd: finish,
        },
    );

    clean_up(&store, uuid).await;
}

#[tokio::test]
async fn start_creates_and_claims_a_challenge_for_a_free_party() {
    let Some(store) = test_store().await else {
        return;
    };
    let client = test_client();
    let create = create_request(client);
    let party = party_of(&create);

    let start = store
        .start(create.clone())
        .await
        .expect("start should succeed");
    let Start::Created { claim, id } = start else {
        panic!("expected a creation");
    };
    let uuid = claim.uuid();

    let mut connection = store.connection.clone();
    let directory: String = connection.get(directory_key(&party)).await.unwrap();
    assert_eq!(directory, uuid.to_string());
    let routed: String = connection.get(client_key(client)).await.unwrap();
    assert_eq!(routed, uuid.to_string());

    // Each party member's player key points to the new challenge ID.
    for key in [
        format!("player:1ogp_{client}"),
        format!("player:wq_{client}"),
    ] {
        let active: String = connection.get(key).await.unwrap();
        assert_eq!(active, uuid.to_string());
    }

    // The challenge should have a lease deadline in the future, held by
    // this instance.
    let deadline: Option<u64> = connection
        .zscore(LEASES_KEY, uuid.to_string())
        .await
        .unwrap();
    let now = u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis(),
    )
    .expect("time fits in u64");
    assert!(deadline.expect("challenge should be indexed") > now);
    let owner: String = connection.hget(lease_key(uuid), "owner").await.unwrap();
    assert_eq!(owner, TEST_IDENTITY);

    assert_eq!(
        read_inbox(&store, uuid).await,
        vec![(id, vec![("cmd".to_string(), Command::Create(create))])],
    );

    // The returned claim holds the fence, so its writes land immediately.
    claim
        .project(&snapshot(uuid, 1), &[])
        .await
        .expect("claim should hold the fence");
    assert_eq!(store.read(uuid).await, Ok(Some(snapshot(uuid, 1))));

    clean_up_start(&store, &party, &[client], &[uuid]).await;
}

#[tokio::test]
async fn start_joins_a_live_incumbent() {
    let Some(store) = test_store().await else {
        return;
    };
    let creator_client = test_client();
    let creator = create_request(creator_client);
    let party = party_of(&creator);

    let Ok(Start::Created {
        claim,
        id: create_id,
    }) = store.start(creator.clone()).await
    else {
        panic!("expected a creation");
    };
    let uuid = claim.uuid();
    claim
        .project(&snapshot(uuid, 1), &[])
        .await
        .expect("project should succeed");

    let joiner_client = test_client();
    let joiner = Create {
        party: creator.party.clone(),
        ..create_request(joiner_client)
    };
    let start = store
        .start(joiner.clone())
        .await
        .expect("start should succeed");
    let Start::Joined {
        uuid: target,
        id: join_id,
    } = start
    else {
        panic!("expected a join");
    };
    assert_eq!(target, uuid);

    let mut connection = store.connection.clone();
    let directory: String = connection.get(directory_key(&party)).await.unwrap();
    assert_eq!(directory, uuid.to_string());
    let routed: String = connection.get(client_key(joiner_client)).await.unwrap();
    assert_eq!(routed, uuid.to_string());

    // The join leaves player keys alone; they still reference the first challenge.
    for name in &creator.party {
        let active: String = connection.get(player_key(name)).await.unwrap();
        assert_eq!(active, uuid.to_string());
    }

    // The join is queued behind the create in the incumbent's inbox.
    let expected_join = Join {
        user_id: joiner.user_id,
        client_id: joiner.client_id,
        session_token: joiner.session_token.clone(),
        plugin_version: joiner.plugin_version.clone(),
        runelite_version: joiner.runelite_version.clone(),
        recording_type: joiner.recording_type,
    };
    assert_eq!(
        read_inbox(&store, uuid).await,
        vec![
            (
                create_id,
                vec![("cmd".to_string(), Command::Create(creator))]
            ),
            (
                join_id,
                vec![("cmd".to_string(), Command::Join(expected_join))]
            ),
        ],
    );

    clean_up_start(&store, &party, &[creator_client, joiner_client], &[uuid]).await;
}

#[tokio::test]
async fn start_joins_an_incumbent_before_its_first_projection() {
    let Some(store) = test_store().await else {
        return;
    };
    let creator_client = test_client();
    let creator = create_request_at(creator_client, Stage::TobBloat);
    let party = party_of(&creator);

    let Ok(Start::Created { claim, .. }) = store.start(creator.clone()).await else {
        panic!("expected a creation");
    };

    let joiner_client = test_client();
    let joiner = Create {
        party: creator.party.clone(),
        ..create_request_at(joiner_client, Stage::TobBloat)
    };
    let start = store.start(joiner).await.expect("start should succeed");
    let Start::Joined { uuid, .. } = start else {
        panic!("expected a join");
    };
    assert_eq!(uuid, claim.uuid());

    clean_up_start(&store, &party, &[creator_client, joiner_client], &[uuid]).await;
}

#[tokio::test]
async fn start_at_an_earlier_stage_creates_a_new_challenge() {
    let Some(store) = test_store().await else {
        return;
    };
    let first_client = test_client();
    let creator = create_request(first_client);
    let party = party_of(&creator);

    let Ok(Start::Created {
        claim,
        id: create_id,
    }) = store.start(creator.clone()).await
    else {
        panic!("expected a creation");
    };
    let first = claim.uuid();
    let progressed = Snapshot {
        stage: Stage::TobVerzik,
        ..snapshot(first, 1)
    };
    claim
        .project(&progressed, &[])
        .await
        .expect("project should succeed");

    // The same players start again.
    let second_client = test_client();
    let restart = Create {
        party: creator.party.clone(),
        ..create_request_at(second_client, Stage::TobMaiden)
    };
    let start = store.start(restart).await.expect("start should succeed");
    let Start::Created {
        claim: successor, ..
    } = start
    else {
        panic!("expected a creation");
    };
    let second = successor.uuid();
    assert_ne!(second, first);

    let mut connection = store.connection.clone();
    let directory: String = connection.get(directory_key(&party)).await.unwrap();
    assert_eq!(directory, second.to_string());

    // The party's keys reference the new challenge.
    for name in &creator.party {
        let active: String = connection.get(player_key(name)).await.unwrap();
        assert_eq!(active, second.to_string());
    }

    // Nothing else was sent to the original challenge.
    assert_eq!(
        read_inbox(&store, first).await,
        vec![(
            create_id,
            vec![("cmd".to_string(), Command::Create(creator))]
        )],
    );

    clean_up_start(
        &store,
        &party,
        &[first_client, second_client],
        &[first, second],
    )
    .await;
}

#[tokio::test]
async fn start_joins_a_challenge_at_the_same_stage() {
    let Some(store) = test_store().await else {
        return;
    };
    let first_client = test_client();
    let creator = create_request(first_client);
    let party = party_of(&creator);

    let Ok(Start::Created { claim, .. }) = store.start(creator.clone()).await else {
        panic!("expected a creation");
    };
    let first = claim.uuid();
    let progressed = Snapshot {
        stage: Stage::TobVerzik,
        ..snapshot(first, 1)
    };
    claim
        .project(&progressed, &[])
        .await
        .expect("project should succeed");

    let joiner_client = test_client();
    let joiner = Create {
        party: creator.party.clone(),
        ..create_request_at(joiner_client, Stage::TobVerzik)
    };
    let start = store.start(joiner).await.expect("start should succeed");
    let Start::Joined { uuid, .. } = start else {
        panic!("expected a join");
    };
    assert_eq!(uuid, first);

    clean_up_start(&store, &party, &[first_client, joiner_client], &[first]).await;
}

#[tokio::test]
async fn start_joins_a_challenge_from_a_later_stage() {
    let Some(store) = test_store().await else {
        return;
    };
    let first_client = test_client();
    let creator = create_request(first_client);
    let party = party_of(&creator);

    let Ok(Start::Created { claim, .. }) = store.start(creator.clone()).await else {
        panic!("expected a creation");
    };
    let first = claim.uuid();
    claim
        .project(&snapshot(first, 1), &[])
        .await
        .expect("project should succeed");

    let joiner_client = test_client();
    let joiner = Create {
        party: creator.party.clone(),
        ..create_request_at(joiner_client, Stage::TobVerzik)
    };
    let start = store.start(joiner).await.expect("start should succeed");
    let Start::Joined { uuid, .. } = start else {
        panic!("expected a join");
    };
    assert_eq!(uuid, first);

    clean_up_start(&store, &party, &[first_client, joiner_client], &[first]).await;
}

#[tokio::test]
async fn start_supersedes_a_finished_incumbent() {
    let Some(store) = test_store().await else {
        return;
    };
    let first_client = test_client();
    let creator = create_request(first_client);
    let party = party_of(&creator);

    let Ok(Start::Created { claim, .. }) = store.start(creator.clone()).await else {
        panic!("expected a creation");
    };
    let first = claim.uuid();
    let terminated = Snapshot {
        phase: ChallengePhase::Terminated,
        status: ChallengeStatus::Wiped,
        ..snapshot(first, 2)
    };
    claim
        .project(&terminated, &[])
        .await
        .expect("project should succeed");

    let second_client = test_client();
    let restart = Create {
        party: creator.party.clone(),
        ..create_request(second_client)
    };
    let start = store.start(restart).await.expect("start should succeed");
    let Start::Created {
        claim: successor, ..
    } = start
    else {
        panic!("expected a creation");
    };
    let second = successor.uuid();
    assert_ne!(second, first);

    let mut connection = store.connection.clone();
    let directory: String = connection.get(directory_key(&party)).await.unwrap();
    assert_eq!(directory, second.to_string());
    // The finished challenge remains indexed until deletion.
    let remaining: Option<f64> = connection
        .zscore(LEASES_KEY, first.to_string())
        .await
        .unwrap();
    assert!(remaining.is_some());

    clean_up_start(
        &store,
        &party,
        &[first_client, second_client],
        &[first, second],
    )
    .await;
}

#[tokio::test]
async fn start_supersedes_a_finishing_incumbent() {
    let Some(store) = test_store().await else {
        return;
    };
    let first_client = test_client();
    let creator = create_request(first_client);
    let party = party_of(&creator);

    let Ok(Start::Created { claim, .. }) = store.start(creator.clone()).await else {
        panic!("expected a creation");
    };
    let first = claim.uuid();
    let finishing = Snapshot {
        phase: ChallengePhase::Finishing,
        ..snapshot(first, 2)
    };
    claim
        .project(&finishing, &[])
        .await
        .expect("project should succeed");

    let second_client = test_client();
    let restart = Create {
        party: creator.party.clone(),
        ..create_request(second_client)
    };
    let start = store.start(restart).await.expect("start should succeed");
    let Start::Created {
        claim: successor, ..
    } = start
    else {
        panic!("expected a creation");
    };
    assert_ne!(successor.uuid(), first);

    clean_up_start(
        &store,
        &party,
        &[first_client, second_client],
        &[first, successor.uuid()],
    )
    .await;
}

#[tokio::test]
async fn send_to_an_unknown_challenge_is_rejected() {
    let Some(store) = test_store().await else {
        return;
    };
    let uuid = Uuid::new_v4();

    assert_eq!(store.send(uuid, &update_command()).await, Ok(None));

    let mut connection = store.connection.clone();
    let exists: bool = connection.exists(inbox_key(uuid)).await.unwrap();
    assert!(!exists);
}

#[tokio::test]
async fn client_send_routes_to_the_current_challenge() {
    let Some(store) = test_store().await else {
        return;
    };
    let client = test_client();
    let create = create_request(client);
    let party = party_of(&create);

    let Ok(Start::Created {
        claim,
        id: create_id,
    }) = store.start(create.clone()).await
    else {
        panic!("expected a creation");
    };
    let uuid = claim.uuid();

    let update = update_command();
    let sent = store
        .send_to_current_challenge(client, &update)
        .await
        .expect("send should succeed")
        .expect("client should be in the challenge");
    assert_eq!(sent.0, uuid);
    assert_eq!(
        read_inbox(&store, uuid).await,
        vec![
            (
                create_id,
                vec![("cmd".to_string(), Command::Create(create))]
            ),
            (sent.1, vec![("cmd".to_string(), update)]),
        ],
    );

    clean_up_start(&store, &party, &[client], &[uuid]).await;
}

#[tokio::test]
async fn client_send_without_a_challenge_is_rejected() {
    let Some(store) = test_store().await else {
        return;
    };

    assert_eq!(
        store
            .send_to_current_challenge(test_client(), &update_command())
            .await,
        Ok(None),
    );
}

#[tokio::test]
async fn client_send_to_a_terminated_challenge_is_rejected() {
    let Some(store) = test_store().await else {
        return;
    };
    let client = test_client();
    let create = create_request(client);
    let party = party_of(&create);

    let Ok(Start::Created {
        claim,
        id: create_id,
    }) = store.start(create.clone()).await
    else {
        panic!("expected a creation");
    };
    let uuid = claim.uuid();
    let terminated = Snapshot {
        phase: ChallengePhase::Terminated,
        status: ChallengeStatus::Wiped,
        ..snapshot(uuid, 2)
    };
    claim
        .project(&terminated, &[])
        .await
        .expect("project should succeed");

    assert_eq!(
        store
            .send_to_current_challenge(client, &update_command())
            .await,
        Ok(None),
    );
    // Nothing was queued into the terminated challenge's inbox.
    assert_eq!(
        read_inbox(&store, uuid).await,
        vec![(
            create_id,
            vec![("cmd".to_string(), Command::Create(create))]
        )],
    );

    clean_up_start(&store, &party, &[client], &[uuid]).await;
}

fn join_request(client: ClientId) -> Join {
    Join {
        user_id: UserId(client.0),
        client_id: client,
        session_token: format!("tok{client}b").into(),
        plugin_version: "0.9.14".into(),
        runelite_version: "1.12.31.1".into(),
        recording_type: RecordingType::Participant,
    }
}

#[tokio::test]
async fn rejoin_routes_and_enqueues_for_a_live_challenge() {
    let Some(store) = test_store().await else {
        return;
    };
    let client = test_client();
    let create = create_request(client);
    let party = party_of(&create);

    let Ok(Start::Created {
        claim,
        id: create_id,
    }) = store.start(create.clone()).await
    else {
        panic!("expected a creation");
    };
    let uuid = claim.uuid();
    claim
        .project(&snapshot(uuid, 1), &[])
        .await
        .expect("project should succeed");

    let rejoin = join_request(client);
    let Ok(Rejoin::Queued(rejoin_id)) = store.rejoin(uuid, &rejoin).await else {
        panic!("expected a queued rejoin");
    };

    let late_client = test_client();
    let late = join_request(late_client);
    let Ok(Rejoin::Queued(late_id)) = store.rejoin(uuid, &late).await else {
        panic!("expected a queued rejoin");
    };

    let mut connection = store.connection.clone();
    let routed: String = connection.get(client_key(client)).await.unwrap();
    assert_eq!(routed, uuid.to_string());
    let routed: String = connection.get(client_key(late_client)).await.unwrap();
    assert_eq!(routed, uuid.to_string());

    assert_eq!(
        read_inbox(&store, uuid).await,
        vec![
            (
                create_id,
                vec![("cmd".to_string(), Command::Create(create))]
            ),
            (rejoin_id, vec![("cmd".to_string(), Command::Join(rejoin))]),
            (late_id, vec![("cmd".to_string(), Command::Join(late))]),
        ],
    );

    clean_up_start(&store, &party, &[client, late_client], &[uuid]).await;
}

#[tokio::test]
async fn rejoin_of_an_unknown_challenge_is_rejected() {
    let Some(store) = test_store().await else {
        return;
    };
    let client = test_client();
    let uuid = Uuid::new_v4();

    assert_eq!(
        store.rejoin(uuid, &join_request(client)).await,
        Ok(Rejoin::UnknownChallenge),
    );

    // Nothing was routed or queued.
    let mut connection = store.connection.clone();
    let routed: Option<String> = connection.get(client_key(client)).await.unwrap();
    assert_eq!(routed, None);
    assert_eq!(read_inbox(&store, uuid).await, vec![]);
}

#[tokio::test]
async fn rejoin_of_a_terminated_challenge_is_rejected() {
    let Some(store) = test_store().await else {
        return;
    };
    let client = test_client();
    let create = create_request(client);
    let party = party_of(&create);

    let Ok(Start::Created {
        claim,
        id: create_id,
    }) = store.start(create.clone()).await
    else {
        panic!("expected a creation");
    };
    let uuid = claim.uuid();
    let terminated = Snapshot {
        phase: ChallengePhase::Terminated,
        status: ChallengeStatus::Wiped,
        ..snapshot(uuid, 2)
    };
    claim
        .project(&terminated, &[])
        .await
        .expect("project should succeed");

    assert_eq!(
        store.rejoin(uuid, &join_request(client)).await,
        Ok(Rejoin::UnknownChallenge),
    );
    assert_eq!(
        read_inbox(&store, uuid).await,
        vec![(
            create_id,
            vec![("cmd".to_string(), Command::Create(create))]
        )],
    );

    clean_up_start(&store, &party, &[client], &[uuid]).await;
}

#[tokio::test]
async fn rejoin_while_routed_elsewhere_is_rejected() {
    let Some(store) = test_store().await else {
        return;
    };
    let client = test_client();
    let create = create_request(client);
    let party = party_of(&create);

    let Ok(Start::Created { claim, .. }) = store.start(create).await else {
        panic!("expected a creation");
    };
    let current_uuid = claim.uuid();

    let other_client = test_client();
    let other_create = create_request(other_client);
    let other_party = party_of(&other_create);
    let Ok(Start::Created {
        claim: other_claim,
        id: other_create_id,
    }) = store.start(other_create.clone()).await
    else {
        panic!("expected a creation");
    };
    let other_uuid = other_claim.uuid();

    assert_eq!(
        store.rejoin(other_uuid, &join_request(client)).await,
        Ok(Rejoin::AlreadyInChallenge),
    );

    // The client's routing is untouched and nothing reached the other inbox.
    let mut connection = store.connection.clone();
    let routed: String = connection.get(client_key(client)).await.unwrap();
    assert_eq!(routed, current_uuid.to_string());
    assert_eq!(
        read_inbox(&store, other_uuid).await,
        vec![(
            other_create_id,
            vec![("cmd".to_string(), Command::Create(other_create))]
        )],
    );

    clean_up_start(&store, &party, &[client], &[current_uuid]).await;
    clean_up_start(&store, &other_party, &[other_client], &[other_uuid]).await;
}

#[tokio::test]
async fn rejoin_before_first_projection_accepts() {
    let Some(store) = test_store().await else {
        return;
    };
    let client = test_client();
    let create = create_request(client);
    let party = party_of(&create);

    let Ok(Start::Created {
        claim,
        id: create_id,
    }) = store.start(create.clone()).await
    else {
        panic!("expected a creation");
    };
    let uuid = claim.uuid();

    let late_client = test_client();
    let late = join_request(late_client);
    let Ok(Rejoin::Queued(late_id)) = store.rejoin(uuid, &late).await else {
        panic!("expected a queued rejoin");
    };

    assert_eq!(
        read_inbox(&store, uuid).await,
        vec![
            (
                create_id,
                vec![("cmd".to_string(), Command::Create(create))]
            ),
            (late_id, vec![("cmd".to_string(), Command::Join(late))]),
        ],
    );

    clean_up_start(&store, &party, &[client, late_client], &[uuid]).await;
}

fn terminated_state(uuid: Uuid, create: &Create) -> ChallengeState {
    ChallengeState {
        uuid,
        challenge_type: create.challenge_type,
        mode: create.mode,
        party: create.party.clone(),
        phase: PhaseState::Terminated {
            status: ChallengeStatus::Wiped,
        },
        recorded_by: [create.client_id].into(),
        ..ChallengeState::default()
    }
}

#[tokio::test]
#[allow(clippy::too_many_lines)]
async fn delete_removes_a_terminated_challenges_state() {
    let Some(store) = test_store().await else {
        return;
    };
    let client = test_client();
    let create = create_request(client);
    let party = party_of(&create);

    let Ok(Start::Created { claim, .. }) = store.start(create.clone()).await else {
        panic!("expected a creation");
    };
    let uuid = claim.uuid();
    claim
        .append(&[entry(
            0,
            LifecycleEvent::StageStarted {
                stage: Stage::TobMaiden,
            },
        )])
        .await
        .expect("append should succeed");
    claim
        .project(&snapshot(uuid, 1), &[])
        .await
        .expect("project should succeed");

    // Fake stage stream keys.
    let mut connection = store.connection.clone();
    let streams = [
        format!("test-events:{uuid}:410"),
        format!("test-events:{uuid}:420"),
    ];
    for stream in &streams {
        let _: () = connection.set(stream, "events").await.unwrap();
        let _: () = connection
            .sadd(streams_set_key(uuid), stream)
            .await
            .unwrap();
    }

    let mut pubsub = test_pubsub(SIGNAL_CHANNEL).await;
    let mut messages = pubsub.on_message();

    claim
        .delete(&terminated_state(uuid, &create))
        .await
        .expect("delete should succeed");

    // Routing, stage streams, index entry, and lease are gone.
    for key in [
        directory_key(&party),
        client_key(client),
        player_key(&create.party[0]),
        player_key(&create.party[1]),
        streams[0].clone(),
        streams[1].clone(),
        streams_set_key(uuid),
        lease_key(uuid),
    ] {
        let exists: bool = connection.exists(&key).await.unwrap();
        assert!(!exists, "key should be deleted: {key}");
    }
    let indexed: Option<f64> = connection
        .zscore(LEASES_KEY, uuid.to_string())
        .await
        .unwrap();
    assert_eq!(indexed, None);

    // The journal, inbox, and state hash survive with their contents, but
    // expire, the state hash sooner.
    let stream_retention = i64::try_from(DELETED_STREAM_RETENTION.as_millis()).unwrap();
    let state_retention = i64::try_from(DELETED_STATE_RETENTION.as_millis()).unwrap();
    for (key, retention) in [
        (journal_key(uuid), stream_retention),
        (inbox_key(uuid), stream_retention),
        (challenge_key(uuid), state_retention),
    ] {
        let ttl: i64 = redis::cmd("PTTL")
            .arg(&key)
            .query_async(&mut connection)
            .await
            .unwrap();
        assert!(
            ttl > 0 && ttl <= retention,
            "{key} should expire, has ttl {ttl}",
        );
    }
    assert_eq!(read_journal(&store, uuid).await.len(), 1);
    assert_eq!(read_inbox(&store, uuid).await.len(), 1);

    // The deletion is signaled.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let message = tokio::time::timeout_at(deadline, messages.next())
            .await
            .expect("signal should arrive within the timeout")
            .expect("pubsub stream should stay open");
        let payload: String = message.get_payload().unwrap();
        let signal: ChallengeSignal = serde_json::from_str(&payload).unwrap();
        if signal == (ChallengeSignal::Deleted { uuid }) {
            break;
        }
    }

    clean_up_start(&store, &party, &[client], &[uuid]).await;
}

#[tokio::test]
async fn delete_leaves_repointed_routing_keys_alone() {
    let Some(store) = test_store().await else {
        return;
    };
    let client = test_client();
    let create = create_request(client);
    let party = party_of(&create);

    let Ok(Start::Created { claim, .. }) = store.start(create.clone()).await else {
        panic!("expected a creation");
    };
    let uuid = claim.uuid();

    // A new challenge overwrote every routing key, which should be kept.
    let successor = Uuid::new_v4();
    let mut connection = store.connection.clone();
    let routing = [
        directory_key(&party),
        client_key(client),
        player_key(&create.party[0]),
        player_key(&create.party[1]),
    ];
    for key in &routing {
        let _: () = connection.set(key, successor.to_string()).await.unwrap();
    }

    claim
        .delete(&terminated_state(uuid, &create))
        .await
        .expect("delete should succeed");

    for key in &routing {
        let value: String = connection.get(key).await.unwrap();
        assert_eq!(value, successor.to_string(), "routing key: {key}");
    }
    let indexed: Option<f64> = connection
        .zscore(LEASES_KEY, uuid.to_string())
        .await
        .unwrap();
    assert_eq!(indexed, None);
    let lease: bool = connection.exists(lease_key(uuid)).await.unwrap();
    assert!(!lease);

    clean_up_start(&store, &party, &[client], &[uuid]).await;
}

#[tokio::test]
async fn bumped_fence_rejects_deletion() {
    let Some(store) = test_store().await else {
        return;
    };
    let client = test_client();
    let create = create_request(client);
    let party = party_of(&create);

    let Ok(Start::Created { claim, .. }) = store.start(create.clone()).await else {
        panic!("expected a creation");
    };
    let uuid = claim.uuid();
    claim
        .project(&snapshot(uuid, 1), &[])
        .await
        .expect("project should succeed");

    let mut connection = store.connection.clone();
    let _: () = connection.hset(lease_key(uuid), "fence", 2).await.unwrap();

    assert_eq!(
        claim.delete(&terminated_state(uuid, &create)).await,
        Err(StoreError::Fenced),
    );

    // Everything survives, and nothing was scheduled to expire.
    for key in [
        challenge_key(uuid),
        directory_key(&party),
        client_key(client),
        player_key(&create.party[0]),
        player_key(&create.party[1]),
    ] {
        let exists: bool = connection.exists(&key).await.unwrap();
        assert!(exists, "key should survive: {key}");
    }
    let indexed: Option<f64> = connection
        .zscore(LEASES_KEY, uuid.to_string())
        .await
        .unwrap();
    assert!(indexed.is_some());
    let inbox_ttl: i64 = redis::cmd("PTTL")
        .arg(inbox_key(uuid))
        .query_async(&mut connection)
        .await
        .unwrap();
    assert_eq!(inbox_ttl, -1);

    clean_up_start(&store, &party, &[client], &[uuid]).await;
}

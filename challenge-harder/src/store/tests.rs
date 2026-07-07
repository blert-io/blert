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
use crate::lifecycle::core::state::ChallengePhase;
use crate::lifecycle::core::types::{
    ChallengeMode, ChallengeStatus, ChallengeType, ClientId, JournalSeq, MsgId, RecordingType,
    Stage, Timestamp, UserId,
};

/// Returns a unique client ID on every call. Tests share a Redis instance and
/// run in parallel, so this avoids key collisions.
fn test_client() -> ClientId {
    static NEXT_CLIENT: AtomicI64 = AtomicI64::new(7_000);
    ClientId(NEXT_CLIENT.fetch_add(1, Ordering::Relaxed))
}

/// Returns a party name unique to the calling test, for the same reason.
fn test_party() -> String {
    format!("test-{}", Uuid::new_v4())
}

/// Unique party names for commands sent by `client` to avoid Redis collisions.
fn test_party_members(client: ClientId) -> Vec<String> {
    vec![format!("1Ogp {client}"), format!("WQ {client}")]
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

static TEST_DB_FLUSHED: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();

async fn test_store() -> Option<Store> {
    let Ok(uri) = std::env::var("BLERT_TEST_REDIS_URI") else {
        eprintln!("BLERT_TEST_REDIS_URI is not set; skipping Redis tests");
        return None;
    };
    let store = Store::connect(&uri).await.expect("test redis unreachable");

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
async fn claim_establishes_fence_and_appends_land() {
    let Some(store) = test_store().await else {
        return;
    };
    let uuid = Uuid::new_v4();
    let claim = store.claim(uuid).await.expect("claim should succeed");

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

    let mut connection = store.connection.clone();
    let fence: String = connection.hget(lease_key(uuid), "fence").await.unwrap();
    assert_eq!(fence, "1");
    assert_eq!(
        read_journal(&store, uuid).await,
        vec![("1".into(), first), ("1".into(), second)],
    );

    clean_up(&store, uuid).await;
}

#[tokio::test]
async fn bumped_fence_rejects_stale_epoch() {
    let Some(store) = test_store().await else {
        return;
    };
    let uuid = Uuid::new_v4();
    let claim = store.claim(uuid).await.expect("claim should succeed");

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

    let reclaim = store.claim(uuid).await;
    assert!(matches!(reclaim, Err(StoreError::Fenced)));

    clean_up(&store, uuid).await;
}

#[tokio::test]
async fn projection_writes_hash_and_signals() {
    let Some(store) = test_store().await else {
        return;
    };
    let uuid = Uuid::new_v4();
    assert_eq!(store.read(uuid).await, Ok(None));
    let claim = store.claim(uuid).await.expect("claim should succeed");

    let mut pubsub = test_pubsub(SIGNAL_CHANNEL).await;
    let mut messages = pubsub.on_message();

    claim
        .project(&snapshot(uuid, 4))
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
        ("stageAttempt", ""),
        ("party", "1Ogp,WWWWWWWWWWQQ"),
        ("phase", "ACTIVE"),
        ("cursor", "0-4"),
    ]
    .into_iter()
    .map(|(field, value)| (field.to_string(), value.to_string()))
    .collect();
    assert_eq!(hash, expected);

    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    let signal = loop {
        let message = tokio::time::timeout_at(deadline, messages.next())
            .await
            .expect("signal should arrive within the timeout")
            .expect("pubsub stream should stay open");
        let payload: String = message.get_payload().unwrap();
        let signal: Signal = serde_json::from_str(&payload).unwrap();
        if signal.uuid == uuid {
            break signal;
        }
    };
    assert_eq!(signal.cursor, MsgId::sequence(4));

    // A later projection overwrites the previous snapshot.
    let updated = Snapshot {
        stage_attempt: Some(3),
        ..snapshot(uuid, 5)
    };
    claim
        .project(&updated)
        .await
        .expect("project should succeed");
    let hash: BTreeMap<String, String> = connection.hgetall(challenge_key(uuid)).await.unwrap();
    assert_eq!(hash["stageAttempt"], "3");
    assert_eq!(hash["cursor"], "0-5");
    assert_eq!(store.read(uuid).await, Ok(Some(updated)));

    clean_up(&store, uuid).await;
}

#[tokio::test]
async fn subscriber_delivers_update_signals() {
    let Some(store) = test_store().await else {
        return;
    };
    let uuid = Uuid::new_v4();
    let claim = store.claim(uuid).await.expect("claim should succeed");

    let (tx, mut rx) = mpsc::channel(16);

    store.subscribe(tx);

    // The subscription races the first projections; keep projecting until
    // one of this challenge's signals comes through.
    let mut cursor = 0;
    let received = 'projecting: loop {
        cursor += 1;
        assert!(cursor < 10, "no signal after {cursor} projections");
        claim
            .project(&snapshot(uuid, cursor))
            .await
            .expect("project should succeed");
        let deadline = tokio::time::Instant::now() + Duration::from_millis(250);
        loop {
            match tokio::time::timeout_at(deadline, rx.recv()).await {
                Ok(Some((id, cursor))) if id == uuid => break 'projecting cursor,
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
    let claim = store.claim(uuid).await.expect("claim should succeed");

    let mut connection = store.connection.clone();
    let _: () = connection.hset(lease_key(uuid), "fence", 2).await.unwrap();

    assert_eq!(
        claim.project(&snapshot(uuid, 1)).await,
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
    let claim = store.claim(uuid).await.expect("claim should succeed");

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
    let claim = store.claim(uuid).await.expect("claim should succeed");

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
    let claim = store.claim(uuid).await.expect("claim should succeed");

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

/// Registers `uuid` in the existence index so that sends to it land.
async fn register(store: &Store, uuid: Uuid) {
    let mut connection = store.connection.clone();
    let _: () = connection
        .zadd(LEASES_KEY, uuid.to_string(), 0)
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
    let claim = store.claim(uuid).await.expect("claim should succeed");
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
    let claim = store.claim(uuid).await.expect("claim should succeed");
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
    let party = test_party();
    let client = test_client();
    let create = create_request(client);

    let start = store
        .start(&party, create.clone())
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

    // The challenge should have a lease deadline in the future.
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

    assert_eq!(
        read_inbox(&store, uuid).await,
        vec![(id, vec![("cmd".to_string(), Command::Create(create))])],
    );

    // The returned claim holds the fence, so its writes land immediately.
    claim
        .project(&snapshot(uuid, 1))
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
    let party = test_party();
    let creator_client = test_client();
    let creator = create_request(creator_client);

    let Ok(Start::Created {
        claim,
        id: create_id,
    }) = store.start(&party, creator.clone()).await
    else {
        panic!("expected a creation");
    };
    let uuid = claim.uuid();
    claim
        .project(&snapshot(uuid, 1))
        .await
        .expect("project should succeed");

    let joiner_client = test_client();
    let joiner = create_request(joiner_client);
    let start = store
        .start(&party, joiner.clone())
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

    // The join leaves player keys alone.
    for name in &joiner.party {
        let active: Option<String> = connection.get(player_key(name)).await.unwrap();
        assert_eq!(active, None);
    }
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
    let party = test_party();
    let creator_client = test_client();

    let Ok(Start::Created { claim, .. }) = store
        .start(&party, create_request_at(creator_client, Stage::TobBloat))
        .await
    else {
        panic!("expected a creation");
    };

    let joiner_client = test_client();
    let start = store
        .start(&party, create_request_at(joiner_client, Stage::TobBloat))
        .await
        .expect("start should succeed");
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
    let party = test_party();
    let first_client = test_client();
    let creator = create_request(first_client);

    let Ok(Start::Created {
        claim,
        id: create_id,
    }) = store.start(&party, creator.clone()).await
    else {
        panic!("expected a creation");
    };
    let first = claim.uuid();
    let progressed = Snapshot {
        stage: Stage::TobVerzik,
        ..snapshot(first, 1)
    };
    claim
        .project(&progressed)
        .await
        .expect("project should succeed");

    // The same players start again.
    let second_client = test_client();
    let restart = Create {
        party: creator.party.clone(),
        ..create_request_at(second_client, Stage::TobMaiden)
    };
    let start = store
        .start(&party, restart)
        .await
        .expect("start should succeed");
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
    let party = test_party();
    let first_client = test_client();

    let Ok(Start::Created { claim, .. }) = store.start(&party, create_request(first_client)).await
    else {
        panic!("expected a creation");
    };
    let first = claim.uuid();
    let progressed = Snapshot {
        stage: Stage::TobVerzik,
        ..snapshot(first, 1)
    };
    claim
        .project(&progressed)
        .await
        .expect("project should succeed");

    let joiner_client = test_client();
    let start = store
        .start(&party, create_request_at(joiner_client, Stage::TobVerzik))
        .await
        .expect("start should succeed");
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
    let party = test_party();
    let first_client = test_client();

    let Ok(Start::Created { claim, .. }) = store.start(&party, create_request(first_client)).await
    else {
        panic!("expected a creation");
    };
    let first = claim.uuid();
    claim
        .project(&snapshot(first, 1))
        .await
        .expect("project should succeed");

    let joiner_client = test_client();
    let start = store
        .start(&party, create_request_at(joiner_client, Stage::TobVerzik))
        .await
        .expect("start should succeed");
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
    let party = test_party();
    let first_client = test_client();

    let Ok(Start::Created { claim, .. }) = store.start(&party, create_request(first_client)).await
    else {
        panic!("expected a creation");
    };
    let first = claim.uuid();
    let terminated = Snapshot {
        phase: ChallengePhase::Terminated,
        status: ChallengeStatus::Wiped,
        ..snapshot(first, 2)
    };
    claim
        .project(&terminated)
        .await
        .expect("project should succeed");

    let second_client = test_client();
    let start = store
        .start(&party, create_request(second_client))
        .await
        .expect("start should succeed");
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
    // The finished challenge remains indexed until finalization.
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
    let party = test_party();
    let first_client = test_client();

    let Ok(Start::Created { claim, .. }) = store.start(&party, create_request(first_client)).await
    else {
        panic!("expected a creation");
    };
    let first = claim.uuid();
    let finishing = Snapshot {
        phase: ChallengePhase::Finishing,
        ..snapshot(first, 2)
    };
    claim
        .project(&finishing)
        .await
        .expect("project should succeed");

    let second_client = test_client();
    let start = store
        .start(&party, create_request(second_client))
        .await
        .expect("start should succeed");
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
    let party = test_party();
    let client = test_client();
    let create = create_request(client);

    let Ok(Start::Created {
        claim,
        id: create_id,
    }) = store.start(&party, create.clone()).await
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
    let party = test_party();
    let client = test_client();
    let create = create_request(client);

    let Ok(Start::Created {
        claim,
        id: create_id,
    }) = store.start(&party, create.clone()).await
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
        .project(&terminated)
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

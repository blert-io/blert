//! Redis storage layer.

use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Duration;

use futures_util::StreamExt;
use redis::Script;
use redis::aio::ConnectionManager;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use crate::lifecycle::challenge::{
    ChallengeClaim, ChallengeServerUpdate, ChallengeStore, ClaimFuture, ReadFuture, StoreError,
    WriteFuture,
};
use crate::lifecycle::core::event::JournalEntry;
use crate::lifecycle::core::state::{ChallengePhase, Snapshot};
use crate::lifecycle::core::types::{ChallengeMode, ChallengeType, Epoch, MsgId, Stage, Uuid};

/// Private channel carrying challenge state update signals.
const SIGNAL_CHANNEL: &str = "2c2s:challenge-signal";

/// Delay before retrying a failed signal subscription.
const RESUBSCRIBE_DELAY: Duration = Duration::from_secs(1);

/// Channel for public challenge lifecycle broadcasts.
const CHALLENGE_UPDATES_CHANNEL: &str = "challenge-updates";

fn journal_key(uuid: Uuid) -> String {
    format!("2c2s:journal:{uuid}")
}

fn lease_key(uuid: Uuid) -> String {
    format!("2c2s:lease:{uuid}")
}

/// The challenge's projected state.
fn challenge_key(uuid: Uuid) -> String {
    // Matches `challengesKey` in `//common/db/redis.ts`.
    format!("challenge:{uuid}")
}

/// Payload published on the signal pubsub channel after each projection write.
#[derive(Debug, Serialize, Deserialize)]
struct Signal {
    uuid: Uuid,
    cursor: MsgId,
}

/// Claims a challenge's fence for an epoch. The fence may be newly
/// established or already held at the same epoch.
///
/// `KEYS[1]` = Challenge's lease hash
/// `ARGV[1]` = Lease epoch
// TODO(frolv): Extend to full lease claims (owner, deadline, epoch bumps)
// when reclamation lands.
static CLAIM_SCRIPT: LazyLock<Script> = LazyLock::new(|| {
    Script::new(
        r"
        redis.call('HSETNX', KEYS[1], 'fence', ARGV[1])
        if redis.call('HGET', KEYS[1], 'fence') == ARGV[1] then
            return 1
        end
        return 0
        ",
    )
});

/// Appends a batch of journal entries as a single stream entry, provided the
/// appender's epoch still holds the challenge's fence.
///
/// `KEYS[1]` = Challenge's lease hash
/// `KEYS[2]` = Challenge's journal stream
///
/// `ARGV[1]` = Lease epoch
/// `ARGV[2]` = Serialized journal entries.
static APPEND_SCRIPT: LazyLock<Script> = LazyLock::new(|| {
    Script::new(
        r"
        if redis.call('HGET', KEYS[1], 'fence') ~= ARGV[1] then
            return 0
        end
        redis.call('XADD', KEYS[2], '*', 'epoch', ARGV[1], 'batch', ARGV[2])
        return 1
        ",
    )
});

/// Writes the challenge's state hash and signals the update, provided
/// the writer's epoch still holds the challenge's fence.
///
/// `KEYS[1]` = Challenge's state hash
/// `KEYS[2]` = Challenge's lease hash
///
/// `ARGV[1]` = Lease epoch
/// `ARGV[2]` = Serialized update signal
///
/// `ARGV[N, N+1]...` = Key-value pairs to set in the state hash.
static PROJECT_SCRIPT: LazyLock<Script> = LazyLock::new(|| {
    Script::new(&format!(
        r"
        if redis.call('HGET', KEYS[2], 'fence') ~= ARGV[1] then
            return 0
        end
        redis.call('HSET', KEYS[1], unpack(ARGV, 3))
        redis.call('PUBLISH', '{SIGNAL_CHANNEL}', ARGV[2])
        return 1
        ",
    ))
});

/// Broadcasts a challenge lifecycle update to the updates pubsub channel,
/// provided the writer's epoch still holds the challenge's fence.
///
/// `KEYS[1]` = Challenge's lease hash
///
/// `ARGV[1]` = Lease epoch
/// `ARGV[2]` = Serialized challenge update
static ANNOUNCE_SCRIPT: LazyLock<Script> = LazyLock::new(|| {
    Script::new(&format!(
        r"
        if redis.call('HGET', KEYS[1], 'fence') ~= ARGV[1] then
            return 0
        end
        redis.call('PUBLISH', '{CHALLENGE_UPDATES_CHANNEL}', ARGV[2])
        return 1
        ",
    ))
});

/// A `challenge-updates` message, matching `ChallengeServerUpdate` in
/// `//common/db/redis.ts`.
#[derive(Serialize)]
#[serde(tag = "action")]
enum UpdateMessage {
    #[serde(rename = "FINISH")]
    Finish { id: Uuid },
}

/// Cloneable handle to the Redis storage layer.
#[derive(Clone)]
pub struct Store {
    client: redis::Client,
    connection: ConnectionManager,
}

impl Store {
    /// Connects to the Redis instance at `uri`.
    pub async fn connect(uri: &str) -> redis::RedisResult<Self> {
        let client = redis::Client::open(uri)?;
        let connection = client.get_connection_manager().await?;
        Ok(Store { client, connection })
    }
}

/// Parses a challenge's projected state hash back into a snapshot.
fn parse_snapshot(uuid: Uuid, hash: &HashMap<String, String>) -> Result<Snapshot, String> {
    fn field<'a>(hash: &'a HashMap<String, String>, name: &str) -> Result<&'a str, String> {
        hash.get(name)
            .map(String::as_str)
            .ok_or_else(|| format!("missing field {name}"))
    }

    fn int(hash: &HashMap<String, String>, name: &str) -> Result<i32, String> {
        field(hash, name)?
            .parse()
            .map_err(|e| format!("invalid {name}: {e}"))
    }

    let attempt = field(hash, "stageAttempt")?;
    let party = field(hash, "party")?;
    let phase: ChallengePhase =
        serde_json::from_str(field(hash, "phase")?).map_err(|e| format!("invalid phase: {e}"))?;

    Ok(Snapshot {
        uuid,
        challenge_type: ChallengeType::try_from(int(hash, "type")?)
            .map_err(|e| format!("invalid type: {e}"))?,
        mode: ChallengeMode::try_from(int(hash, "mode")?)
            .map_err(|e| format!("invalid mode: {e}"))?,
        stage: Stage::try_from(int(hash, "stage")?).map_err(|e| format!("invalid stage: {e}"))?,
        stage_attempt: if attempt.is_empty() {
            None
        } else {
            Some(
                attempt
                    .parse()
                    .map_err(|e| format!("invalid stageAttempt: {e}"))?,
            )
        },
        party: if party.is_empty() {
            Vec::new()
        } else {
            party.split(',').map(String::from).collect()
        },
        phase,
        cursor: MsgId(
            field(hash, "cursor")?
                .parse()
                .map_err(|e| format!("invalid cursor: {e}"))?,
        ),
    })
}

impl ChallengeStore for Store {
    fn claim(&self, uuid: Uuid) -> ClaimFuture<'_> {
        Box::pin(async move {
            let epoch = Epoch::INITIAL;
            let mut connection = self.connection.clone();

            let mut invocation = CLAIM_SCRIPT.prepare_invoke();
            invocation.key(lease_key(uuid)).arg(epoch.0);
            let claimed: i64 = invocation
                .invoke_async(&mut connection)
                .await
                .map_err(|e| StoreError::Unavailable(e.to_string()))?;
            if claimed == 0 {
                return Err(StoreError::Fenced);
            }

            Ok(Box::new(RedisClaim {
                uuid,
                journal_key: journal_key(uuid),
                lease_key: lease_key(uuid),
                challenge_key: challenge_key(uuid),
                epoch,
                connection: self.connection.clone(),
            }) as Box<dyn ChallengeClaim>)
        })
    }

    fn read(&self, uuid: Uuid) -> ReadFuture<'_> {
        Box::pin(async move {
            let mut connection = self.connection.clone();
            let hash: HashMap<String, String> =
                redis::AsyncCommands::hgetall(&mut connection, challenge_key(uuid))
                    .await
                    .map_err(|e| StoreError::Unavailable(e.to_string()))?;
            if hash.is_empty() {
                return Ok(None);
            }
            parse_snapshot(uuid, &hash)
                .map(Some)
                .map_err(StoreError::Unavailable)
        })
    }

    fn subscribe(&self, sink: mpsc::Sender<(Uuid, MsgId)>) {
        let client = self.client.clone();

        tokio::spawn(async move {
            while !sink.is_closed() {
                let mut pubsub = match client.get_async_pubsub().await {
                    Ok(pubsub) => pubsub,
                    Err(error) => {
                        tracing::warn!(%error, "signal_subscribe_failed");
                        tokio::time::sleep(RESUBSCRIBE_DELAY).await;
                        continue;
                    }
                };

                if let Err(error) = pubsub.subscribe(SIGNAL_CHANNEL).await {
                    tracing::warn!(%error, "signal_subscribe_failed");
                    tokio::time::sleep(RESUBSCRIBE_DELAY).await;
                    continue;
                }

                let mut messages = pubsub.on_message();
                while let Some(message) = messages.next().await {
                    let Ok(payload) = message.get_payload::<String>() else {
                        continue;
                    };
                    match serde_json::from_str::<Signal>(&payload) {
                        Ok(signal) => {
                            if sink.send((signal.uuid, signal.cursor)).await.is_err() {
                                return;
                            }
                        }
                        Err(error) => tracing::warn!(%error, "signal_parse_failed"),
                    }
                }

                // The connection dropped; missed signals are recovered by
                // subscribers' direct reads.
                tracing::warn!("signal_stream_ended");
                tokio::time::sleep(RESUBSCRIBE_DELAY).await;
            }
        });
    }
}

/// An exclusive handle to a challenge's Redis state.
struct RedisClaim {
    uuid: Uuid,
    journal_key: String,
    lease_key: String,
    challenge_key: String,
    epoch: Epoch,
    connection: ConnectionManager,
}

impl ChallengeClaim for RedisClaim {
    fn append<'a>(&'a self, batch: &'a [JournalEntry]) -> WriteFuture<'a> {
        Box::pin(async move {
            let payload = serde_json::to_string(batch).expect("journal entries serialize");
            let mut connection = self.connection.clone();

            let mut invocation = APPEND_SCRIPT.prepare_invoke();
            invocation
                .key(&self.lease_key)
                .key(&self.journal_key)
                .arg(self.epoch.0)
                .arg(payload);

            let accepted: i64 = invocation
                .invoke_async(&mut connection)
                .await
                .map_err(|e| StoreError::Unavailable(e.to_string()))?;
            if accepted == 1 {
                Ok(())
            } else {
                Err(StoreError::Fenced)
            }
        })
    }

    fn project<'a>(&'a self, snapshot: &'a Snapshot) -> WriteFuture<'a> {
        Box::pin(async move {
            let signal = serde_json::to_string(&Signal {
                uuid: snapshot.uuid,
                cursor: snapshot.cursor,
            })
            .expect("signal serializes");
            let phase = serde_json::to_string(&snapshot.phase).expect("phase serializes");
            // The hash contract encodes a null stageAttempt as an empty string.
            let attempt = snapshot
                .stage_attempt
                .map_or_else(String::new, |attempt| attempt.to_string());
            let mut connection = self.connection.clone();

            let mut invocation = PROJECT_SCRIPT.prepare_invoke();
            invocation
                .key(&self.challenge_key)
                .key(&self.lease_key)
                .arg(self.epoch.0)
                .arg(signal)
                .arg("type")
                .arg(snapshot.challenge_type as i32)
                .arg("mode")
                .arg(snapshot.mode as i32)
                .arg("status")
                .arg(snapshot.status() as u8)
                .arg("stage")
                .arg(snapshot.stage as i32)
                .arg("stageAttempt")
                .arg(attempt)
                .arg("party")
                .arg(snapshot.party.join(","))
                .arg("phase")
                .arg(phase)
                .arg("cursor")
                .arg(snapshot.cursor.0);

            let accepted: i64 = invocation
                .invoke_async(&mut connection)
                .await
                .map_err(|e| StoreError::Unavailable(e.to_string()))?;
            if accepted == 1 {
                Ok(())
            } else {
                Err(StoreError::Fenced)
            }
        })
    }

    fn announce<'a>(&'a self, update: &'a ChallengeServerUpdate) -> WriteFuture<'a> {
        Box::pin(async move {
            let message = match update {
                ChallengeServerUpdate::Finish => UpdateMessage::Finish { id: self.uuid },
            };
            let payload = serde_json::to_string(&message).expect("update serializes");
            let mut connection = self.connection.clone();

            let mut invocation = ANNOUNCE_SCRIPT.prepare_invoke();
            invocation
                .key(&self.lease_key)
                .arg(self.epoch.0)
                .arg(payload);

            let accepted: i64 = invocation
                .invoke_async(&mut connection)
                .await
                .map_err(|e| StoreError::Unavailable(e.to_string()))?;
            if accepted == 1 {
                Ok(())
            } else {
                Err(StoreError::Fenced)
            }
        })
    }
}

/// Integration tests against the Redis instance at `BLERT_TEST_REDIS_URI`,
/// skipped when it is unset.
#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::time::Duration;

    use futures_util::StreamExt;
    use redis::AsyncCommands;

    use super::*;
    use crate::lifecycle::core::event::{Cause, LifecycleEvent};
    use crate::lifecycle::core::state::ChallengePhase;
    use crate::lifecycle::core::types::{
        ChallengeMode, ChallengeType, JournalSeq, MsgId, Stage, Timestamp,
    };

    async fn test_store() -> Option<Store> {
        let Ok(uri) = std::env::var("BLERT_TEST_REDIS_URI") else {
            eprintln!("BLERT_TEST_REDIS_URI is not set; skipping Redis tests");
            return None;
        };
        Some(Store::connect(&uri).await.expect("test redis unreachable"))
    }

    /// A dedicated connection to the test Redis, subscribed to `channel`.
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
            caused_by: Cause::Command(MsgId(1)),
            event,
        }
    }

    /// Reads a full journal stream as `(epoch, batch)` pairs, with each
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

    async fn cleanup(store: &Store, uuid: Uuid) {
        let mut connection = store.connection.clone();
        let _: () = connection
            .del(&[journal_key(uuid), lease_key(uuid), challenge_key(uuid)][..])
            .await
            .unwrap();
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
            cursor: MsgId(cursor),
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

        cleanup(&store, uuid).await;
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

        cleanup(&store, uuid).await;
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
            ("phase", "\"Active\""),
            ("cursor", "4"),
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
        assert_eq!(signal.cursor, MsgId(4));

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
        assert_eq!(hash["cursor"], "5");
        assert_eq!(store.read(uuid).await, Ok(Some(updated)));

        cleanup(&store, uuid).await;
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
        assert!(received >= MsgId(1) && received <= MsgId(cursor));

        cleanup(&store, uuid).await;
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

        cleanup(&store, uuid).await;
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

        cleanup(&store, uuid).await;
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

        cleanup(&store, uuid).await;
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

        cleanup(&store, uuid).await;
    }
}

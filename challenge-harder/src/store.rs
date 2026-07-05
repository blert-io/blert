//! Redis storage layer.

use std::sync::LazyLock;

use redis::Script;
use redis::aio::ConnectionManager;

use crate::lifecycle::challenge::{
    AppendFuture, ChallengeClaim, ChallengeStore, ClaimFuture, StoreError,
};
use crate::lifecycle::core::event::JournalEntry;
use crate::lifecycle::core::types::{Epoch, Uuid};

fn journal_key(uuid: Uuid) -> String {
    format!("journal:{uuid}")
}

fn lease_key(uuid: Uuid) -> String {
    format!("lease:{uuid}")
}

/// Claims a challenge's fence for an epoch. The fence may be newly
/// established or already held at the same epoch.
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
static APPEND_SCRIPT: LazyLock<Script> = LazyLock::new(|| {
    Script::new(
        r"
        if redis.call('HGET', KEYS[2], 'fence') ~= ARGV[1] then
            return 0
        end
        redis.call('XADD', KEYS[1], '*', 'epoch', ARGV[1], 'batch', ARGV[2])
        return 1
        ",
    )
});

/// Cloneable handle to the Redis storage layer.
#[derive(Clone)]
pub struct Store {
    connection: ConnectionManager,
}

impl Store {
    /// Connects to the Redis instance at `uri`.
    pub async fn connect(uri: &str) -> redis::RedisResult<Self> {
        let client = redis::Client::open(uri)?;
        let connection = client.get_connection_manager().await?;
        Ok(Store { connection })
    }
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
                journal_key: journal_key(uuid),
                lease_key: lease_key(uuid),
                epoch,
                connection: self.connection.clone(),
            }) as Box<dyn ChallengeClaim>)
        })
    }
}

/// An exclusive handle to a challenge's Redis state.
struct RedisClaim {
    journal_key: String,
    lease_key: String,
    epoch: Epoch,
    connection: ConnectionManager,
}

impl ChallengeClaim for RedisClaim {
    fn append<'a>(&'a self, batch: &'a [JournalEntry]) -> AppendFuture<'a> {
        Box::pin(async move {
            let payload = serde_json::to_string(batch).expect("journal entries serialize");
            let mut connection = self.connection.clone();

            let mut invocation = APPEND_SCRIPT.prepare_invoke();
            invocation
                .key(&self.journal_key)
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
    use redis::AsyncCommands;

    use super::*;
    use crate::lifecycle::core::event::{Cause, LifecycleEvent};
    use crate::lifecycle::core::types::{ChallengeMode, JournalSeq, MsgId, Stage, Timestamp};

    async fn test_store() -> Option<Store> {
        let Ok(uri) = std::env::var("BLERT_TEST_REDIS_URI") else {
            eprintln!("BLERT_TEST_REDIS_URI is not set; skipping Redis tests");
            return None;
        };
        Some(Store::connect(&uri).await.expect("test redis unreachable"))
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
            .del(&[journal_key(uuid), lease_key(uuid)][..])
            .await
            .unwrap();
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

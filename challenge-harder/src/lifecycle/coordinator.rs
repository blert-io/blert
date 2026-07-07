//! A coordinator owns the server's active challenges, routing commands and
//! ruling on creation.

use core::time::Duration;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use super::challenge::{ChallengeStore, Start, run_challenge};
use super::core::command::{ClientStatusChange, Command, Create, Finish, Join, Update};
use super::core::deadline::LifecycleConfig;
use super::core::state::{ChallengePhase, Snapshot};
use super::core::types::{ChallengeType, ClientId, MsgId, Uuid};
use crate::players::normalize_rsn;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CommandError {
    #[error("no active challenge with the given ID")]
    UnknownChallenge,
    #[error("the challenge shut down before applying the command")]
    Unavailable,
}

/// Local cache of the latest known state of every active challenge, fed by
/// a store's update signals.
struct SnapshotCache {
    store: Arc<dyn ChallengeStore>,
    entries: Mutex<HashMap<Uuid, watch::Sender<Option<Snapshot>>>>,
}

impl SnapshotCache {
    /// How long a response waiter sleeps before rechecking the store directly.
    const REREAD_INTERVAL: Duration = Duration::from_secs(1);

    /// Longest a caller waits for its command to be applied before giving up.
    const APPLIED_TIMEOUT: Duration = Duration::from_secs(5);

    /// Update signals queued from the store subscription.
    const SIGNAL_BUFFER_LEN: usize = 128;

    /// Creates a cache that consumes a challenge store's update signals.
    fn spawn(store: Arc<dyn ChallengeStore>) -> Arc<SnapshotCache> {
        let cache = Arc::new(SnapshotCache {
            store,
            entries: Mutex::default(),
        });

        let (tx, mut rx) = mpsc::channel(Self::SIGNAL_BUFFER_LEN);
        cache.store.subscribe(tx);
        let feed = Arc::downgrade(&cache);
        tokio::spawn(async move {
            while let Some((uuid, _cursor)) = rx.recv().await {
                let Some(cache) = feed.upgrade() else {
                    return;
                };
                cache.refresh(uuid).await;
            }
        });

        cache
    }

    /// Waits until a challenge's state has processed the message at `id`,
    /// returning its state. `None` indicates that the challenge shut down
    /// without processing it.
    async fn applied(&self, uuid: Uuid, id: MsgId) -> Option<Snapshot> {
        let deadline = tokio::time::Instant::now() + Self::APPLIED_TIMEOUT;
        let mut updates = self.subscribe(uuid);
        let reached = |s: &Option<Snapshot>| s.as_ref().is_some_and(|s| s.cursor >= id);
        loop {
            let update = tokio::time::timeout(Self::REREAD_INTERVAL, updates.wait_for(reached))
                .await
                .map(|result| result.map(|snapshot| snapshot.clone()));
            match update {
                Ok(Ok(snapshot)) => return snapshot,
                // The entry closes when the challenge's task exits. Read its final state.
                Ok(Err(_)) => {
                    return match self.store.read(uuid).await {
                        Ok(snapshot) => snapshot.filter(|s| s.cursor >= id),
                        Err(error) => {
                            tracing::warn!(%uuid, %error, "final_read_failed");
                            None
                        }
                    };
                }
                Err(_) => {
                    if tokio::time::Instant::now() >= deadline {
                        tracing::warn!(%uuid, %id, "applied_wait_timed_out");
                        return None;
                    }
                    // Check the store directly if no signal was received.
                    self.refresh(uuid).await;
                }
            }
        }
    }

    /// Re-reads a challenge's state from the store into the cache.
    async fn refresh(&self, uuid: Uuid) -> Option<Snapshot> {
        match self.store.read(uuid).await {
            Ok(Some(snapshot)) => {
                self.publish(snapshot.clone());
                Some(snapshot)
            }
            Ok(None) => None,
            Err(error) => {
                tracing::warn!(%uuid, %error, "snapshot_read_failed");
                None
            }
        }
    }

    /// The latest known phase of a challenge, if it has published any state.
    fn phase(&self, uuid: Uuid) -> Option<ChallengePhase> {
        self.entries
            .lock()
            .expect("cache lock poisoned")
            .get(&uuid)
            .and_then(|entry| entry.borrow().as_ref().map(|s| s.phase))
    }

    fn subscribe(&self, uuid: Uuid) -> watch::Receiver<Option<Snapshot>> {
        self.entries
            .lock()
            .expect("cache lock poisoned")
            .entry(uuid)
            .or_insert_with(|| watch::channel(None).0)
            .subscribe()
    }

    /// Publishes a newer snapshot of a challenge's state.
    fn publish(&self, snapshot: Snapshot) {
        let mut entries = self.entries.lock().expect("cache lock poisoned");
        let entry = entries
            .entry(snapshot.uuid)
            .or_insert_with(|| watch::channel(None).0);
        entry.send_if_modified(|current| {
            // Drop the snapshot update if it's stale.
            if current.as_ref().is_none_or(|c| c.cursor < snapshot.cursor) {
                *current = Some(snapshot);
                true
            } else {
                false
            }
        });
    }

    /// Drops a challenge's entry, waking its waiters into their closed path.
    fn close(&self, uuid: Uuid) {
        self.entries
            .lock()
            .expect("cache lock poisoned")
            .remove(&uuid);
    }
}

/// Which challenge a group of players is recording.
type PartyKey = String;

fn party_key(challenge_type: ChallengeType, party: &[String]) -> PartyKey {
    // Matches `challengePartyKey` in `//common/db/redis.ts`.
    let mut sorted: Vec<&String> = party.iter().collect();
    sorted.sort_unstable();
    let names: Vec<String> = sorted.into_iter().map(|n| normalize_rsn(n)).collect();
    format!("{}-{}", challenge_type as i32, names.join("-"))
}

/// Record of the challenges whose processing tasks are running locally.
#[derive(Default)]
struct Registry {
    challenges: HashSet<Uuid>,
}

pub struct Coordinator {
    registry: Arc<Mutex<Registry>>,
    config: LifecycleConfig,
    store: Arc<dyn ChallengeStore>,
    cache: Arc<SnapshotCache>,
}

impl Coordinator {
    /// Creates a coordinator over a challenge store.
    #[must_use]
    pub fn with_store(store: Arc<dyn ChallengeStore>) -> Self {
        Coordinator {
            registry: Arc::default(),
            config: LifecycleConfig::default(),
            cache: SnapshotCache::spawn(Arc::clone(&store)),
            store,
        }
    }

    #[must_use]
    pub fn with_config(mut self, config: LifecycleConfig) -> Self {
        self.config = config;
        self
    }

    /// Returns the current state of an active challenge, if it exists.
    pub async fn snapshot(&self, uuid: Uuid) -> Option<Snapshot> {
        self.cache.refresh(uuid).await
    }

    /// Creates a new challenge for a party or joins an existing one, returning
    /// the challenge's state once the request has been applied.
    /// `None` means the challenge shut down before the request could be processed.
    pub async fn create_or_join_challenge(&self, create: Create) -> Option<Snapshot> {
        let key = party_key(create.challenge_type, &create.party);
        let challenge_type = create.challenge_type;
        let stage = create.stage;
        let user_id = create.user_id;
        let client_id = create.client_id;
        let party = create.party.clone();

        let start = match self.store.start(&key, create).await {
            Ok(start) => start,
            Err(error) => {
                tracing::error!(
                    ?challenge_type,
                    ?party,
                    %user_id,
                    %client_id,
                    %error,
                    "challenge_start_failed",
                );
                return None;
            }
        };

        let (id, uuid, joined) = match start {
            Start::Created { claim, id } => {
                let uuid = claim.uuid();
                tracing::debug!(
                    %uuid,
                    ?challenge_type,
                    ?party,
                    ?stage,
                    %user_id,
                    %client_id,
                    "challenge_created",
                );
                self.registry
                    .lock()
                    .expect("coordinator lock poisoned")
                    .challenges
                    .insert(uuid);

                let config = self.config.clone();
                let registry = Arc::clone(&self.registry);
                let cache = Arc::clone(&self.cache);
                tokio::spawn(async move {
                    run_challenge(config, claim).await;
                    registry
                        .lock()
                        .expect("coordinator lock poisoned")
                        .challenges
                        .remove(&uuid);
                    cache.close(uuid);
                });

                (id, uuid, false)
            }
            Start::Joined { uuid, id } => {
                tracing::debug!(%uuid, %user_id, %client_id, "challenge_joined");
                (id, uuid, true)
            }
        };

        let snapshot = self.cache.applied(uuid, id).await;
        if snapshot.is_none() && joined {
            // In theory, a new challenge's start could race the existing one's
            // termination and be incorrectly handled as a join. Given the
            // minimum time between two challenges in game, though, there isn't
            // a realistic path for this to happen. Just log if it ever occurs.
            tracing::error!(msg_id = %id, "challenge_join_incumbent_terminated");
        }
        snapshot
    }

    /// Updates the state of an active challenge, returning its new state.
    pub async fn update(&self, uuid: Uuid, update: Update) -> Result<Snapshot, CommandError> {
        tracing::debug!(
            %uuid,
            stage = ?update.stage,
            mode = ?update.mode,
            user_id = %update.user_id,
            client_id = %update.client_id,
            "challenge_update",
        );
        self.send_command(uuid, Command::Update(update)).await
    }

    /// Reports a change in a client's connection state to the challenge the
    /// client is currently in, if any.
    pub async fn update_client_status(
        &self,
        change: ClientStatusChange,
    ) -> Result<(), CommandError> {
        let user_id = change.user_id;
        let client_id = change.client_id;
        let status = change.status;

        let cmd = Command::ClientStatus(change);
        let Some((uuid, id)) = self
            .store
            .send_to_current_challenge(client_id, &cmd)
            .await
            .map_err(|error| {
                tracing::warn!(client_id = %client_id, %error, "command_enqueue_failed");
                CommandError::Unavailable
            })?
        else {
            return Ok(());
        };

        tracing::debug!(
            %uuid,
            user_id = %user_id,
            client_id = %client_id,
            status = ?status,
            "client_status_update",
        );
        self.cache
            .applied(uuid, id)
            .await
            .map(|_| ())
            .ok_or(CommandError::Unavailable)
    }

    /// Marks a challenge as having been completed by a client.
    pub async fn finish(&self, uuid: Uuid, finish: Finish) -> Result<Snapshot, CommandError> {
        tracing::debug!(
            %uuid,
            user_id = %finish.user_id,
            client_id = %finish.client_id,
            soft = finish.soft,
            times = ?finish.times,
            "challenge_finish",
        );
        let result = self.send_command(uuid, Command::Finish(finish)).await;
        if let Ok(p) = &result
            && p.phase == ChallengePhase::Terminated
        {
            tracing::debug!(%uuid, status = ?p.status, "challenge_terminated");
        }
        result
    }

    /// Sends a command to an active challenge, waiting for it to be applied.
    async fn send_command(&self, uuid: Uuid, cmd: Command) -> Result<Snapshot, CommandError> {
        let id = match self.store.send(uuid, &cmd).await {
            Ok(Some(id)) => id,
            Ok(None) => return Err(CommandError::UnknownChallenge),
            Err(error) => {
                tracing::warn!(%uuid, %error, "command_enqueue_failed");
                return Err(CommandError::Unavailable);
            }
        };
        self.cache
            .applied(uuid, id)
            .await
            .ok_or(CommandError::Unavailable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lifecycle::core::command::{ClientStatus, StageProgress};
    use crate::lifecycle::core::types::{
        ChallengeMode, ClientId, RecordingType, Stage, StageStatus, UserId,
    };
    use crate::lifecycle::sim::Collector;

    fn create_request() -> Create {
        create_request_for(1)
    }

    fn create_request_for(user: i64) -> Create {
        Create {
            user_id: UserId(user),
            client_id: ClientId(10 * user),
            session_token: format!("tok{user}").into(),
            plugin_version: "0.9.14".into(),
            runelite_version: "1.12.31.1".into(),
            challenge_type: ChallengeType::Tob,
            mode: ChallengeMode::TobRegular,
            party: vec!["WWWWWWWWWWQQ".into()],
            stage: Stage::TobMaiden,
            recording_type: RecordingType::Participant,
        }
    }

    fn finish_request(user: i64) -> Finish {
        Finish {
            user_id: UserId(user),
            client_id: ClientId(10 * user),
            session_token: format!("tok{user}").into(),
            times: None,
            soft: false,
        }
    }

    fn update_request(user: i64) -> Update {
        Update {
            user_id: UserId(user),
            client_id: ClientId(10 * user),
            session_token: format!("tok{user}").into(),
            mode: None,
            stage: None,
            party: None,
        }
    }

    fn test_coordinator() -> Coordinator {
        Coordinator::with_store(Arc::new(Collector::default()))
    }

    /// Yields hoping the reaper of an exited challenge task will run.
    async fn wait_for_reap() {
        for _ in 0..16 {
            tokio::task::yield_now().await;
        }
    }

    #[tokio::test(start_paused = true)]
    async fn commands_to_an_unprocessed_challenge_time_out() {
        let collector = Collector::default();
        let coordinator = Coordinator::with_store(Arc::new(collector.clone()));

        // The challenge exists durably, but no actor was ever spawned for it.
        let Start::Created { claim, .. } = collector
            .start("party", create_request())
            .await
            .expect("start should succeed")
        else {
            panic!("expected a creation");
        };

        assert!(matches!(
            coordinator.update(claim.uuid(), update_request(1)).await,
            Err(CommandError::Unavailable),
        ));
    }

    #[test]
    fn party_key_sorts_raw_names_then_normalizes() {
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
    }
}

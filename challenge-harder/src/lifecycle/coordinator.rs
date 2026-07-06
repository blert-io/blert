//! A coordinator owns the server's active challenges, routing commands and
//! ruling on creation.

use core::time::Duration;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use super::challenge::{ActiveChallenge, ChallengeStore, CommandSender, claim_challenge, inbox};
use super::core::command::{ClientStatusChange, Command, Create, Finish, Join, Update};
use super::core::deadline::LifecycleConfig;
use super::core::state::{ChallengePhase, Snapshot};
use super::core::types::{ChallengeType, ClientId, MsgId, Uuid};

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

/// Standard RSN normalization, as in `//common/player.ts`.
fn normalize_rsn(name: &str) -> String {
    name.to_lowercase().replace(['-', ' '], "_")
}

fn party_key(challenge_type: ChallengeType, party: &[String]) -> PartyKey {
    // Matches `challengePartyKey` in `//common/db/redis.ts`.
    let mut sorted: Vec<&String> = party.iter().collect();
    sorted.sort_unstable();
    let names: Vec<String> = sorted.into_iter().map(|n| normalize_rsn(n)).collect();
    format!("{}-{}", challenge_type as i32, names.join("-"))
}

#[derive(Default)]
struct Registry {
    challenges: HashMap<Uuid, CommandSender>,
    directory: HashMap<PartyKey, Uuid>,
    /// Which challenge a client is recording, if any.
    clients: HashMap<ClientId, Uuid>,
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
        let (id, uuid, joined) = {
            let key = party_key(create.challenge_type, &create.party);
            let mut registry = self.registry.lock().expect("coordinator lock poisoned");

            // TODO(frolv): Move this to a lua script
            let incumbent = registry
                .directory
                .get(&key)
                .and_then(|uuid| Some((*uuid, registry.challenges.get(uuid)?.clone())))
                // A challenge which has not yet published any state is still
                // applying its create, and is joinable.
                .filter(|(uuid, _)| {
                    self.cache
                        .phase(*uuid)
                        .is_none_or(|phase| phase == ChallengePhase::Active)
                });

            if let Some((uuid, sender)) = incumbent {
                tracing::debug!(
                    %uuid,
                    user_id = %create.user_id,
                    client_id = %create.client_id,
                    "challenge_joined",
                );
                registry.clients.insert(create.client_id, uuid);
                let id = sender.send(Command::Join(Join {
                    user_id: create.user_id,
                    client_id: create.client_id,
                    session_token: create.session_token,
                    plugin_version: create.plugin_version,
                    runelite_version: create.runelite_version,
                    recording_type: create.recording_type,
                }));
                (id, uuid, true)
            } else {
                let uuid = Uuid::new_v4();
                tracing::debug!(
                    %uuid,
                    challenge_type = ?create.challenge_type,
                    party = ?create.party,
                    stage = ?create.stage,
                    user_id = %create.user_id,
                    client_id = %create.client_id,
                    "challenge_created",
                );
                let (sender, rx) = inbox();

                let store = Arc::clone(&self.store);
                let config = self.config.clone();
                let task = tokio::spawn(async move {
                    match claim_challenge(store.as_ref(), uuid).await {
                        Ok(claim) => {
                            let mut challenge = ActiveChallenge::new(uuid, config, claim);
                            challenge.run(rx).await;
                        }
                        Err(error) => {
                            // Reaper will immediately clean up the challenge.
                            tracing::error!(%uuid, %error, "challenge_claim_failed");
                        }
                    }
                });

                registry.challenges.insert(uuid, sender.clone());
                registry.directory.insert(key.clone(), uuid);
                registry.clients.insert(create.client_id, uuid);

                tokio::spawn(reap(
                    Arc::clone(&self.registry),
                    Arc::clone(&self.cache),
                    key,
                    uuid,
                    task,
                ));

                let id = sender.send(Command::Create(create));
                (id, uuid, false)
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

    /// Reports a change in a client's connection state.
    /// Returns a snapshot of the client's active challenge if they are in one.
    pub async fn update_client_status(
        &self,
        change: ClientStatusChange,
    ) -> Result<Option<Snapshot>, CommandError> {
        let Some(uuid) = self
            .registry
            .lock()
            .expect("coordinator lock poisoned")
            .clients
            .get(&change.client_id)
            .copied()
        else {
            return Ok(None);
        };

        tracing::debug!(
            uuid = %uuid,
            user_id = %change.user_id,
            client_id = %change.client_id,
            status = ?change.status,
            "client_status_update",
        );
        self.send_command(uuid, Command::ClientStatus(change))
            .await
            .map(Some)
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
            && let ChallengePhase::Terminated { status } = p.phase
        {
            tracing::debug!(%uuid, ?status, "challenge_terminated");
        }
        result
    }

    /// Sends a command to an active challenge, waiting for it to be applied.
    async fn send_command(&self, uuid: Uuid, cmd: Command) -> Result<Snapshot, CommandError> {
        let sender = self
            .registry
            .lock()
            .expect("coordinator lock poisoned")
            .challenges
            .get(&uuid)
            .cloned()
            .ok_or(CommandError::UnknownChallenge)?;

        let id = sender.send(cmd);
        self.cache
            .applied(uuid, id)
            .await
            .ok_or(CommandError::Unavailable)
    }
}

/// Removes a terminated challenge's registry and cache entries once its
/// actor task exits.
async fn reap(
    registry: Arc<Mutex<Registry>>,
    cache: Arc<SnapshotCache>,
    key: PartyKey,
    uuid: Uuid,
    task: JoinHandle<()>,
) {
    let _ = task.await;

    {
        let mut registry = registry.lock().expect("coordinator lock poisoned");
        registry.challenges.remove(&uuid);
        if registry.directory.get(&key) == Some(&uuid) {
            // A newer challenge for the same party may have taken over the entry.
            registry.directory.remove(&key);
        }
        registry.clients.retain(|_, challenge| *challenge != uuid);
    }
    cache.close(uuid);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lifecycle::core::command::StageProgress;
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

    #[tokio::test]
    async fn terminated_challenge_is_reaped() {
        let coordinator = test_coordinator();
        let created = coordinator
            .create_or_join_challenge(create_request())
            .await
            .expect("challenge should start");
        coordinator
            .finish(created.uuid, finish_request(1))
            .await
            .expect("finish should apply");
        wait_for_reap().await;

        // The challenge's state outlives it, but commands no longer route.
        assert!(matches!(
            coordinator.update(created.uuid, update_request(1)).await,
            Err(CommandError::UnknownChallenge),
        ));

        let next = coordinator
            .create_or_join_challenge(create_request())
            .await
            .expect("challenge should start");
        assert_ne!(next.uuid, created.uuid);
    }

    #[tokio::test]
    async fn reap_leaves_replacement_directory_entry() {
        let coordinator = test_coordinator();
        let first = coordinator
            .create_or_join_challenge(create_request())
            .await
            .expect("challenge should start");
        coordinator
            .finish(first.uuid, finish_request(1))
            .await
            .expect("finish should apply");

        // The party starts a new challenge before the first one's reaper has
        // run, taking over its directory entry.
        let second = coordinator
            .create_or_join_challenge(create_request())
            .await
            .expect("challenge should start");
        assert_ne!(second.uuid, first.uuid);
        wait_for_reap().await;

        assert!(matches!(
            coordinator.update(first.uuid, update_request(1)).await,
            Err(CommandError::UnknownChallenge),
        ));
        let joined = coordinator
            .create_or_join_challenge(create_request_for(2))
            .await
            .expect("challenge should start");
        assert_eq!(joined.uuid, second.uuid);
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

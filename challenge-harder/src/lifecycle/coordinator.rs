//! A coordinator owns the server's active challenges, routing commands and
//! ruling on creation.

use core::time::Duration;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use tokio::sync::{RwLock, mpsc, watch};
use tokio::task::JoinHandle;

use super::challenge::{ChallengeSignal, ChallengeStore, Claim, Rejoin, Start, run_challenge};
use super::core::command::{ClientStatusChange, Command, Create, Finish, Join, Update};
use super::core::deadline::LifecycleConfig;
use super::core::state::{ChallengePhase, PublishedClient, Snapshot};
use super::core::types::{ClientId, MsgId, Uuid};

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CommandError {
    #[error("no active challenge with the given ID")]
    UnknownChallenge,
    #[error("the client is already in a different challenge")]
    AlreadyInChallenge,
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
            while let Some(signal) = rx.recv().await {
                let Some(cache) = feed.upgrade() else {
                    return;
                };
                match signal {
                    ChallengeSignal::Updated { uuid, cursor: _ } => {
                        cache.refresh(uuid).await;
                    }
                    ChallengeSignal::Deleted { uuid } => cache.close(uuid),
                }
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

/// Record of the challenges whose processing tasks are running locally.
struct Registry {
    challenges: HashSet<Uuid>,
    count: watch::Sender<usize>,
}

impl Registry {
    fn new(count: watch::Sender<usize>) -> Self {
        Registry {
            challenges: HashSet::new(),
            count,
        }
    }

    fn insert(&mut self, uuid: Uuid) {
        self.challenges.insert(uuid);
        let _ = self.count.send(self.challenges.len());
    }

    fn remove(&mut self, uuid: Uuid) {
        self.challenges.remove(&uuid);
        let _ = self.count.send(self.challenges.len());
    }
}

/// Spawns the processing task for a claimed challenge, tracking it in the
/// registry until it exits.
fn spawn_challenge(
    config: LifecycleConfig,
    registry: &Arc<Mutex<Registry>>,
    cache: &Arc<SnapshotCache>,
    claim: Claim,
    shutdown: watch::Receiver<bool>,
) {
    let uuid = claim.uuid();
    registry
        .lock()
        .expect("coordinator lock poisoned")
        .insert(uuid);

    let registry = Arc::clone(registry);
    let cache = Arc::clone(cache);
    tokio::spawn(async move {
        // Run as a child to catch panics.
        let outcome = tokio::spawn(run_challenge(config, claim, shutdown)).await;
        registry
            .lock()
            .expect("coordinator lock poisoned")
            .remove(uuid);
        cache.close(uuid);
        if let Err(error) = outcome {
            tracing::error!(%uuid, %error, "challenge_task_panicked");
        }
    });
}

pub struct Coordinator {
    registry: Arc<Mutex<Registry>>,
    running: watch::Receiver<usize>,
    /// Excludes claim scans while starts are in flight. A start lists its
    /// challenge in the store before the local registry knows it exists,
    /// and a pass overlapping that window would claim the challenge away
    /// from its own creator. Starts use the read side, scans use the write.
    starts: Arc<RwLock<()>>,
    config: LifecycleConfig,
    store: Arc<dyn ChallengeStore>,
    cache: Arc<SnapshotCache>,
    shutdown: watch::Receiver<bool>,
}

impl Coordinator {
    /// How many unowned challenges a single scan pass may claim.
    const SCAN_BATCH_SIZE: usize = 16;

    /// Longest a shutdown waits for local challenges to exit.
    const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(10);

    /// Creates a coordinator over a challenge store.
    #[must_use]
    pub fn with_store(store: Arc<dyn ChallengeStore>, shutdown: watch::Receiver<bool>) -> Self {
        let (count, running) = watch::channel(0);
        Coordinator {
            registry: Arc::new(Mutex::new(Registry::new(count))),
            running,
            starts: Arc::default(),
            config: LifecycleConfig::default(),
            cache: SnapshotCache::spawn(Arc::clone(&store)),
            store,
            shutdown,
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
        let challenge_type = create.challenge_type;
        let stage = create.stage;
        let user_id = create.user_id;
        let client_id = create.client_id;
        let party = create.party.clone();

        let (id, uuid, joined) = {
            // Hold off claim scans until the started challenge is registered,
            // so they cannot claim it away during its start.
            let _guard = self.starts.read().await;
            let start = match self.store.start(create).await {
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

            match start {
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
                    spawn_challenge(
                        self.config.clone(),
                        &self.registry,
                        &self.cache,
                        claim,
                        self.shutdown.clone(),
                    );
                    (id, uuid, false)
                }
                Start::Joined { uuid, id } => {
                    tracing::debug!(%uuid, %user_id, %client_id, "challenge_joined");
                    (id, uuid, true)
                }
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

    /// Reconnects a client to an active challenge, returning its current state.
    pub async fn rejoin(&self, uuid: Uuid, join: Join) -> Result<Snapshot, CommandError> {
        tracing::debug!(
            %uuid,
            user_id = %join.user_id,
            client_id = %join.client_id,
            "challenge_rejoin",
        );
        let id = match self.store.rejoin(uuid, &join).await {
            Ok(Rejoin::Queued(id)) => id,
            Ok(Rejoin::UnknownChallenge) => return Err(CommandError::UnknownChallenge),
            Ok(Rejoin::AlreadyInChallenge) => return Err(CommandError::AlreadyInChallenge),
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
    pub async fn finish(&self, uuid: Uuid, finish: Finish) -> Result<(), CommandError> {
        tracing::debug!(
            %uuid,
            user_id = %finish.user_id,
            client_id = %finish.client_id,
            soft = finish.soft,
            times = ?finish.times,
            "challenge_finish",
        );
        match self.store.send(uuid, &Command::Finish(finish)).await {
            Ok(Some(_)) => Ok(()),
            Ok(None) => Err(CommandError::UnknownChallenge),
            Err(error) => {
                tracing::warn!(%uuid, %error, "command_enqueue_failed");
                Err(CommandError::Unavailable)
            }
        }
    }

    /// Starts the background scan claiming unowned challenges and resuming them
    /// locally on an interval of `every`.
    pub fn start_scan(&self, every: Duration) {
        let store = Arc::clone(&self.store);
        let registry = Arc::clone(&self.registry);
        let starts = Arc::clone(&self.starts);
        let cache = Arc::clone(&self.cache);
        let config = self.config.clone();
        let mut shutdown = self.shutdown.clone();

        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(every);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                tokio::select! {
                    _ = ticker.tick() => {}
                    _ = shutdown.changed() => return,
                }
                let _exclusive = starts.write().await;
                let running: Vec<Uuid> = {
                    let registry = registry.lock().expect("coordinator lock poisoned");
                    registry.challenges.iter().copied().collect()
                };
                match store.claim_unowned(Self::SCAN_BATCH_SIZE, &running).await {
                    Ok(claims) => {
                        for claim in claims {
                            tracing::info!(uuid = %claim.uuid(), "challenge_claimed");
                            spawn_challenge(
                                config.clone(),
                                &registry,
                                &cache,
                                claim,
                                shutdown.clone(),
                            );
                        }
                    }
                    Err(error) => tracing::warn!(%error, "claim_scan_failed"),
                }
            }
        });
    }

    /// Resolves once every locally running challenge task has exited,
    /// bounded by a timeout.
    pub async fn drained(&self) {
        let mut running = self.running.clone();
        let emptied = running.wait_for(|count| *count == 0);
        if tokio::time::timeout(Self::SHUTDOWN_TIMEOUT, emptied)
            .await
            .is_err()
        {
            let remaining = *self.running.borrow();
            tracing::warn!(remaining, "drain_timed_out");
        }
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
    use crate::lifecycle::challenge::{ChallengeClaim, ChallengeServerUpdate, StoreError};
    use crate::lifecycle::core::command::{ClientStatus, Envelope, StageProgress};
    use crate::lifecycle::core::event::JournalEntry;
    use crate::lifecycle::core::state::ChallengeState;
    use crate::lifecycle::core::types::{
        ChallengeMode, ChallengeType, ClientId, RecordingType, Stage, StageStatus, UserId,
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

    /// Yields hoping the reaper of an exited challenge task will run.
    async fn wait_for_reap() {
        for _ in 0..16 {
            tokio::task::yield_now().await;
        }
    }

    #[tokio::test(start_paused = true)]
    async fn commands_to_an_unprocessed_challenge_time_out() {
        let collector = Collector::default();
        let (_tx, rx) = watch::channel(false);
        let coordinator = Coordinator::with_store(Arc::new(collector.clone()), rx);

        // The challenge exists durably, but no actor was ever spawned for it.
        let Start::Created { claim, .. } = collector
            .start(create_request())
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

    #[tokio::test(start_paused = true)]
    async fn scan_claims_and_resumes_an_unowned_challenge() {
        let collector = Collector::default();
        let (_tx, rx) = watch::channel(false);
        let coordinator = Coordinator::with_store(Arc::new(collector.clone()), rx);

        let (unowned_uuid, id) = {
            let Start::Created { claim, id } = collector
                .start(create_request())
                .await
                .expect("start should succeed")
            else {
                panic!("expected a creation");
            };
            (claim.uuid(), id)
        };

        coordinator.start_scan(Duration::from_secs(1));

        let snapshot = coordinator
            .cache
            .applied(unowned_uuid, id)
            .await
            .expect("scan should resume the challenge");
        assert_eq!(snapshot.phase, ChallengePhase::Active);
        assert!(
            coordinator
                .registry
                .lock()
                .expect("coordinator lock poisoned")
                .challenges
                .contains(&unowned_uuid),
        );
    }

    #[tokio::test(start_paused = true)]
    async fn shutdown_releases_running_challenges_and_stops_scanning() {
        let collector = Collector::default();
        let (tx, rx) = watch::channel(false);
        let coordinator = Coordinator::with_store(Arc::new(collector.clone()), rx);
        coordinator.start_scan(Duration::from_secs(1));

        let snapshot = coordinator
            .create_or_join_challenge(create_request())
            .await
            .expect("create should apply");
        let uuid = snapshot.uuid;

        tx.send(true).expect("coordinator should be listening");
        coordinator.drained().await;
        assert!(
            coordinator
                .registry
                .lock()
                .expect("coordinator lock poisoned")
                .challenges
                .is_empty(),
        );

        let queued = collector
            .send(uuid, &Command::Finish(finish_request(1)))
            .await
            .expect("send should succeed");
        assert!(queued.is_some(), "challenge should still exist");

        // A second challenge is created but there is no one listening.
        let foreign = Create {
            party: vec!["2Ogp".into()],
            ..create_request_for(2)
        };
        let Start::Created { claim, .. } = collector
            .start(foreign)
            .await
            .expect("start should succeed")
        else {
            panic!("expected a creation");
        };
        let unowned_uuid = claim.uuid();
        drop(claim);
        tokio::time::sleep(Duration::from_secs(5)).await;
        assert_eq!(collector.read(unowned_uuid).await, Ok(None));
    }

    /// A claim whose journal load panics.
    struct PanickingClaim;

    #[async_trait::async_trait]
    impl ChallengeClaim for PanickingClaim {
        async fn load(&self) -> Result<Vec<JournalEntry>, StoreError> {
            panic!("scripted panic");
        }

        fn follow(&self, _: MsgId, _: mpsc::Sender<Envelope>) {
            unreachable!();
        }

        async fn append(&self, _: &[JournalEntry]) -> Result<(), StoreError> {
            unreachable!();
        }

        async fn project(&self, _: &Snapshot, _: &[PublishedClient]) -> Result<(), StoreError> {
            unreachable!();
        }

        async fn announce(&self, _: &ChallengeServerUpdate) -> Result<(), StoreError> {
            unreachable!();
        }

        async fn renew(&self) -> Result<(), StoreError> {
            unreachable!();
        }

        async fn release(&self) -> Result<(), StoreError> {
            unreachable!();
        }

        async fn delete(&self, _: &ChallengeState) -> Result<(), StoreError> {
            unreachable!();
        }
    }

    #[tokio::test(start_paused = true)]
    async fn panicked_challenge_is_deregistered() {
        let (_tx, rx) = watch::channel(false);
        let collector = Collector::default();
        let coordinator = Coordinator::with_store(Arc::new(collector.clone()), rx);
        let uuid = Uuid::new_v4();

        spawn_challenge(
            coordinator.config.clone(),
            &coordinator.registry,
            &coordinator.cache,
            Claim::new(uuid, Box::new(PanickingClaim)),
            coordinator.shutdown.clone(),
        );
        let registered = |coordinator: &Coordinator| {
            coordinator
                .registry
                .lock()
                .expect("coordinator lock poisoned")
                .challenges
                .contains(&uuid)
        };
        assert!(registered(&coordinator));

        wait_for_reap().await;
        assert!(!registered(&coordinator));
    }
}

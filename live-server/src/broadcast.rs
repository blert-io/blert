use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{Mutex, mpsc};

use crate::backfill::{BackfillRequest, BackfillResult};
use crate::message::SseMessage;
use crate::reader::ChallengeReader;
use crate::redis::{
    self, ChallengeClient, ChallengeServerUpdate, ChallengeState, RedisQuery, RedisResponse,
};
use crate::subscriber::{Subscriber, SubscriberId};

/// Interval between broadcast ticks (600ms = 1 OSRS game tick).
const TICK_INTERVAL: Duration = Duration::from_millis(600);

/// Grace period before removing a reader with no subscribers.
const READER_GRACE_PERIOD: Duration = Duration::from_secs(10);

/// Handle for unsubscribing a subscriber.
#[derive(Debug)]
pub struct SubscriberHandle {
    subscriber_id: SubscriberId,
}

/// Orchestrates polling and broadcasting for all active challenge readers.
pub struct BroadcastManager {
    /// Active challenge readers, keyed by challenge UUID.
    readers: HashMap<String, ChallengeReader>,
    /// Readers with no subscribers, pending grace-period expiry.
    grace_periods: HashMap<String, tokio::time::Instant>,
    /// Redis connection for pipeline queries.
    redis_conn: ::redis::aio::MultiplexedConnection,
    /// Monotonically increasing subscriber ID counter.
    next_subscriber_id: u64,
    /// Reverse mapping from subscriber ID to challenge UUID.
    subscriber_challenges: HashMap<SubscriberId, String>,
    /// Count of queries sent to each reader.
    reader_query_counts: Vec<(String, usize)>,
    /// Sender for backfill requests.
    backfill_tx: mpsc::UnboundedSender<BackfillRequest>,
    /// Monotonically increasing tick counter, incremented each broadcast cycle.
    tick: u64,
    /// Set on shutdown to reject new subscriptions.
    shutting_down: bool,
}

impl BroadcastManager {
    /// Creates a new broadcast manager with the given Redis client.
    pub async fn new(
        redis_client: &::redis::Client,
        backfill_tx: mpsc::UnboundedSender<BackfillRequest>,
    ) -> Result<Self, ::redis::RedisError> {
        let redis_conn = redis_client.get_multiplexed_async_connection().await?;
        Ok(Self {
            readers: HashMap::new(),
            grace_periods: HashMap::new(),
            redis_conn,
            next_subscriber_id: 0,
            subscriber_challenges: HashMap::new(),
            reader_query_counts: Vec::new(),
            backfill_tx,
            tick: 0,
            shutting_down: false,
        })
    }

    /// Subscribes to a challenge, creating a reader if one doesn't exist.
    ///
    /// Returns a handle for unsubscribing and a receiver for SSE messages.
    pub async fn subscribe(
        &mut self,
        challenge_id: String,
        requested_stage: Option<i32>,
    ) -> Result<(SubscriberHandle, mpsc::UnboundedReceiver<SseMessage>), BroadcastError> {
        if self.shutting_down {
            return Err(BroadcastError::ShuttingDown);
        }

        let subscriber_id = self.next_subscriber_id;
        self.next_subscriber_id += 1;

        let (tx, rx) = mpsc::unbounded_channel();
        let subscriber = Subscriber::new(subscriber_id, requested_stage, tx);

        // Cancel any pending grace period for this challenge.
        self.grace_periods.remove(&challenge_id);

        if !self.readers.contains_key(&challenge_id) {
            let (state, clients) = self.fetch_challenge_state(&challenge_id).await?;

            let reader = ChallengeReader::new(
                challenge_id.clone(),
                state,
                &clients,
                self.backfill_tx.clone(),
            );
            self.readers.insert(challenge_id.clone(), reader);

            tracing::info!(challenge_id = %challenge_id, "reader created");
        }

        let reader = self
            .readers
            .get_mut(&challenge_id)
            .expect("reader just inserted");

        reader.add_subscriber(subscriber);
        self.subscriber_challenges
            .insert(subscriber_id, challenge_id);

        Ok((SubscriberHandle { subscriber_id }, rx))
    }

    /// Removes a subscriber. Starts a grace period if the reader has no
    /// remaining subscribers.
    #[allow(clippy::needless_pass_by_value)]
    pub fn unsubscribe(&mut self, handle: SubscriberHandle) {
        let Some(challenge_id) = self.subscriber_challenges.remove(&handle.subscriber_id) else {
            return;
        };
        if let Some(reader) = self.readers.get_mut(&challenge_id) {
            tracing::info!(
                challenge_id = %challenge_id,
                subscriber_id = handle.subscriber_id,
                "subscriber disconnected",
            );
            reader.remove_subscriber(handle.subscriber_id);

            if !reader.has_subscribers() {
                self.grace_periods
                    .entry(challenge_id)
                    .or_insert_with(tokio::time::Instant::now);
            }
        }
    }

    /// Fetches the initial state of a challenge from Redis.
    async fn fetch_challenge_state(
        &mut self,
        challenge_id: &str,
    ) -> Result<(ChallengeState, HashMap<u64, ChallengeClient>), BroadcastError> {
        let queries = [
            RedisQuery::ChallengeState {
                uuid: challenge_id.to_string(),
            },
            RedisQuery::ChallengeClients {
                uuid: challenge_id.to_string(),
            },
        ];
        let mut responses = redis::execute(&mut self.redis_conn, &queries).await?;

        match (responses.pop(), responses.pop()) {
            (
                Some(RedisResponse::ChallengeClients(clients)),
                Some(RedisResponse::ChallengeState(Some(state))),
            ) => Ok((state, clients)),
            (_, Some(RedisResponse::ChallengeState(None))) => {
                Err(BroadcastError::ChallengeNotFound(challenge_id.to_string()))
            }
            (_, _) => Err(BroadcastError::UnexpectedResponse),
        }
    }

    fn prepare_queries(&mut self) -> Vec<RedisQuery> {
        let mut queries = Vec::with_capacity(self.readers.len() * 3);
        self.reader_query_counts.clear();
        self.reader_query_counts.reserve(self.readers.len());

        for (uuid, reader) in &self.readers {
            let rq = reader.poll_queries();
            let count = rq.len();
            queries.extend(rq);
            self.reader_query_counts.push((uuid.clone(), count));
        }

        queries
    }

    fn broadcast_responses(&mut self, responses: Vec<RedisResponse>) {
        let mut response_iter = responses.into_iter();
        for (uuid, count) in &self.reader_query_counts {
            if let Some(reader) = self.readers.get_mut(uuid) {
                let reader_responses: Vec<RedisResponse> =
                    (&mut response_iter).take(*count).collect();
                reader.apply_poll_responses(reader_responses, self.tick);
            } else {
                // Reader was removed during I/O; skip its responses.
                for _ in 0..*count {
                    response_iter.next();
                }
            }
        }

        // Broadcast from each reader and collect disconnected subscribers.
        for (uuid, reader) in &mut self.readers {
            let disconnected = reader.broadcast();
            for sub_id in disconnected {
                reader.remove_subscriber(sub_id);
                self.subscriber_challenges.remove(&sub_id);
            }
            if !reader.has_subscribers() && !self.grace_periods.contains_key(uuid) {
                self.grace_periods
                    .insert(uuid.clone(), tokio::time::Instant::now());
            }
        }
    }

    /// Applies a completed backfill result to the appropriate reader.
    pub fn apply_backfill(&mut self, result: BackfillResult) {
        if let Some(reader) = self.readers.get_mut(&result.challenge_id) {
            reader.apply_backfill(result);
        }
    }

    fn apply_challenge_update(&mut self, update: &ChallengeServerUpdate) {
        let id = match update {
            ChallengeServerUpdate::Finish { id } | ChallengeServerUpdate::StageEnd { id, .. } => id,
        };
        if let Some(reader) = self.readers.get_mut(id) {
            reader.apply_challenge_update(update);
            if !reader.has_subscribers() && !self.grace_periods.contains_key(id) {
                self.grace_periods
                    .insert(id.clone(), tokio::time::Instant::now());
            }
        }
    }

    fn clean_up_expired_readers(&mut self) {
        let now = tokio::time::Instant::now();
        let expired: Vec<String> = self
            .grace_periods
            .iter()
            .filter(|(_, started)| now.duration_since(**started) >= READER_GRACE_PERIOD)
            .map(|(uuid, _)| uuid.clone())
            .collect();

        for uuid in &expired {
            self.readers.remove(uuid);
            self.grace_periods.remove(uuid);
            tracing::info!(challenge_id = %uuid, "reader removed after grace period");
        }
    }

    /// Notifies all subscribers across all readers that the server is shutting
    /// down. Clients should close, wait a random delay within the retry window,
    /// then reconnect to spread the thundering herd.
    /// Following this, new subscriptions will be rejected.
    pub fn shutdown_all(&mut self, retry_window_secs: u32) {
        self.shutting_down = true;
        for reader in self.readers.values_mut() {
            reader.notify_shutdown(retry_window_secs);
        }
        self.subscriber_challenges.clear();
    }
}

/// Subscribes to challenge updates via Redis pubsub and spawns a task that
/// dispatches them to the appropriate reader.
pub async fn spawn_pubsub_listener(
    manager: Arc<Mutex<BroadcastManager>>,
    redis_client: &::redis::Client,
) -> Result<(), redis::RedisQueryError> {
    let mut receiver = redis::subscribe_challenge_updates(redis_client).await?;

    tokio::spawn(async move {
        tracing::info!("pubsub listener started");

        while let Some(update) = receiver.recv().await {
            let mut mgr = manager.lock().await;
            mgr.apply_challenge_update(&update);
        }

        tracing::warn!("pubsub listener ended");
    });

    Ok(())
}

/// The main broadcast tick loop.
///
/// Runs every 600ms. Each tick:
/// 1. Collects poll queries from all readers.
/// 2. Executes them in a single Redis pipeline.
/// 3. Distributes responses and broadcasts events.
/// 4. Cleans up disconnected subscribers and expired grace periods.
pub async fn run_tick_loop(manager: Arc<Mutex<BroadcastManager>>) {
    let mut interval = tokio::time::interval(TICK_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    tracing::info!("tick loop started");

    loop {
        interval.tick().await;

        let (queries, mut redis_conn) = {
            let mut mgr = manager.lock().await;
            if mgr.readers.is_empty() {
                continue;
            }
            (mgr.prepare_queries(), mgr.redis_conn.clone())
        };

        let responses = if queries.is_empty() {
            Vec::new()
        } else {
            match redis::execute(&mut redis_conn, &queries).await {
                Ok(r) => r,
                Err(e) => {
                    tracing::error!("redis pipeline error: {e}");
                    Vec::new()
                }
            }
        };

        // TODO(frolv): Eventually, instead of holding the lock over the whole
        // manager, it should have per-reader locks.
        {
            let mut mgr = manager.lock().await;
            mgr.broadcast_responses(responses);
            mgr.clean_up_expired_readers();

            mgr.tick += 1;
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum BroadcastError {
    #[error("redis error: {0}")]
    Redis(#[from] crate::redis::RedisQueryError),
    #[error("challenge not found: {0}")]
    ChallengeNotFound(String),
    #[error("unexpected redis response")]
    UnexpectedResponse,
    #[error("server is shutting down")]
    ShuttingDown,
}

use std::collections::{HashMap, VecDeque};

use crate::message::SseMessage;
use crate::redis::{ChallengeClient, ChallengeServerUpdate, RedisQuery, RedisResponse};
use crate::subscriber::{Subscriber, SubscriberId};

/// Lifecycle state of a `ChallengeReader`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderState {
    /// Fetching historical event data from Redis.
    Backfilling,
    /// Polling for new events and broadcasting to subscribers.
    Active,
    /// All recording clients have disconnected.
    Stalled,
    /// The challenge has finished. No more polling; waiting for subscribers to drain.
    Completed,
}

/// A buffered tick entry pending broadcast.
#[derive(Debug, Clone)]
pub struct TickEntry {
    /// Game tick number.
    pub tick: u32,
    /// Raw protobuf bytes (`ChallengeEvents`) for this tick.
    pub data: Vec<u8>,
}

/// Manages the state for a single live challenge being watched.
pub struct ChallengeReader {
    /// Tracing span for this reader — all log calls scoped with `challenge_id`.
    span: tracing::Span,

    /// Challenge UUID.
    pub uuid: String,
    /// Challenge type (proto enum value).
    pub challenge_type: i32,
    /// Challenge mode (proto enum value).
    pub mode: i32,

    /// Current stage of the challenge.
    pub stage: i32,
    /// Current stage attempt number (for retriable stages).
    pub stage_attempt: Option<u32>,
    /// Whether the current stage is actively producing events.
    pub stage_active: bool,

    /// Redis stream cursor for the current stage stream.
    poll_cursor: String,

    /// Buffer of tick entries received from Redis, pending broadcast.
    pub tick_buffer: VecDeque<TickEntry>,
    /// Index into `tick_buffer` tracking what has been broadcast so far.
    pub broadcast_cursor: usize,
    /// High watermark: the highest game tick seen from the current primary.
    pub high_water_tick: u32,

    /// Client ID of the primary recording client.
    pub primary_client_id: Option<u64>,
    /// Running count of events received from each client.
    pub client_event_counts: HashMap<u64, u64>,

    /// Generation counter, incremented on primary switch, new attempt, etc.
    pub generation: u64,

    /// Current lifecycle state of this reader.
    pub state: ReaderState,

    /// Active subscribers watching this challenge.
    pub subscribers: HashMap<SubscriberId, Subscriber>,

    /// Party member names.
    pub party: Vec<String>,
}

impl ChallengeReader {
    /// Creates a new reader for the given challenge.
    pub fn new(
        uuid: String,
        challenge_type: i32,
        mode: i32,
        stage: i32,
        stage_attempt: Option<u32>,
        party: Vec<String>,
    ) -> Self {
        let span = tracing::info_span!("reader", challenge_id = %uuid);
        Self {
            span,
            uuid,
            challenge_type,
            mode,
            stage,
            stage_attempt,
            stage_active: true,
            poll_cursor: "0-0".to_string(),
            tick_buffer: VecDeque::new(),
            broadcast_cursor: 0,
            high_water_tick: 0,
            primary_client_id: None,
            client_event_counts: HashMap::new(),
            generation: 0,
            state: ReaderState::Active,
            subscribers: HashMap::new(),
            party,
        }
    }

    pub fn uuid(&self) -> &str {
        &self.uuid
    }

    /// Returns the Redis queries needed to poll for new data.
    pub fn poll_queries(&self) -> Vec<RedisQuery> {
        if matches!(
            self.state,
            ReaderState::Backfilling | ReaderState::Completed
        ) {
            return Vec::new();
        }

        // Always check the challenge and clients to detect activity changes.
        let mut queries = vec![
            RedisQuery::ChallengeState {
                uuid: self.uuid.clone(),
            },
            RedisQuery::ChallengeClients {
                uuid: self.uuid.clone(),
            },
        ];

        if self.stage_active {
            queries.push(RedisQuery::StageStream {
                uuid: self.uuid.clone(),
                stage: self.stage,
                attempt: self.stage_attempt,
                cursor: self.poll_cursor.clone(),
            });
        }

        queries
    }

    /// Processes the Redis responses corresponding to this reader's queries.
    pub fn apply_poll_responses(&mut self, responses: Vec<RedisResponse>) {
        for response in responses {
            match response {
                RedisResponse::ChallengeState(Some(state)) => {
                    if state.stage != self.stage || state.stage_attempt != self.stage_attempt {
                        self.update_stage(state.stage, state.stage_attempt);
                    }
                }
                RedisResponse::ChallengeState(None) => {
                    self.finish_challenge();
                }
                RedisResponse::ChallengeClients(clients) => {
                    self.process_clients(&clients);
                }
                RedisResponse::StageStream(_stream) => {
                    // TODO(frolv): filter to primary client, deserialize proto,
                    // group by game tick, append to tick_buffer, advance poll_cursor.
                    // Update client_event_counts, detect primary silence.
                }
            }
        }
    }

    /// Handles a challenge update from the pubsub channel.
    pub fn apply_challenge_update(&mut self, update: &ChallengeServerUpdate) {
        match *update {
            ChallengeServerUpdate::StageEnd { stage, attempt, .. } => {
                if self.stage_active && stage == self.stage && attempt == self.stage_attempt {
                    self.broadcast_stage_end();
                }
            }
            ChallengeServerUpdate::Finish { .. } => {
                self.finish_challenge();
            }
        }
    }

    /// Broadcasts one tick's worth of events to live subscribers.
    ///
    /// Returns IDs of disconnected subscribers for cleanup.
    pub fn broadcast(&mut self) -> Vec<SubscriberId> {
        let _guard = self.span.enter();
        // TODO(frolv): Implement broadcast:
        // 1. Check jitter buffer depth, skip if not enough buffered.
        // 2. Pop one tick (or bundle for lag recovery).
        // 3. Send to each Live subscriber whose stage matches.
        // 4. Return disconnected subscriber IDs.
        Vec::new()
    }

    /// Adds a subscriber to this reader and sends it initial metadata.
    pub fn add_subscriber(&mut self, subscriber: Subscriber) {
        subscriber.send(SseMessage::Metadata {
            challenge_type: self.challenge_type,
            mode: self.mode,
            stage: self.stage,
            attempt: self.stage_attempt,
            stage_active: self.stage_active,
            party: self.party.clone(),
        });
        self.subscribers.insert(subscriber.id, subscriber);
    }

    /// Removes a subscriber by ID.
    pub fn remove_subscriber(&mut self, id: SubscriberId) {
        self.subscribers.remove(&id);
    }

    /// Returns `true` if this reader has any subscribers.
    pub fn has_subscribers(&self) -> bool {
        !self.subscribers.is_empty()
    }

    fn update_stage(&mut self, stage: i32, attempt: Option<u32>) {
        if self.stage_active {
            tracing::warn!(
                parent: &self.span,
                old_stage = self.stage,
                old_attempt = self.stage_attempt,
                "new stage started before receiving previous stage end"
            );
            self.broadcast_stage_end();
        }

        tracing::info!(parent: &self.span, stage, attempt, "stage started");

        self.stage = stage;
        self.stage_attempt = attempt;
        self.stage_active = true;
        self.tick_buffer.clear();
        self.broadcast_cursor = 0;
        self.high_water_tick = 0;
        self.state = ReaderState::Active;

        let message = SseMessage::StageChange { stage, attempt };
        self.send_to_all(&message);
    }

    fn process_clients(&mut self, clients: &HashMap<u64, ChallengeClient>) {
        if !self.stage_active || clients.is_empty() {
            return;
        }

        let all_completed = clients.values().all(|c| self.client_completed_stage(c));
        if all_completed {
            self.broadcast_stage_end();
        }

        // TODO(frolv): Detect primary changes, stall conditions.
    }

    /// Returns `true` if the client has completed the reader's current stage.
    fn client_completed_stage(&self, client: &ChallengeClient) -> bool {
        use std::cmp::Ordering;
        let lc = &client.last_completed;
        match lc.stage.cmp(&self.stage) {
            Ordering::Greater => true,
            Ordering::Less => false,
            Ordering::Equal => match self.stage_attempt {
                None => true,
                Some(n) => lc.attempt.is_some_and(|a| a >= n),
            },
        }
    }

    fn finish_challenge(&mut self) {
        if self.state == ReaderState::Completed {
            return;
        }

        tracing::info!(parent: &self.span, "challenge finished");

        if self.stage_active {
            self.broadcast_stage_end();
        }

        self.state = ReaderState::Completed;
        self.send_to_all(&SseMessage::Complete);
        self.subscribers.clear();
    }

    fn broadcast_stage_end(&mut self) {
        tracing::info!(
            parent: &self.span,
            stage = self.stage,
            attempt = self.stage_attempt,
            "stage ended",
        );

        self.stage_active = false;

        let msg = SseMessage::StageEnd {
            stage: self.stage,
            attempt: self.stage_attempt,
        };
        self.send_to_all(&msg);
    }

    /// Sends a message to all subscribers, removing any that have disconnected.
    fn send_to_all(&mut self, msg: &SseMessage) {
        // TODO(frolv): Don't clone serialized proto bytes.
        self.subscribers
            .retain(|_, subscriber| subscriber.send(msg.clone()));
    }
}

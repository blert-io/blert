use std::collections::{BTreeMap, HashMap, VecDeque};

use bytes::{Bytes, BytesMut};
use prost::Message as _;

use tokio::sync::mpsc;

use crate::backfill::{BackfillRequest, BackfillResult};
use crate::message::{ResetReason, SseMessage, StalledReason};
use crate::redis::{
    ChallengeClient, ChallengeServerUpdate, ChallengeState, RedisQuery, RedisResponse,
    STREAM_START_CURSOR, StageStatus, StageStreamEntry, proto,
};
use crate::subscriber::{Subscriber, SubscriberId, SubscriberState};

/// Lifecycle state of a `ChallengeReader`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReaderState {
    /// Fetching historical event data from Redis.
    /// Optionally stores the ID of the client whose data to backfill.
    Backfilling(Option<u64>),
    /// Polling for new events and broadcasting to subscribers.
    Active,
    /// All recording clients have disconnected.
    Stalled,
    /// The challenge has finished and is waiting for subscribers to drain.
    Completed,
}

/// State of the current stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StageState {
    /// No data is being streamed for this stage.
    Inactive,
    /// Data is actively being streamed for this stage.
    Active,
    /// The stream producer has completed, but there is still data buffered in
    /// the stream that needs to be drained. Transient state.
    Ending,
}

impl StageState {
    pub fn is_open(self) -> bool {
        self != StageState::Inactive
    }
}

/// A buffered tick entry pending broadcast.
#[derive(Debug, Clone)]
struct TickEntry {
    /// Game tick number.
    tick: u32,
    /// Serialized `EventStream` proto for this tick.
    data: Bytes,
}

/// Per-client tracking state maintained by a reader.
#[derive(Debug, Clone)]
struct ClientState {
    /// Whether this client is currently connected and recording.
    /// Synced from `ChallengeClients` on each poll cycle.
    active: bool,
    /// Running count of stream entries received from this client
    /// for the current stage.
    event_count: u64,
}

struct ReplayChunk {
    start_tick: u32,
    tick_count: u32,
    data: Bytes,
}

impl ReplayChunk {
    /// Maximum byte size of a single chunk. Reduced from max transmission size
    /// to account for base64 encoding overhead.
    const MAX_SIZE_BYTES: usize = 96 * 1024;

    fn end_tick(&self) -> u32 {
        self.start_tick + self.tick_count - 1
    }
}

/// Manages the state for a single live challenge being watched.
pub struct ChallengeReader {
    /// Tracing span for this reader — all log calls scoped with `challenge_id`.
    span: tracing::Span,

    /// Challenge UUID.
    uuid: String,
    /// Challenge type (proto enum value).
    challenge_type: i32,
    /// Challenge mode (proto enum value).
    mode: i32,

    /// Current stage of the challenge.
    stage: i32,
    /// Current stage attempt number (for retryable stages).
    stage_attempt: Option<u32>,
    /// State of the current stage.
    stage_state: StageState,

    /// Redis stream cursor for the current stage stream.
    poll_cursor: String,

    /// Contiguous buffer of tick data in the range `[0, high_water_tick]`,
    /// pending broadcast.
    tick_buffer: VecDeque<TickEntry>,
    /// Index into `tick_buffer` tracking what has been broadcast so far.
    broadcast_cursor: usize,
    /// High watermark: the highest game tick seen from the current primary.
    high_water_tick: u32,

    /// Client ID of the selected primary recording client for the challenge.
    primary_client_id: Option<u64>,
    /// Per-client tracking state, keyed by client ID.
    client_states: HashMap<u64, ClientState>,

    /// Generation counter, incremented on primary switch, new attempt, etc.
    generation: u64,

    /// Current lifecycle state of this reader.
    state: ReaderState,

    /// Active subscribers watching this challenge.
    subscribers: HashMap<SubscriberId, Subscriber>,

    /// Party member names.
    party: Vec<String>,

    /// Sender for submitting backfill requests.
    backfill_tx: mpsc::UnboundedSender<BackfillRequest>,

    /// Monotonic counter for backfill requests. Incremented each time a
    /// backfill is requested; results with a stale ID are discarded.
    backfill_id: u64,

    /// Buffer of prebuilt full-length replay chunks to send to new subscribers.
    /// Only stores complete chunks; the final partial chunk is built on demand.
    replay_chunks: Vec<ReplayChunk>,
}

impl ChallengeReader {
    /// Creates a new reader for the given challenge.
    pub fn new(
        uuid: String,
        state: ChallengeState,
        clients: &HashMap<u64, ChallengeClient>,
        backfill_tx: mpsc::UnboundedSender<BackfillRequest>,
    ) -> Self {
        let span = tracing::info_span!("reader", challenge_id = %uuid);

        let stage_active = clients
            .values()
            .any(|c| c.stage == state.stage && c.stage_status == StageStatus::Started);

        let client_states = clients
            .iter()
            .map(|(id, c)| {
                (
                    *id,
                    ClientState {
                        active: c.active,
                        event_count: 0,
                    },
                )
            })
            .collect();

        let mut reader = Self {
            span,
            uuid,
            challenge_type: state.challenge_type,
            mode: state.mode,
            stage: state.stage,
            stage_attempt: state.stage_attempt,
            stage_state: if stage_active {
                StageState::Active
            } else {
                StageState::Inactive
            },
            poll_cursor: STREAM_START_CURSOR.to_string(),
            tick_buffer: VecDeque::new(),
            broadcast_cursor: 0,
            high_water_tick: 0,
            primary_client_id: None,
            client_states,
            generation: 0,
            state: ReaderState::Backfilling(None),
            backfill_id: 0,
            subscribers: HashMap::new(),
            party: state.party,
            backfill_tx,
            replay_chunks: Vec::new(),
        };
        reader.request_backfill(None);
        reader
    }

    /// Returns the Redis queries needed to poll for new data.
    pub fn poll_queries(&self) -> Vec<RedisQuery> {
        if matches!(
            self.state,
            ReaderState::Backfilling(_) | ReaderState::Completed
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

        if self.stage_state.is_open() {
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
        let queried_stage = self.stage;
        let queried_attempt = self.stage_attempt;
        let mut stream_entries: Option<Vec<StageStreamEntry>> = None;

        for response in responses {
            match response {
                RedisResponse::ChallengeState(Some(state)) => {
                    if state.stage != self.stage || state.stage_attempt != self.stage_attempt {
                        self.begin_stage(state.stage, state.stage_attempt);
                    }
                }
                RedisResponse::ChallengeState(None) => {
                    self.finish_challenge();
                }
                RedisResponse::ChallengeClients(clients) => {
                    self.process_clients(&clients);
                }
                RedisResponse::StageStream(entries) => {
                    // Stream entries must be processed after state updates.
                    stream_entries = Some(entries);
                }
            }
        }

        if let Some(entries) = stream_entries {
            if self.stage == queried_stage && self.stage_attempt == queried_attempt {
                self.process_stream_entries(&entries);
            } else {
                tracing::warn!(
                    parent: &self.span,
                    queried_stage,
                    queried_attempt,
                    current_stage = self.stage,
                    current_attempt = self.stage_attempt,
                    entry_count = entries.len(),
                    "discarding stale stage stream response after stage transition",
                );
            }
        }
    }

    /// Handles a challenge update from the pubsub channel.
    pub fn apply_challenge_update(&mut self, update: &ChallengeServerUpdate) {
        match *update {
            ChallengeServerUpdate::StageEnd { stage, attempt, .. } => {
                if self.stage_state == StageState::Active
                    && stage == self.stage
                    && attempt == self.stage_attempt
                {
                    self.stage_state = StageState::Ending;
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
        let available = self.tick_buffer.len() - self.broadcast_cursor;

        // Hold the last tick: it may be incomplete due to the plugin's
        // flush-on-tick-boundary behavior (straggler merges next cycle).
        // When the stage is ending, flush everything as no next tick is coming.
        // TODO(frolv): Implement proper jitter buffer (trail by 2-3 ticks).
        if available <= 1 && self.stage_state != StageState::Ending {
            return Vec::new();
        }

        // Basic lag recovery: if the buffer is too deep, skip ahead to near-live.
        // Once replay is implemented, the skipped history will be sent via
        // replay-chunks instead.
        if available > 5 {
            self.broadcast_cursor = self.tick_buffer.len() - 2;
        }

        let mut disconnected = Vec::new();

        if self.broadcast_cursor < self.tick_buffer.len() {
            let entry = self.tick_buffer[self.broadcast_cursor].clone();
            self.broadcast_cursor += 1;

            let msg = SseMessage::Tick {
                generation: self.generation,
                tick: entry.tick,
                tick_count: 1,
                data: entry.data,
            };

            for (id, subscriber) in &self.subscribers {
                if subscriber.state == SubscriberState::Live
                    && subscriber.requested_stage == Some(self.stage)
                    && !subscriber.send(msg.clone())
                {
                    disconnected.push(*id);
                }
            }
        }

        // Finalize the stage only after the buffer is fully drained.
        // Draining one tick per cycle preserves smooth playback rather than
        // batching remaining ticks.
        //
        // If a fast stage transition preempts the drain, the remaining ticks
        // are discarded from the live view. The client can recover during
        // loading of the processed static stage data.
        if self.stage_state == StageState::Ending && self.broadcast_cursor >= self.tick_buffer.len()
        {
            self.finish_stage();
        }

        disconnected
    }

    /// Applies a completed backfill result to this reader.
    pub fn apply_backfill(&mut self, result: BackfillResult) {
        let pre_selected_primary = match self.state {
            ReaderState::Backfilling(primary) if result.backfill_id == self.backfill_id => primary,
            _ => return,
        };

        // Count events per client for primary selection and future use.
        for entry in &result.entries {
            self.client_states
                .entry(entry.client_id)
                .or_insert(ClientState {
                    active: false,
                    event_count: 0,
                })
                .event_count += 1;
        }

        self.primary_client_id = pre_selected_primary;
        if self.primary_client_id.is_none() {
            self.select_primary_client(None);
        }

        // If all clients are inactive and no primary is selected, some data is
        // still needed for replay. Pick whatever is best out of the available
        // streams without committing to any new primary.
        let backfill_source = self.primary_client_id.or_else(|| {
            self.client_states
                .iter()
                .max_by_key(|(_, s)| s.event_count)
                .map(|(id, _)| *id)
        });

        if let Some(source) = backfill_source
            && let Some(rebuild_from) = self.ingest_entries(&result.entries, source)
        {
            self.build_replay_chunks(rebuild_from);
        }

        // All backfill data is history; broadcast starts from the end.
        self.broadcast_cursor = self.tick_buffer.len();
        self.poll_cursor = result.last_stream_id;
        self.state = ReaderState::Active;

        tracing::info!(
            parent: &self.span,
            ticks = self.tick_buffer.len(),
            primary = self.primary_client_id,
            "backfill applied",
        );

        // Replay to all subscribers viewing this stage.
        let replay = self.build_replay_messages(ResetReason::Reconnect);
        for subscriber in self.subscribers.values_mut() {
            if subscriber.requested_stage == Some(self.stage) {
                for msg in &replay {
                    subscriber.send(msg.clone());
                }
            }
            subscriber.state = SubscriberState::Live;
        }
    }

    /// Sends a backfill request for the current stage.
    ///
    /// If `primary` is `None`, selects a primary based on the received events.
    /// Otherwise, filters to events from the provided primary client.
    fn request_backfill(&mut self, primary: Option<u64>) {
        tracing::info!(
            parent: &self.span,
            new_primary = primary,
            "requesting backfill",
        );

        self.state = ReaderState::Backfilling(primary);
        self.backfill_id += 1;
        let _ = self.backfill_tx.send(BackfillRequest {
            challenge_id: self.uuid.clone(),
            backfill_id: self.backfill_id,
            stage: self.stage,
            attempt: self.stage_attempt,
        });
    }

    /// Adds a subscriber to this reader and sends it initial metadata.
    pub fn add_subscriber(&mut self, mut subscriber: Subscriber) {
        subscriber.send(SseMessage::Metadata {
            challenge_type: self.challenge_type,
            mode: self.mode,
            stage: self.stage,
            attempt: self.stage_attempt,
            stage_active: self.stage_state.is_open(),
            party: self.party.clone(),
        });

        match self.state {
            ReaderState::Active | ReaderState::Stalled => {
                // Send cached replay if the subscriber wants this stage.
                if subscriber.requested_stage == Some(self.stage) && !self.tick_buffer.is_empty() {
                    for msg in self.build_replay_messages(ResetReason::Reconnect) {
                        subscriber.send(msg);
                    }
                }
                subscriber.state = SubscriberState::Live;
            }
            ReaderState::Backfilling(_) => {
                // Subscriber stays Replaying until backfill completes.
            }
            ReaderState::Completed => {
                subscriber.send(SseMessage::Complete);
                return;
            }
        }

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

    /// Processes stream entries from an incremental poll: counts events,
    /// advances the cursor, and ingests the primary's events into the buffer.
    fn process_stream_entries(&mut self, entries: &[StageStreamEntry]) {
        if entries.is_empty() {
            return;
        }

        // Advance the poll cursor past all entries, regardless of client.
        if let Some(last) = entries.last() {
            self.poll_cursor.clone_from(&last.id);
        }

        // Always count events per client, even without a primary — needed
        // for primary selection on the next poll or backfill application.
        for entry in entries {
            self.client_states
                .entry(entry.client_id)
                .or_insert(ClientState {
                    active: false,
                    event_count: 0,
                })
                .event_count += 1;
        }

        if let Some(primary) = self.primary_client_id
            && let Some(rebuild_from) = self.ingest_entries(entries, primary)
        {
            self.build_replay_chunks(rebuild_from);
        }
    }

    /// Decodes a specific client's events from stream entries and appends them
    /// to the tick buffer, grouped by game tick.
    ///
    /// Following this function, the tick buffer is guaranteed to be contiguous
    /// between 0 and `high_water_tick`, with missing ticks populated as empty
    /// entries.
    fn ingest_entries(&mut self, entries: &[StageStreamEntry], client_id: u64) -> Option<u32> {
        let mut by_tick: BTreeMap<u32, Vec<proto::Event>> = BTreeMap::new();

        for entry in entries.iter().filter(|e| e.client_id == client_id) {
            // Redis encodes ChallengeEvents, but EventStream is wire-compatible
            // for field 1 (repeated Event). Extra fields are silently ignored.
            let event_stream = match proto::EventStream::decode(entry.events.as_slice()) {
                Ok(es) => es,
                Err(e) => {
                    tracing::warn!(parent: &self.span, "failed to decode protobuf: {e}");
                    continue;
                }
            };

            for event in event_stream.events {
                by_tick.entry(event.tick).or_default().push(event);
            }
        }

        if by_tick.is_empty() {
            return None;
        }

        let mut dirty_from: Option<u32> = None;

        for (tick, events) in by_tick {
            // If the tick is already in the buffer, merge into it.
            if let Some(existing) = self.tick_buffer.get_mut(tick as usize) {
                let mut merged = match proto::EventStream::decode(existing.data.as_ref()) {
                    Ok(es) => es.events,
                    Err(_) => Vec::new(),
                };
                merged.extend(events);
                existing.data = proto::EventStream { events: merged }.encode_to_vec().into();
                dirty_from = Some(dirty_from.map_or(tick, |d: u32| d.min(tick)));
                continue;
            }

            // Gap-fill: insert empty entries for any missing ticks to
            // maintain contiguity.
            #[allow(clippy::cast_possible_truncation)]
            let expected_next = self.tick_buffer.len() as u32;
            for gap_tick in expected_next..tick {
                self.tick_buffer.push_back(TickEntry {
                    tick: gap_tick,
                    data: Bytes::new(),
                });
            }

            self.high_water_tick = tick;
            self.tick_buffer.push_back(TickEntry {
                tick,
                data: proto::EventStream { events }.encode_to_vec().into(),
            });
            dirty_from = dirty_from.or(Some(tick));
        }

        dirty_from
    }

    /// Selects a new primary client from `client_states`, optionally excluding
    /// the client specified by `exclude`.
    fn select_primary_client(&mut self, exclude: Option<u64>) {
        // Simple heuristic: pick the active client with the highest event count
        // for the current stage.
        let best = self
            .client_states
            .iter()
            .filter(|(id, _)| exclude.is_none_or(|e| e != **id))
            .filter(|(_, s)| s.active)
            .max_by_key(|(_, s)| s.event_count)
            .map(|(id, _)| *id);

        if let Some(client_id) = best {
            tracing::info!(parent: &self.span, client_id, "selected primary client");
            self.primary_client_id = Some(client_id);
        } else {
            tracing::warn!(parent: &self.span, "no primary client found");
        }
    }

    fn begin_stage(&mut self, stage: i32, attempt: Option<u32>) {
        match self.stage_state {
            StageState::Active => {
                tracing::error!(
                    parent: &self.span,
                    old_stage = self.stage,
                    old_attempt = self.stage_attempt,
                    "new stage started while stage was active"
                );
                self.finish_stage();
            }
            StageState::Ending => {
                tracing::warn!(
                    parent: &self.span,
                    old_stage = self.stage,
                    old_attempt = self.stage_attempt,
                    ticks_discarded = self.tick_buffer.len() - self.broadcast_cursor,
                    "new stage started before old stage finished draining"
                );
                self.finish_stage();
            }
            StageState::Inactive => {}
        }

        tracing::info!(parent: &self.span, stage, attempt, "stage started");

        self.stage = stage;
        self.stage_attempt = attempt;
        self.stage_state = StageState::Active;
        self.tick_buffer.clear();
        self.broadcast_cursor = 0;
        self.high_water_tick = 0;
        self.poll_cursor = STREAM_START_CURSOR.to_string();
        self.state = ReaderState::Active;
        self.replay_chunks.clear();
        for state in self.client_states.values_mut() {
            state.event_count = 0;
        }

        let message = SseMessage::StageChange { stage, attempt };
        self.send_to_all(&message);
    }

    fn process_clients(&mut self, clients: &HashMap<u64, ChallengeClient>) {
        // Sync active status into client_states from the latest poll data.
        for (id, client) in clients {
            self.client_states
                .entry(*id)
                .or_insert(ClientState {
                    active: false,
                    event_count: 0,
                })
                .active = client.active;
        }

        // Clients absent from the poll are no longer connected.
        for (id, state) in &mut self.client_states {
            if !clients.contains_key(id) {
                state.active = false;
            }
        }

        if !self.stage_state.is_open() {
            // Detect when clients start the current stage.
            //
            // This runs following the `ChallengeState` update, so the challenge
            // changing stage takes priority. This primarily handles the initial
            // stage of a challenge, where the challenge's stage number doesn't
            // change but client status does.
            let stage_started = clients
                .values()
                .any(|c| c.stage == self.stage && c.stage_status == StageStatus::Started);
            if stage_started {
                tracing::info!(
                    parent: &self.span,
                    stage = self.stage,
                    attempt = self.stage_attempt,
                    "stage became active",
                );
                self.begin_stage(self.stage, self.stage_attempt);
            } else {
                return;
            }
        }

        if clients.is_empty() {
            self.stall(StalledReason::NoClients);
            return;
        }

        let all_completed = clients.values().all(|c| self.client_completed_stage(c));
        if all_completed {
            self.stage_state = StageState::Ending;
            return;
        }

        if !clients.values().any(|client| client.active) {
            self.stall(StalledReason::AllInactive);
            return;
        }

        if self.state == ReaderState::Stalled {
            tracing::info!(parent: &self.span, "recording resumed");
            self.state = ReaderState::Active;
        }

        if self.primary_client_id.is_none() {
            self.select_primary_client(None);
        }

        // TODO(frolv): handle primary client change
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

        if self.stage_state.is_open() {
            self.finish_stage();
        }

        self.state = ReaderState::Completed;
        self.send_to_all(&SseMessage::Complete);
        self.subscribers.clear();
    }

    fn finish_stage(&mut self) {
        tracing::info!(
            parent: &self.span,
            stage = self.stage,
            attempt = self.stage_attempt,
            "stage ended",
        );

        self.stage_state = StageState::Inactive;

        let msg = SseMessage::StageEnd {
            stage: self.stage,
            attempt: self.stage_attempt,
        };
        self.send_to_all(&msg);
    }

    fn stall(&mut self, reason: StalledReason) {
        if self.state == ReaderState::Stalled {
            return;
        }

        tracing::warn!(parent: &self.span, reason = %reason.to_string(), "reader stalled");
        self.state = ReaderState::Stalled;
        self.send_to_all(&SseMessage::Stalled { reason });

        // TODO(frolv): and then what?
    }

    /// Builds the full replay message sequence:
    /// `reset` -> one or more `replay-chunk` -> `replay-end`.
    ///
    /// Uses cached complete chunks plus a trailing partial chunk built on
    /// demand from the remaining tick buffer entries.
    fn build_replay_messages(&self, reason: ResetReason) -> Vec<SseMessage> {
        #![allow(clippy::cast_possible_truncation)]

        let generation = self.generation;
        let mut messages = Vec::with_capacity(self.replay_chunks.len() + 3);

        messages.push(SseMessage::Reset {
            reason,
            stage: self.stage,
            attempt: self.stage_attempt,
            stage_active: self.stage_state.is_open(),
            generation,
        });

        for chunk in &self.replay_chunks {
            messages.push(SseMessage::ReplayChunk {
                generation,
                start_tick: chunk.start_tick,
                tick_count: chunk.tick_count,
                data: chunk.data.clone(),
            });
        }

        // Create trailing partial chunk from everything after the last cached chunk.
        let tail_start = self
            .replay_chunks
            .last()
            .map_or(0, |c| (c.end_tick() + 1) as usize);
        if tail_start < self.tick_buffer.len() {
            let tick_count = self.tick_buffer.len() - tail_start;
            let mut data = BytesMut::new();
            for i in tail_start..self.tick_buffer.len() {
                data.extend_from_slice(&self.tick_buffer[i].data);
            }
            messages.push(SseMessage::ReplayChunk {
                generation,
                start_tick: tail_start as u32,
                tick_count: tick_count as u32,
                data: data.into(),
            });
        }

        let last_tick = self.tick_buffer.len().saturating_sub(1) as u32;
        messages.push(SseMessage::ReplayEnd {
            generation,
            tick: last_tick,
        });

        messages
    }

    /// Sends a message to all subscribers, removing any that have disconnected.
    fn send_to_all(&mut self, msg: &SseMessage) {
        self.subscribers
            .retain(|_, subscriber| subscriber.send(msg.clone()));
    }

    fn build_replay_chunks(&mut self, from_tick: u32) {
        if self.tick_buffer.is_empty() {
            self.replay_chunks.clear();
            return;
        }

        let mut start_tick = self
            .replay_chunks
            .iter()
            .find_map(|c| {
                if from_tick >= c.start_tick && from_tick <= c.end_tick() {
                    Some(c.start_tick)
                } else {
                    None
                }
            })
            .unwrap_or_else(|| self.replay_chunks.last().map_or(0, |c| c.end_tick() + 1));
        self.replay_chunks.retain(|c| c.end_tick() < start_tick);

        let mut size_bytes = 0;

        for entry in self.tick_buffer.iter().skip(start_tick as usize) {
            if size_bytes > 0 && size_bytes + entry.data.len() > ReplayChunk::MAX_SIZE_BYTES {
                let mut data = BytesMut::with_capacity(size_bytes);
                for i in start_tick..entry.tick {
                    data.extend_from_slice(&self.tick_buffer[i as usize].data);
                }

                self.replay_chunks.push(ReplayChunk {
                    start_tick,
                    tick_count: entry.tick - start_tick,
                    data: data.into(),
                });
                start_tick = entry.tick;
                size_bytes = 0;
            }

            size_bytes += entry.data.len();
        }

        // Final chunk is built on demand.
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use tokio::sync::mpsc;

    use super::*;

    fn challenge_state(stage: i32, attempt: Option<u32>) -> ChallengeState {
        ChallengeState {
            status: crate::redis::ChallengeStatus::InProgress,
            challenge_type: 1,
            mode: 0,
            stage,
            stage_attempt: attempt,
            party: vec!["Skitter".to_string()],
        }
    }

    fn challenge_client(
        client_id: u64,
        active: bool,
        stage: i32,
        attempt: Option<u32>,
        stage_status: StageStatus,
    ) -> ChallengeClient {
        ChallengeClient {
            user_id: client_id,
            client_id,
            recording_type: crate::redis::RecordingType::Participant,
            active,
            stage,
            stage_attempt: attempt,
            stage_status,
            last_completed: crate::redis::LastCompleted {
                stage: stage.saturating_sub(1),
                attempt: None,
            },
        }
    }

    fn stream_entry(id: &str, client_id: u64, tick: u32) -> StageStreamEntry {
        StageStreamEntry {
            id: id.to_string(),
            client_id,
            events: proto::EventStream {
                events: vec![proto::Event {
                    tick,
                    ..Default::default()
                }],
            }
            .encode_to_vec(),
        }
    }

    fn new_active_reader(stage: i32, attempt: Option<u32>) -> ChallengeReader {
        let (backfill_tx, _backfill_rx) = mpsc::unbounded_channel();
        let clients = HashMap::from([(
            1,
            challenge_client(1, true, stage, attempt, StageStatus::Started),
        )]);
        let mut reader = ChallengeReader::new(
            "challenge-id".to_string(),
            challenge_state(stage, attempt),
            &clients,
            backfill_tx,
        );
        reader.state = ReaderState::Active;
        reader.primary_client_id = Some(1);
        reader
    }

    #[test]
    fn new_reader_starts_backfilling_and_sends_request() {
        let (backfill_tx, mut backfill_rx) = mpsc::unbounded_channel();
        let clients =
            HashMap::from([(1, challenge_client(1, true, 10, None, StageStatus::Started))]);

        let reader = ChallengeReader::new(
            "test-uuid".to_string(),
            challenge_state(10, None),
            &clients,
            backfill_tx,
        );

        assert!(matches!(reader.state, ReaderState::Backfilling(None)));
        assert_eq!(reader.backfill_id, 1);

        let req = backfill_rx.try_recv().unwrap();
        assert_eq!(req.challenge_id, "test-uuid");
        assert_eq!(req.backfill_id, 1);
        assert_eq!(req.stage, 10);
    }

    #[test]
    fn apply_poll_responses_ignores_stale_stage_stream_after_stage_change() {
        let mut reader = new_active_reader(1, None);

        let clients =
            HashMap::from([(1, challenge_client(1, true, 2, None, StageStatus::Started))]);

        reader.apply_poll_responses(vec![
            RedisResponse::ChallengeState(Some(challenge_state(2, None))),
            RedisResponse::ChallengeClients(clients),
            RedisResponse::StageStream(vec![stream_entry("1-0", 1, 3)]),
        ]);

        assert_eq!(reader.stage, 2);
        assert_eq!(reader.stage_attempt, None);
        assert!(reader.tick_buffer.is_empty());
        assert_eq!(reader.poll_cursor, STREAM_START_CURSOR);
    }

    #[test]
    fn apply_poll_responses_processes_current_stage_stream_entries() {
        let mut reader = new_active_reader(1, None);

        let clients =
            HashMap::from([(1, challenge_client(1, true, 1, None, StageStatus::Started))]);

        reader.apply_poll_responses(vec![
            RedisResponse::ChallengeState(Some(challenge_state(1, None))),
            RedisResponse::ChallengeClients(clients),
            RedisResponse::StageStream(vec![stream_entry("1-0", 1, 3)]),
        ]);

        assert_eq!(reader.poll_cursor, "1-0");
        assert_eq!(reader.tick_buffer.len(), 4);
        assert_eq!(reader.tick_buffer[3].tick, 3);
    }

    #[test]
    fn ingest_entries_gap_fills_for_contiguity() {
        let mut reader = new_active_reader(1, None);

        // First event is for tick 3.
        let entries = vec![stream_entry("1-0", 1, 3)];
        let dirty = reader.ingest_entries(&entries, 1);

        assert_eq!(reader.tick_buffer.len(), 4);
        for tick in 0..3 {
            assert_eq!(reader.tick_buffer[tick].tick as usize, tick);
            assert!(reader.tick_buffer[tick].data.is_empty());
        }
        assert_eq!(reader.tick_buffer[3].tick, 3);
        assert!(!reader.tick_buffer[3].data.is_empty());
        assert_eq!(dirty, Some(3));
    }

    #[test]
    fn ingest_entries_merges_into_existing_tick() {
        let mut reader = new_active_reader(1, None);

        // Ingest tick 2, then merge more events into it.
        reader.ingest_entries(&[stream_entry("1-0", 1, 2)], 1);
        assert_eq!(reader.tick_buffer.len(), 3);
        let original_size = reader.tick_buffer[2].data.len();

        let dirty = reader.ingest_entries(&[stream_entry("2-0", 1, 2)], 1);
        assert_eq!(reader.tick_buffer.len(), 3); // No new entries.
        assert!(reader.tick_buffer[2].data.len() > original_size); // Data merged.
        assert_eq!(dirty, Some(2));
    }

    /// Drain all messages from a subscriber's channel.
    fn drain_messages(rx: &mut mpsc::UnboundedReceiver<SseMessage>) -> Vec<SseMessage> {
        std::iter::from_fn(|| rx.try_recv().ok()).collect()
    }

    #[test]
    fn new_subscriber_gets_replay_from_active_reader() {
        let mut reader = new_active_reader(1, None);

        // Populate tick buffer.
        let entries: Vec<_> = (1..=3)
            .map(|t| stream_entry(&format!("{t}-0"), 1, t))
            .collect();
        reader.process_stream_entries(&entries);

        // New subscriber connects after data exists.
        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(1), tx));

        let msgs = drain_messages(&mut rx);
        assert!(msgs.len() >= 4);
        assert!(matches!(msgs[0], SseMessage::Metadata { .. }));
        assert!(matches!(msgs[1], SseMessage::Reset { .. }));
        assert!(matches!(msgs.last().unwrap(), SseMessage::ReplayEnd { .. }));
    }

    #[test]
    fn backfill_completes_and_replays_to_subscriber() {
        let (backfill_tx, _rx) = mpsc::unbounded_channel();
        let clients = HashMap::from([
            (1, challenge_client(1, true, 1, None, StageStatus::Started)),
            (2, challenge_client(2, true, 1, None, StageStatus::Started)),
        ]);
        let mut reader = ChallengeReader::new(
            "test".to_string(),
            challenge_state(1, None),
            &clients,
            backfill_tx,
        );

        // Subscriber added while backfilling only gets metadata.
        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(1), tx));
        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 1);
        assert!(matches!(msgs[0], SseMessage::Metadata { .. }));

        // Backfill result selects an initial primary client.
        assert_eq!(reader.primary_client_id, None);
        let result = BackfillResult {
            challenge_id: "test".to_string(),
            backfill_id: reader.backfill_id,
            entries: vec![
                stream_entry("1-0", 1, 1),
                stream_entry("2-0", 2, 1),
                stream_entry("3-0", 2, 2),
                stream_entry("4-0", 2, 3),
            ],
            last_stream_id: "4-0".to_string(),
        };
        reader.apply_backfill(result);

        assert_eq!(reader.state, ReaderState::Active);
        assert_eq!(reader.primary_client_id, Some(2));

        // A new subscriber receives a replay of the backfilled data.
        let msgs = drain_messages(&mut rx);
        assert!(msgs.len() >= 3);
        assert!(matches!(msgs[0], SseMessage::Reset { .. }));
        assert!(matches!(msgs.last().unwrap(), SseMessage::ReplayEnd { .. }));
        for msg in &msgs[1..msgs.len() - 1] {
            assert!(matches!(msg, SseMessage::ReplayChunk { .. }));
        }
    }

    #[test]
    fn stale_backfill_is_rejected() {
        let (backfill_tx, _rx) = mpsc::unbounded_channel();
        let clients =
            HashMap::from([(1, challenge_client(1, true, 1, None, StageStatus::Started))]);
        let mut reader = ChallengeReader::new(
            "test".to_string(),
            challenge_state(1, None),
            &clients,
            backfill_tx,
        );

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(1), tx));
        drain_messages(&mut rx); // Consume metadata.

        // Send result with wrong backfill ID.
        reader.apply_backfill(BackfillResult {
            challenge_id: "test".to_string(),
            backfill_id: 99,
            entries: vec![stream_entry("1-0", 1, 1)],
            last_stream_id: "1-0".to_string(),
        });

        assert!(matches!(reader.state, ReaderState::Backfilling(_)));
        assert!(drain_messages(&mut rx).is_empty());
    }

    #[test]
    fn completion_during_backfill_notifies_subscribers() {
        let (backfill_tx, _rx) = mpsc::unbounded_channel();
        let clients =
            HashMap::from([(1, challenge_client(1, true, 1, None, StageStatus::Started))]);
        let mut reader = ChallengeReader::new(
            "test".to_string(),
            challenge_state(1, None),
            &clients,
            backfill_tx,
        );

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(1), tx));
        drain_messages(&mut rx);

        reader.apply_challenge_update(&ChallengeServerUpdate::Finish {
            id: "test".to_string(),
        });

        assert_eq!(reader.state, ReaderState::Completed);
        let msgs = drain_messages(&mut rx);
        assert!(matches!(msgs.last().unwrap(), SseMessage::Complete));

        assert!(reader.subscribers.is_empty());

        // The late backfill result is rejected.
        reader.apply_backfill(BackfillResult {
            challenge_id: "test".to_string(),
            backfill_id: 1,
            entries: vec![stream_entry("1-0", 1, 1)],
            last_stream_id: "1-0".to_string(),
        });
        assert_eq!(reader.state, ReaderState::Completed);
    }

    #[test]
    fn backfill_with_inactive_clients_populates_buffer_without_primary() {
        let (backfill_tx, _rx) = mpsc::unbounded_channel();
        let clients =
            HashMap::from([(1, challenge_client(1, false, 1, None, StageStatus::Started))]);
        let mut reader = ChallengeReader::new(
            "test".to_string(),
            challenge_state(1, None),
            &clients,
            backfill_tx,
        );

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(1), tx));
        drain_messages(&mut rx);

        assert_eq!(reader.primary_client_id, None);

        reader.apply_backfill(BackfillResult {
            challenge_id: "test".to_string(),
            backfill_id: reader.backfill_id,
            entries: vec![stream_entry("1-0", 1, 1), stream_entry("2-0", 1, 2)],
            last_stream_id: "2-0".to_string(),
        });

        // The backfill result is applied and sent to subscribers, but no
        // primary client is selected.
        assert_eq!(reader.state, ReaderState::Active);
        assert_eq!(reader.primary_client_id, None);
        assert_eq!(reader.tick_buffer.len(), 3);

        let msgs = drain_messages(&mut rx);
        assert!(msgs.len() >= 3);
        assert!(matches!(msgs[0], SseMessage::Reset { .. }));
    }

    #[test]
    fn stage_ending_drains_all_ticks_before_stage_end() {
        let mut reader = new_active_reader(1, None);

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(1), tx));
        drain_messages(&mut rx);

        // Ingest ticks 1-3.
        let entries: Vec<_> = (1..=3)
            .map(|t| stream_entry(&format!("{t}-0"), 1, t))
            .collect();
        reader.process_stream_entries(&entries);

        // Broadcast one tick during normal operation.
        reader.broadcast();
        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 1);
        assert!(matches!(msgs[0], SseMessage::Tick { .. }));

        // Stage enters Ending state.
        reader.stage_state = StageState::Ending;

        // Buffer continues to drain tick-by-tick.
        let mut tick_count = 0;
        while reader.stage_state == StageState::Ending {
            reader.broadcast();
            tick_count += 1;
        }

        // Subscriber receives all remaining ticks, then the stage-end message.
        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), tick_count + 1);
        for msg in &msgs[..tick_count] {
            assert!(matches!(msg, SseMessage::Tick { .. }));
        }
        assert!(matches!(msgs[tick_count], SseMessage::StageEnd { .. }));
    }

    #[test]
    fn add_subscriber_on_completed_reader_sends_complete_and_discards() {
        let mut reader = new_active_reader(1, None);
        reader.state = ReaderState::Completed;

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(42, Some(1), tx));

        assert!(reader.subscribers.is_empty());
        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 2);
        assert!(matches!(msgs[0], SseMessage::Metadata { .. }));
        assert!(matches!(msgs[1], SseMessage::Complete));
    }

    #[test]
    fn process_clients_detects_first_stage_activation() {
        let (backfill_tx, _rx) = mpsc::unbounded_channel();
        let clients =
            HashMap::from([(1, challenge_client(1, true, 10, None, StageStatus::Entered))]);
        let mut reader = ChallengeReader::new(
            "test".to_string(),
            challenge_state(10, None),
            &clients,
            backfill_tx,
        );
        reader.state = ReaderState::Active;

        assert_eq!(reader.stage_state, StageState::Inactive);

        let started_clients =
            HashMap::from([(1, challenge_client(1, true, 10, None, StageStatus::Started))]);
        reader.process_clients(&started_clients);

        assert_eq!(reader.stage_state, StageState::Active);
    }
}

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

/// Jitter buffer depth: broadcast cursor trails poll cursor by this many ticks.
/// Prevents broadcasting incomplete ticks whose data arrives across poll
/// boundaries due to the plugin's flush-on-tick-boundary behavior.
const JITTER_DEPTH: usize = 2;

/// If the buffer exceeds jitter depth by this many ticks, trigger lag recovery
/// by bundling multiple ticks into a single message.
const LAG_THRESHOLD: usize = 3;

/// Number of broadcast ticks without new events before considering a client
/// silent. At 600ms per tick, 5 ticks = 3 seconds.
const SILENCE_THRESHOLD: u64 = 5;

/// Lifecycle state of a `ChallengeReader`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReaderState {
    /// Fetching historical event data from Redis.
    /// Optionally stores the ID of the client whose data to backfill.
    Backfilling(Option<u64>),
    /// Polling for new events and broadcasting to subscribers.
    Active,
    /// All recording clients have disconnected.
    Stalled { reason: StalledReason, since: u64 },
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
    /// The global broadcast tick at which this client last sent stream events.
    /// Used to identify clients which have stopped transmitting for primary
    /// switching.
    last_active_tick: u64,
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
    /// Tracing span for this reader, scoping logs with `uuid`.
    span: tracing::Span,

    uuid: String,
    challenge_type: proto::Challenge,
    challenge_mode: i32,

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
                        last_active_tick: 0,
                    },
                )
            })
            .collect();

        let mut reader = Self {
            span,
            uuid,
            challenge_type: proto::Challenge::try_from(state.challenge_type)
                .unwrap_or(proto::Challenge::UnknownChallenge),
            challenge_mode: state.mode,
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
    ///
    /// `tick` is the global broadcast tick from the manager, used for
    /// silence-based primary switching.
    pub fn apply_poll_responses(&mut self, responses: Vec<RedisResponse>, tick: u64) {
        if self.state == ReaderState::Completed {
            return;
        }

        let queried_stage = self.stage;
        let queried_attempt = self.stage_attempt;
        let mut stream_entries: Option<Vec<StageStreamEntry>> = None;

        for response in responses {
            match response {
                RedisResponse::ChallengeState(Some(state)) => {
                    if state.stage != self.stage || state.stage_attempt != self.stage_attempt {
                        self.begin_stage(tick, state.stage, state.stage_attempt);
                    }
                }
                RedisResponse::ChallengeState(None) => {
                    self.finish_challenge();
                }
                RedisResponse::ChallengeClients(clients) => {
                    self.process_clients(&clients, tick);
                }
                RedisResponse::StageStream(entries) => {
                    // Stream entries must be processed after state updates.
                    stream_entries = Some(entries);
                }
            }
        }

        // `process_clients` could have triggered a state change from active, in
        // which case the stream entries are stale.
        if self.state == ReaderState::Active
            && let Some(entries) = stream_entries
        {
            if self.stage == queried_stage && self.stage_attempt == queried_attempt {
                self.process_stream_entries(&entries, tick);
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

        // Gauge the primary's health after processing the stream, so that it
        // reflects data received in this poll.
        self.update_primary(tick);
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

    /// Broadcasts events to live subscribers.
    ///
    /// Normally sends one tick per cycle. During lag recovery, bundles multiple
    /// ticks to catch up to the live edge.
    ///
    /// Returns IDs of disconnected subscribers for cleanup.
    #[allow(clippy::cast_possible_truncation)]
    pub fn broadcast(&mut self) -> Vec<SubscriberId> {
        let available = self.tick_buffer.len() - self.broadcast_cursor;

        // Hold back `JITTER_DEPTH` ticks so the plugin's flush-on-tick-boundary
        // stragglers merge before broadcast. When the stage is ending, drain
        // everything as no more ticks are coming.
        let min_buffer = if self.stage_state == StageState::Ending {
            1
        } else {
            JITTER_DEPTH + 1
        };

        if available < min_buffer {
            // If ending with an empty buffer, finalize immediately.
            if self.stage_state == StageState::Ending && available == 0 {
                self.finish_stage();
            }
            return Vec::new();
        }

        let ticks_to_send =
            if self.stage_state != StageState::Ending && available > JITTER_DEPTH + LAG_THRESHOLD {
                available - JITTER_DEPTH
            } else {
                1
            };

        let mut disconnected = Vec::new();

        let first = &self.tick_buffer[self.broadcast_cursor];
        let msg = if ticks_to_send == 1 {
            let entry = first.clone();
            self.broadcast_cursor += 1;
            SseMessage::Tick {
                generation: self.generation,
                tick: entry.tick,
                tick_count: 1,
                data: entry.data,
            }
        } else {
            crate::metrics::LAG_RECOVERIES_TOTAL.inc();
            let start_tick = first.tick;
            let mut combined = BytesMut::new();
            for i in 0..ticks_to_send {
                combined.extend_from_slice(&self.tick_buffer[self.broadcast_cursor + i].data);
            }
            self.broadcast_cursor += ticks_to_send;
            SseMessage::Tick {
                generation: self.generation,
                tick: start_tick,
                tick_count: ticks_to_send as u32,
                data: combined.into(),
            }
        };

        for (id, subscriber) in &self.subscribers {
            if subscriber.state == SubscriberState::Live
                && subscriber.requested_stage == Some(self.stage)
                && !subscriber.send(msg.clone())
            {
                disconnected.push(*id);
            }
        }

        // Finalize the stage only after the buffer is fully drained.
        // Draining one tick per cycle preserves smooth playback rather than
        // batching remaining ticks.
        //
        // If a fast stage transition preempts the drain, the remaining ticks
        // are discarded from the live view. The client can recover during
        // loading of the processed static stage data. Given that the fastest
        // transition is 5-6t and the jitter buffer is 2t, this should be rare.
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
                    last_active_tick: 0,
                })
                .event_count += 1;
        }

        self.primary_client_id = pre_selected_primary;
        if self.primary_client_id.is_none() {
            self.primary_client_id = self.select_primary_client(0, None);
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

        // Replay excludes the last JITTER_DEPTH ticks (they haven't been sent
        // to subscribers yet). Set the broadcast cursor to match so those ticks
        // enter the normal broadcast path once new events push the buffer past
        // the jitter threshold.
        self.broadcast_cursor = self.tick_buffer.len().saturating_sub(JITTER_DEPTH);
        self.poll_cursor = result.last_stream_id;
        self.state = ReaderState::Active;

        tracing::info!(
            parent: &self.span,
            ticks = self.tick_buffer.len(),
            primary = self.primary_client_id,
            "backfill applied",
        );

        // Replay to all subscribers viewing this stage.
        let reason = if pre_selected_primary.is_some() {
            ResetReason::PrimaryChange
        } else {
            ResetReason::Reconnect
        };
        let replay = self.build_replay_messages(reason);
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
            challenge_type: self.challenge_type as i32,
            mode: self.challenge_mode,
            stage: self.stage,
            attempt: self.stage_attempt,
            stage_active: self.stage_state.is_open(),
            party: self.party.clone(),
        });

        match self.state {
            ReaderState::Active | ReaderState::Stalled { .. } => {
                // Send cached replay if the subscriber wants this stage.
                if subscriber.requested_stage == Some(self.stage) && !self.tick_buffer.is_empty() {
                    for msg in self.build_replay_messages(ResetReason::Reconnect) {
                        subscriber.send(msg);
                    }
                }
                if let ReaderState::Stalled { reason, .. } = self.state {
                    subscriber.send(SseMessage::Stalled { reason });
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

    pub fn remove_subscriber(&mut self, id: SubscriberId) {
        self.subscribers.remove(&id);
    }

    pub fn has_subscribers(&self) -> bool {
        !self.subscribers.is_empty()
    }

    pub fn subscriber_count(&self) -> usize {
        self.subscribers.len()
    }

    pub fn challenge_type(&self) -> proto::Challenge {
        self.challenge_type
    }

    /// Processes stream entries from an incremental poll: counts events,
    /// advances the cursor, updates silence tracking, and ingests the
    /// primary's events into the buffer.
    fn process_stream_entries(&mut self, entries: &[StageStreamEntry], tick: u64) {
        if entries.is_empty() {
            return;
        }

        // Advance the poll cursor past all entries, regardless of client.
        if let Some(last) = entries.last() {
            self.poll_cursor.clone_from(&last.id);
        }

        // Count events per client and update silence tracking.
        for entry in entries {
            let state = self
                .client_states
                .entry(entry.client_id)
                .or_insert(ClientState {
                    active: false,
                    event_count: 0,
                    last_active_tick: 0,
                });
            state.event_count += 1;
            state.last_active_tick = tick;
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

    /// Selects a new primary client from `client_states`, considering clients
    /// that have sent events since `active_since`, and optionally excluding the
    /// client specified by `exclude`.
    ///
    /// Among candidates, the client with the highest event count is selected.
    fn select_primary_client(&self, active_since: u64, exclude: Option<u64>) -> Option<u64> {
        self.client_states
            .iter()
            .filter(|(id, _)| exclude.is_none_or(|e| e != **id))
            .filter(|(_, s)| s.active && s.last_active_tick >= active_since)
            .max_by_key(|(_, s)| s.event_count)
            .map(|(id, _)| *id)
    }

    fn begin_stage(&mut self, tick: u64, stage: i32, attempt: Option<u32>) {
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
            if state.active {
                state.last_active_tick = tick;
            }
        }

        let message = SseMessage::StageChange { stage, attempt };
        self.send_to_all(&message);
    }

    fn process_clients(&mut self, clients: &HashMap<u64, ChallengeClient>, tick: u64) {
        // Sync active status into client_states from the latest poll data.
        for (id, client) in clients {
            self.client_states
                .entry(*id)
                .or_insert(ClientState {
                    active: false,
                    event_count: 0,
                    last_active_tick: 0,
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
                self.begin_stage(tick, self.stage, self.stage_attempt);
            } else {
                return;
            }
        }

        if clients.is_empty() {
            self.stall(StalledReason::NoClients, tick);
            return;
        }

        let all_completed = clients.values().all(|c| self.client_completed_stage(c));
        if all_completed {
            self.stage_state = StageState::Ending;
            return;
        }

        if !clients.values().any(|client| client.active) {
            self.stall(StalledReason::AllInactive, tick);
        }
    }

    /// Evaluates the primary client after stream entries have been processed,
    /// so that `last_active_tick` reflects the current poll's data.
    ///
    /// Handles stall recovery and silence-based primary switching.
    fn update_primary(&mut self, tick: u64) {
        if let ReaderState::Stalled { reason, .. } = self.state {
            let active_since = if reason == StalledReason::AllSilent {
                // For silence-based stalls, require a client to have actually
                // sent events recently before recovering.
                tick.saturating_sub(SILENCE_THRESHOLD) + 1
            } else {
                // Otherwise, pick any active client that becomes available.
                0
            };
            if let Some(primary_id) = self.select_primary_client(active_since, None) {
                tracing::info!(parent: &self.span, "recording resumed");
                self.state = ReaderState::Active;
                self.switch_to_primary(primary_id);
            }
            return;
        }

        match self.primary_client_id {
            Some(primary_id) => {
                self.check_primary_switch(primary_id, tick);
            }
            None => {
                self.primary_client_id = self.select_primary_client(0, None);
            }
        }
    }

    /// Checks if the primary client should be switched and initiates a backfill
    /// from the new primary if so.
    ///
    /// Switch triggers:
    /// - Primary went inactive (disconnected).
    /// - Primary is silent for [`SILENCE_THRESHOLD`] ticks while another client
    ///   is actively streaming.
    fn check_primary_switch(&mut self, primary_id: u64, tick: u64) {
        let (switch_reason, candidate_active_since) = match self.client_states.get(&primary_id) {
            None => ("missing", 0),
            Some(ps) if !ps.active => ("inactive", 0),
            Some(ps) => {
                if tick.saturating_sub(ps.last_active_tick) < SILENCE_THRESHOLD {
                    // Client is healthy.
                    return;
                }
                ("silent", tick.saturating_sub(SILENCE_THRESHOLD) + 1)
            }
        };

        let has_other_clients = self.client_states.iter().any(|(id, s)| {
            *id != primary_id
                && s.active
                && tick.saturating_sub(s.last_active_tick) < SILENCE_THRESHOLD
        });
        if !has_other_clients {
            // Primary is gone and there is no one to switch to.
            self.stall(StalledReason::AllSilent, tick);
            return;
        }

        let old_primary = primary_id;
        let Some(new_primary) =
            self.select_primary_client(candidate_active_since, Some(old_primary))
        else {
            self.stall(StalledReason::AllInactive, tick);
            return;
        };

        tracing::info!(
            parent: &self.span,
            old_primary,
            new_primary,
            reason = switch_reason,
            "switching primary client",
        );
        crate::metrics::PRIMARY_SWITCHES_TOTAL
            .with_label_values(&[switch_reason])
            .inc();

        self.switch_to_primary(new_primary);
    }

    /// Switches to a new primary client: increments generation, clears the
    /// tick buffer, and requests a backfill from the new primary's stream.
    fn switch_to_primary(&mut self, new_primary: u64) {
        self.primary_client_id = Some(new_primary);
        self.generation += 1;
        self.tick_buffer.clear();
        self.broadcast_cursor = 0;
        self.high_water_tick = 0;
        self.replay_chunks.clear();
        self.request_backfill(Some(new_primary));
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

    fn stall(&mut self, reason: StalledReason, since: u64) {
        if matches!(self.state, ReaderState::Stalled { .. }) {
            return;
        }

        tracing::warn!(parent: &self.span, reason = %reason.to_string(), "reader stalled");
        crate::metrics::STALLED_CHALLENGES_TOTAL.inc();
        self.primary_client_id = None;
        self.state = ReaderState::Stalled { reason, since };
        self.send_to_all(&SseMessage::Stalled { reason });
    }

    /// Builds the full replay message sequence:
    /// `reset` -> zero or more `replay-chunk` -> `replay-end`.
    ///
    /// Uses cached complete chunks plus a trailing partial chunk built on
    /// demand from the remaining tick buffer entries.
    fn build_replay_messages(&self, reason: ResetReason) -> Vec<SseMessage> {
        #![allow(clippy::cast_possible_truncation)]

        let generation = self.generation;
        let mut messages = Vec::with_capacity(self.replay_chunks.len() + 3);

        crate::metrics::RESETS_TOTAL
            .with_label_values(&[reason.as_str()])
            .inc();

        messages.push(SseMessage::Reset {
            reason,
            stage: self.stage,
            attempt: self.stage_attempt,
            stage_active: self.stage_state.is_open(),
            generation,
        });

        // Send only cached chunks that end strictly before the live cursor.
        // A cached chunk can extend beyond `broadcast_cursor` because chunking
        // is size-based rather than cursor-based; anything from the first such
        // chunk onward must be rebuilt dynamically below.
        let mut tail_start = 0;
        for chunk in &self.replay_chunks {
            if (chunk.end_tick() + 1) as usize > self.broadcast_cursor {
                break;
            }

            messages.push(SseMessage::ReplayChunk {
                generation,
                start_tick: chunk.start_tick,
                tick_count: chunk.tick_count,
                data: chunk.data.clone(),
            });
            tail_start = (chunk.end_tick() + 1) as usize;
        }

        // Create a trailing partial chunk from everything after the last
        // cursor-safe cached chunk.
        if tail_start < self.broadcast_cursor {
            let tick_count = self.broadcast_cursor - tail_start;
            let mut data = BytesMut::new();
            for i in tail_start..self.broadcast_cursor {
                data.extend_from_slice(&self.tick_buffer[i].data);
            }
            messages.push(SseMessage::ReplayChunk {
                generation,
                start_tick: tail_start as u32,
                tick_count: tick_count as u32,
                data: data.into(),
            });
        }

        messages.push(SseMessage::ReplayEnd {
            generation,
            tick: self
                .broadcast_cursor
                .checked_sub(1)
                .map(|i| self.tick_buffer[i].tick),
        });

        messages
    }

    /// Notifies all subscribers that the server is shutting down, then drops
    /// all senders so the SSE streams close and axum can finish draining.
    pub fn notify_shutdown(&mut self, retry_window_secs: u32) {
        self.send_to_all(&SseMessage::Shutdown { retry_window_secs });
        self.subscribers.clear();
    }

    fn send_to_all(&self, msg: &SseMessage) {
        for subscriber in self.subscribers.values() {
            subscriber.send(msg.clone());
        }
    }

    fn build_replay_chunks(&mut self, from_tick: u32) {
        if self.tick_buffer.is_empty() {
            self.replay_chunks.clear();
            return;
        }

        // Invalidate all chunks from the first one containing `from_tick`.
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

        // Concatenate tick data into chunks up to `MAX_SIZE_BYTES`.
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
    #![allow(clippy::cast_possible_truncation)]
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

        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(2, None))),
                RedisResponse::ChallengeClients(clients),
                RedisResponse::StageStream(vec![stream_entry("1-0", 1, 3)]),
            ],
            0,
        );

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

        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(1, None))),
                RedisResponse::ChallengeClients(clients),
                RedisResponse::StageStream(vec![stream_entry("1-0", 1, 3)]),
            ],
            0,
        );

        assert_eq!(reader.poll_cursor, "1-0");
        assert_eq!(reader.tick_buffer.len(), 4);
        assert_eq!(reader.tick_buffer[3].tick, 3);
    }

    #[test]
    fn apply_poll_responses_discards_stream_entries_after_stall() {
        let mut reader = new_active_reader(1, None);

        // All clients go inactive, causing a stall. Stream entries from the
        // same poll should be discarded.
        let clients =
            HashMap::from([(1, challenge_client(1, false, 1, None, StageStatus::Started))]);

        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(1, None))),
                RedisResponse::ChallengeClients(clients),
                RedisResponse::StageStream(vec![stream_entry("5-0", 1, 5)]),
            ],
            0,
        );

        assert!(matches!(reader.state, ReaderState::Stalled { .. }));
        assert!(reader.tick_buffer.is_empty());
        assert_eq!(reader.poll_cursor, STREAM_START_CURSOR);
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
        reader.process_stream_entries(&entries, 0);
        reader.broadcast();

        // New subscriber connects after data exists.
        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(1), tx));

        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 4);
        assert!(matches!(msgs[0], SseMessage::Metadata { .. }));
        assert!(matches!(msgs[1], SseMessage::Reset { .. }));
        assert!(matches!(
            msgs.last().unwrap(),
            SseMessage::ReplayEnd { tick: Some(0), .. }
        ));
    }

    #[test]
    fn replay_while_stage_is_draining_uses_broadcast_cursor() {
        let mut reader = new_active_reader(1, None);

        let entries: Vec<_> = (0..=4)
            .map(|t| stream_entry(&format!("{t}-0"), 1, t))
            .collect();
        reader.process_stream_entries(&entries, 0);

        reader.broadcast();
        reader.stage_state = StageState::Ending;
        reader.broadcast();
        reader.broadcast();
        reader.broadcast();

        assert_eq!(reader.broadcast_cursor, 4);
        assert_eq!(reader.tick_buffer.len(), 5);

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(1), tx));

        let msgs = drain_messages(&mut rx);
        assert!(matches!(msgs[0], SseMessage::Metadata { .. }));
        assert!(matches!(msgs[1], SseMessage::Reset { .. }));
        assert!(matches!(
            msgs[2],
            SseMessage::ReplayChunk {
                start_tick: 0,
                tick_count: 4,
                ..
            }
        ));
        assert!(matches!(
            msgs[3],
            SseMessage::ReplayEnd { tick: Some(3), .. }
        ));
    }

    #[test]
    fn replay_end_uses_none_when_no_ticks_are_replayable() {
        let mut reader = new_active_reader(1, None);

        reader.process_stream_entries(&[stream_entry("0-0", 1, 0), stream_entry("1-0", 1, 1)], 0);
        assert_eq!(reader.broadcast_cursor, 0);

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(1), tx));

        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 3);
        assert!(matches!(msgs[0], SseMessage::Metadata { .. }));
        assert!(matches!(msgs[1], SseMessage::Reset { .. }));
        assert!(matches!(msgs[2], SseMessage::ReplayEnd { tick: None, .. }));
    }

    #[test]
    fn replay_skips_cached_chunks_past_live_cursor() {
        let mut reader = new_active_reader(1, None);
        let entries: Vec<_> = (0..=3)
            .map(|t| stream_entry(&format!("{t}-0"), 1, t))
            .collect();
        reader.process_stream_entries(&entries, 0);

        reader.replay_chunks = vec![
            ReplayChunk {
                start_tick: 0,
                tick_count: 2,
                data: Bytes::from_static(b"chunk-a"),
            },
            ReplayChunk {
                start_tick: 2,
                tick_count: 2,
                data: Bytes::from_static(b"chunk-b"),
            },
        ];
        reader.broadcast_cursor = 3;

        let replay = reader.build_replay_messages(ResetReason::Reconnect);
        assert_eq!(replay.len(), 4);
        assert!(matches!(replay[0], SseMessage::Reset { .. }));
        assert!(matches!(
            replay[1],
            SseMessage::ReplayChunk {
                start_tick: 0,
                tick_count: 2,
                ..
            }
        ));
        assert!(matches!(
            replay[2],
            SseMessage::ReplayChunk {
                start_tick: 2,
                tick_count: 1,
                ..
            }
        ));
        assert!(matches!(
            replay[3],
            SseMessage::ReplayEnd { tick: Some(2), .. }
        ));
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

        // Subscriber receives a replay of the backfilled data.
        let msgs = drain_messages(&mut rx);
        assert!(msgs.len() >= 3);
        assert!(matches!(msgs[0], SseMessage::Reset { .. }));
        assert!(matches!(msgs.last().unwrap(), SseMessage::ReplayEnd { .. }));
        for (i, msg) in msgs[1..msgs.len() - 1].iter().enumerate() {
            assert!(
                matches!(msg, SseMessage::ReplayChunk { start_tick, .. } if *start_tick == i as u32)
            );
        }

        // The replay excludes the last JITTER_DEPTH ticks from the backfill.
        // Those ticks must still be delivered via normal broadcast once new
        // events push the buffer past the jitter threshold.
        reader.process_stream_entries(&[stream_entry("5-0", 2, 4), stream_entry("6-0", 2, 5)], 1);

        reader.broadcast();
        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 1);
        match &msgs[0] {
            SseMessage::Tick { tick, .. } => assert_eq!(*tick, 2),
            other => panic!("expected Tick, got {other:?}"),
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
        reader.process_stream_entries(&entries, 0);

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
        reader.process_clients(&started_clients, 0);

        assert_eq!(reader.stage_state, StageState::Active);
    }

    #[test]
    fn jitter_buffer_holds_back_ticks() {
        let mut reader = new_active_reader(1, None);

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(1), tx));
        drain_messages(&mut rx);

        let entries: Vec<_> = (0..(JITTER_DEPTH + 1) as u32)
            .map(|t| stream_entry(&format!("{t}-0"), 1, t))
            .collect();
        reader.process_stream_entries(&entries, 0);

        reader.broadcast();
        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 1);

        reader.broadcast();
        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 0);
    }

    #[test]
    fn lag_recovery_bundles_ticks() {
        let mut reader = new_active_reader(1, None);

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(1), tx));
        drain_messages(&mut rx);

        let num_ticks = (JITTER_DEPTH + LAG_THRESHOLD + 1) as u32;

        let entries: Vec<_> = (0..num_ticks)
            .map(|t| stream_entry(&format!("{t}-0"), 1, t))
            .collect();
        reader.process_stream_entries(&entries, 0);

        reader.broadcast();
        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 1);
        match &msgs[0] {
            SseMessage::Tick {
                tick,
                tick_count,
                data,
                ..
            } => {
                assert_eq!(*tick, 0);
                assert_eq!(*tick_count, num_ticks - JITTER_DEPTH as u32);
                assert!(!data.is_empty());
            }
            _ => panic!("expected Tick message"),
        }

        reader.broadcast();
        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 0);
    }

    #[test]
    fn ending_stage_ignores_jitter_buffer() {
        let mut reader = new_active_reader(1, None);

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(1), tx));
        drain_messages(&mut rx);

        reader.process_stream_entries(&[stream_entry("0-0", 1, 0), stream_entry("1-0", 1, 1)], 0);

        // Under normal broadcasting, no ticks should be sent as the reader is
        // at the buffer.
        reader.broadcast();
        assert_eq!(drain_messages(&mut rx).len(), 0);

        // When ending, this buffer should be drained.
        reader.stage_state = StageState::Ending;
        reader.broadcast();
        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 1);
        assert!(matches!(msgs[0], SseMessage::Tick { .. }));
        assert_eq!(reader.stage_state, StageState::Ending);

        reader.broadcast();
        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 2);
        assert!(matches!(msgs[0], SseMessage::Tick { .. }));
        assert!(matches!(msgs[1], SseMessage::StageEnd { .. }));
        assert_eq!(reader.stage_state, StageState::Inactive);
    }

    #[test]
    fn ending_with_empty_buffer_finalizes_immediately() {
        let mut reader = new_active_reader(1, None);

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(1), tx));
        drain_messages(&mut rx);

        reader.stage_state = StageState::Ending;
        reader.broadcast();

        assert_eq!(reader.stage_state, StageState::Inactive);
        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 1);
        assert!(matches!(msgs[0], SseMessage::StageEnd { .. }));
    }

    #[test]
    fn primary_switches_when_inactive() {
        let (backfill_tx, mut backfill_rx) = mpsc::unbounded_channel();
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
        reader.state = ReaderState::Active;
        reader.primary_client_id = Some(1);

        // Drain the initial backfill request.
        backfill_rx.try_recv().unwrap();

        // Primary goes inactive.
        let updated_clients = HashMap::from([
            (1, challenge_client(1, false, 1, None, StageStatus::Started)),
            (2, challenge_client(2, true, 1, None, StageStatus::Started)),
        ]);
        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(1, None))),
                RedisResponse::ChallengeClients(updated_clients),
            ],
            1,
        );

        assert_eq!(reader.primary_client_id, Some(2));
        assert!(matches!(reader.state, ReaderState::Backfilling(Some(2))));
        assert_eq!(reader.generation, 1);
        assert!(reader.tick_buffer.is_empty());

        let req = backfill_rx.try_recv().unwrap();
        assert_eq!(req.backfill_id, reader.backfill_id);
    }

    #[test]
    fn primary_switches_when_silent() {
        let (backfill_tx, mut backfill_rx) = mpsc::unbounded_channel();
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
        reader.state = ReaderState::Active;
        reader.primary_client_id = Some(1);
        backfill_rx.try_recv().unwrap();

        // Prior poll: client 2 sent events, client 1 did not.
        reader.process_stream_entries(&[stream_entry("1-0", 2, 1)], 10);

        // Current poll: no new events from client 1. Should switch to 2.
        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(1, None))),
                RedisResponse::ChallengeClients(clients),
                RedisResponse::StageStream(vec![]),
            ],
            10,
        );

        assert_eq!(reader.primary_client_id, Some(2));
        assert!(matches!(reader.state, ReaderState::Backfilling(Some(2))));
        assert_eq!(reader.generation, 1);
        backfill_rx.try_recv().unwrap();
    }

    #[test]
    fn silent_switch_prefers_recently_active_client() {
        let (backfill_tx, mut backfill_rx) = mpsc::unbounded_channel();
        let clients = HashMap::from([
            (1, challenge_client(1, true, 1, None, StageStatus::Started)),
            (2, challenge_client(2, true, 1, None, StageStatus::Started)),
            (3, challenge_client(3, true, 1, None, StageStatus::Started)),
        ]);
        let mut reader = ChallengeReader::new(
            "test".to_string(),
            challenge_state(1, None),
            &clients,
            backfill_tx,
        );
        reader.state = ReaderState::Active;
        reader.primary_client_id = Some(1);
        backfill_rx.try_recv().unwrap();

        // Prior polls: client 3 had high activity early, client 2 sent
        // events recently.
        reader.process_stream_entries(
            &[
                stream_entry("1-0", 3, 1),
                stream_entry("2-0", 3, 2),
                stream_entry("3-0", 3, 3),
                stream_entry("4-0", 3, 4),
                stream_entry("5-0", 3, 5),
            ],
            2,
        );
        reader.process_stream_entries(&[stream_entry("6-0", 2, 1)], 10);

        // Poll contains no new events. Should switch to recently active client
        // 2 over client 3, which is still silent.
        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(1, None))),
                RedisResponse::ChallengeClients(clients),
                RedisResponse::StageStream(vec![]),
            ],
            10,
        );

        assert_eq!(reader.primary_client_id, Some(2));
        assert!(matches!(reader.state, ReaderState::Backfilling(Some(2))));
        backfill_rx.try_recv().unwrap();
    }

    #[test]
    fn stalls_when_all_clients_are_silent() {
        let mut reader = new_active_reader(1, None);

        let clients = HashMap::from([
            (1, challenge_client(1, true, 1, None, StageStatus::Started)),
            (2, challenge_client(2, true, 1, None, StageStatus::Started)),
        ]);

        // Nobody has sent events by tick 10.
        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(1, None))),
                RedisResponse::ChallengeClients(clients),
                RedisResponse::StageStream(vec![]),
            ],
            10,
        );

        assert_eq!(reader.primary_client_id, None);
        assert!(matches!(
            reader.state,
            ReaderState::Stalled {
                reason: StalledReason::AllSilent,
                since: 10
            }
        ));
        assert_eq!(reader.generation, 0);
    }

    #[test]
    fn no_switch_when_primary_is_healthy() {
        let mut reader = new_active_reader(1, None);

        // Prior poll: primary sent events recently.
        reader.process_stream_entries(&[stream_entry("1-0", 1, 1)], 8);

        let clients = HashMap::from([
            (1, challenge_client(1, true, 1, None, StageStatus::Started)),
            (2, challenge_client(2, true, 1, None, StageStatus::Started)),
        ]);
        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(1, None))),
                RedisResponse::ChallengeClients(clients),
                RedisResponse::StageStream(vec![]),
            ],
            10,
        );

        assert_eq!(reader.primary_client_id, Some(1));
        assert_eq!(reader.state, ReaderState::Active);
        assert_eq!(reader.generation, 0);
    }

    #[test]
    fn backfill_after_primary_switch_uses_primary_change_reason() {
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
        // Simulate initial backfill completing then primary switch.
        reader.state = ReaderState::Backfilling(Some(2));
        reader.primary_client_id = Some(2);
        reader.generation = 1;

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(1), tx));
        drain_messages(&mut rx);

        reader.apply_backfill(BackfillResult {
            challenge_id: "test".to_string(),
            backfill_id: reader.backfill_id,
            entries: vec![stream_entry("1-0", 2, 1)],
            last_stream_id: "1-0".to_string(),
        });

        let msgs = drain_messages(&mut rx);
        assert!(msgs.len() >= 2);
        match &msgs[0] {
            SseMessage::Reset { reason, .. } => {
                assert_eq!(*reason, ResetReason::PrimaryChange);
            }
            _ => panic!("expected Reset message"),
        }
    }
}

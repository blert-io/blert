use std::collections::{HashMap, VecDeque};

use blert::{
    BuildRejection, ChallengeMode, ClientId, RecordingBuilder, Rsn, Stage, Tick, Ticks, proto,
};
use bytes::{Bytes, BytesMut};
use prost::Message as _;

use tokio::sync::mpsc;

use crate::backfill::{BackfillRequest, BackfillResult};
use crate::message::{ResetReason, SseMessage, StalledReason};
use crate::redis::{
    ChallengeClient, ChallengeServerUpdate, ChallengeState, RedisQuery, RedisResponse,
    STREAM_START_CURSOR, StageStatus, StageStreamEntry,
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
    Backfilling(Option<ClientId>),
    /// Polling for new events and broadcasting to subscribers.
    Active,
    /// All recording clients have disconnected or gone silent.
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
    tick: Tick,
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
    start_tick: Tick,
    tick_count: Ticks,
    data: Bytes,
}

impl ReplayChunk {
    /// Maximum byte size of a single chunk. Reduced from max transmission size
    /// to account for base64 encoding overhead.
    const MAX_SIZE_BYTES: usize = 96 * 1024;

    fn end_tick(&self) -> Tick {
        (self.start_tick + self.tick_count).pred()
    }
}

/// Manages the state for a single live challenge being watched.
pub struct ChallengeReader {
    /// Tracing span for this reader, scoping logs with `uuid`.
    span: tracing::Span,

    uuid: String,
    challenge_type: proto::Challenge,
    challenge_mode: ChallengeMode,

    /// Current stage of the challenge.
    stage: Stage,
    /// Current stage attempt number (for retryable stages).
    stage_attempt: Option<u32>,
    /// State of the current stage.
    stage_state: StageState,

    /// Redis stream cursor for the current stage stream.
    poll_cursor: String,

    /// Contiguous buffer of tick data from 0 to the recording's last tick,
    /// pending broadcast.
    tick_buffer: VecDeque<TickEntry>,
    /// Index into `tick_buffer` tracking what has been broadcast so far.
    broadcast_cursor: usize,
    /// Earliest broadcast tick that has changed since the last broadcast.
    pending_rewind: Option<Tick>,

    /// Event accumulator for the current stage.
    builder: Option<RecordingBuilder>,

    /// Client ID of the selected primary recording client for the challenge.
    primary_client_id: Option<ClientId>,
    /// Per-client tracking state, keyed by client ID.
    client_states: HashMap<ClientId, ClientState>,

    /// Generation counter, incremented on primary switch, new attempt, etc.
    generation: u64,

    /// Current lifecycle state of this reader.
    state: ReaderState,

    /// Active subscribers watching this challenge.
    subscribers: HashMap<SubscriberId, Subscriber>,

    /// Party member names.
    party: Vec<Rsn>,

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
        clients: &HashMap<ClientId, ChallengeClient>,
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
            challenge_type: state.challenge_type,
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
            pending_rewind: None,
            builder: None,
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

        // Responses requested by a single poll are not independent, so discard
        // them all if any is malformed.
        if let Some(RedisResponse::Malformed(error)) = responses
            .iter()
            .find(|response| matches!(response, RedisResponse::Malformed(_)))
        {
            tracing::error!(parent: &self.span, "discarding poll with malformed response: {error}");
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
                    return;
                }
                RedisResponse::ChallengeClients(clients) => {
                    self.process_clients(&clients, tick);
                }
                RedisResponse::StageStream(entries) => {
                    // Stream entries must be processed after state updates.
                    stream_entries = Some(entries);
                }
                RedisResponse::Malformed(_) => unreachable!("checked above"),
            }
        }

        // `process_clients` could have triggered a state change from active, in
        // which case the stream entries are stale. Silence-stalled readers must
        // also process entries to enable recovery.
        if matches!(
            self.state,
            ReaderState::Active
                | ReaderState::Stalled {
                    reason: StalledReason::AllSilent,
                    ..
                }
        ) && let Some(entries) = stream_entries
        {
            if self.stage == queried_stage && self.stage_attempt == queried_attempt {
                self.process_stream_entries(&entries, tick);
            } else {
                tracing::warn!(
                    parent: &self.span,
                    queried_stage = queried_stage as i32,
                    queried_attempt,
                    current_stage = self.stage as i32,
                    current_attempt = self.stage_attempt,
                    entry_count = entries.len(),
                    "discarding stale stage stream response after stage transition",
                );
            }
        }

        // Gauge the primary's health after processing the stream, so that it
        // reflects data received in this poll.
        if self.stage_state == StageState::Active {
            self.update_primary(tick);
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

    /// Broadcasts events to live subscribers.
    ///
    /// Normally sends one tick per cycle. During lag recovery, bundles multiple
    /// ticks to catch up to the live edge. After a rewind, first re-sends the
    /// changed ticks up to the previous position as a single bundle.
    ///
    /// Returns IDs of disconnected subscribers for cleanup.
    pub fn broadcast(&mut self) -> Vec<SubscriberId> {
        // A pending backfill replaces buffered data; wait for update.
        if matches!(self.state, ReaderState::Backfilling(_)) {
            return Vec::new();
        }

        let mut messages = Vec::new();

        if let Some(rewind) = self.pending_rewind.take() {
            crate::metrics::REWINDS_TOTAL.inc();
            messages.push(SseMessage::Rewind {
                generation: self.generation,
                tick: rewind.0,
            });
            messages.push(self.bundle_ticks(rewind, Tick::from_usize(self.broadcast_cursor)));
        }

        let available = self.tick_buffer.len() - self.broadcast_cursor;

        // Hold back `JITTER_DEPTH` ticks so the plugin's flush-on-tick-boundary
        // stragglers merge before broadcast. When the stage is ending, drain
        // everything as no more ticks are coming.
        let min_buffer = if self.stage_state == StageState::Ending {
            1
        } else {
            JITTER_DEPTH + 1
        };

        if available >= min_buffer {
            let ticks_to_send = if self.stage_state != StageState::Ending
                && available > JITTER_DEPTH + LAG_THRESHOLD
            {
                available - JITTER_DEPTH
            } else {
                1
            };
            if ticks_to_send > 1 {
                crate::metrics::LAG_RECOVERIES_TOTAL.inc();
            }

            let end = self.broadcast_cursor + ticks_to_send;
            messages.push(self.bundle_ticks(
                Tick::from_usize(self.broadcast_cursor),
                Tick::from_usize(end),
            ));
            self.broadcast_cursor = end;
        }

        let mut disconnected = Vec::new();
        for (id, subscriber) in &self.subscribers {
            if subscriber.state == SubscriberState::Live
                && subscriber.requested_stage == Some(self.stage as i32)
                && !messages.iter().all(|msg| subscriber.send(msg.clone()))
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

    /// Bundles the buffered ticks from `start` up to, but not including, `end`
    /// into a single `Tick` message.
    fn bundle_ticks(&self, start: Tick, end: Tick) -> SseMessage {
        let mut data = BytesMut::new();
        for entry in self.tick_buffer.range(start.as_usize()..end.as_usize()) {
            data.extend_from_slice(&entry.data);
        }
        SseMessage::Tick {
            generation: self.generation,
            tick: start.0,
            tick_count: (end - start).0,
            data: data.into(),
        }
    }

    /// Applies a completed backfill result to this reader.
    pub fn apply_backfill(&mut self, result: BackfillResult, most_recent_tick: u64) {
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

        // Initialize the primary's `last_active_tick` to the most recent
        // broadcast tick to begin silence tracking.
        if let Some(state) = self
            .primary_client_id
            .and_then(|id| self.client_states.get_mut(&id))
        {
            state.last_active_tick = most_recent_tick;
        }

        tracing::info!(
            parent: &self.span,
            ticks = self.tick_buffer.len(),
            primary = self.primary_client_id.map(|id| id.0),
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
            if subscriber.requested_stage == Some(self.stage as i32) {
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
    fn request_backfill(&mut self, primary: Option<ClientId>) {
        tracing::info!(
            parent: &self.span,
            new_primary = primary.map(|id| id.0),
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
            mode: self.challenge_mode as i32,
            stage: self.stage as i32,
            attempt: self.stage_attempt,
            stage_active: self.stage_state.is_open(),
            party: self.party.iter().map(ToString::to_string).collect(),
        });

        match self.state {
            ReaderState::Active | ReaderState::Stalled { .. } => {
                // Send cached replay if the subscriber wants this stage.
                if subscriber.requested_stage == Some(self.stage as i32)
                    && !self.tick_buffer.is_empty()
                {
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
    /// advances the cursor, updates silence tracking, ingests the primary's
    /// events into the buffer, and records a pending rewind if a broadcast
    /// tick changed.
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
            if rebuild_from.as_usize() < self.broadcast_cursor {
                self.pending_rewind = Some(
                    self.pending_rewind
                        .map_or(rebuild_from, |pending| pending.min(rebuild_from)),
                );
            }
        }
    }

    /// Decodes a specific client's events from stream entries, feeds them to
    /// the stage's builder, and rewrites the tick buffer with the encoded
    /// recording from the earliest tick the builder modified, grouped by game
    /// tick.
    ///
    /// Following this function, the tick buffer is guaranteed to be contiguous
    /// between 0 and the recording's last tick, with missing ticks populated as
    /// empty entries.
    fn ingest_entries(
        &mut self,
        entries: &[StageStreamEntry],
        client_id: ClientId,
    ) -> Option<Tick> {
        let mut events = Vec::new();
        for entry in entries.iter().filter(|e| e.client_id == client_id) {
            // Redis encodes ChallengeEvents, but EventStream is wire-compatible
            // for field 1 (repeated Event). Extra fields are silently ignored.
            match proto::EventStream::decode(entry.events.as_slice()) {
                Ok(event_stream) => events.extend(event_stream.events),
                Err(e) => tracing::warn!(parent: &self.span, "failed to decode protobuf: {e}"),
            }
        }

        let builder = self.builder.get_or_insert_with(|| {
            RecordingBuilder::new(
                client_id,
                self.stage,
                self.challenge_mode,
                self.party.clone(),
                None,
            )
        });
        let modified = builder.ingest(events)?;
        let timeline = builder.recording()?.snapshot();

        // Vacant ticks preceding the modified tick may not be buffered yet.
        let next_buffered = self
            .tick_buffer
            .back()
            .map_or(Tick(0), |entry| entry.tick.succ());
        let start = modified.min(next_buffered);
        let last = timeline.last_tick();

        let mut ticks = vec![Vec::new(); last.as_usize() - start.as_usize() + 1];
        for event in timeline.to_proto_from(start) {
            ticks[Tick(event.tick).as_usize() - start.as_usize()].push(event);
        }

        self.tick_buffer.truncate(start.as_usize());
        for (tick, events) in start.through(last).zip(ticks) {
            self.tick_buffer.push_back(TickEntry {
                tick,
                data: proto::EventStream { events }.encode_to_vec().into(),
            });
        }

        Some(modified)
    }

    /// Selects a new primary client from `client_states`, considering clients
    /// that have sent events since `active_since`, and optionally excluding the
    /// client specified by `exclude`.
    ///
    /// Among candidates, the client with the highest event count is selected.
    fn select_primary_client(
        &self,
        active_since: u64,
        exclude: Option<ClientId>,
    ) -> Option<ClientId> {
        self.client_states
            .iter()
            .filter(|(id, _)| exclude.is_none_or(|e| e != **id))
            .filter(|(_, s)| s.active && s.last_active_tick >= active_since)
            .max_by_key(|(_, s)| s.event_count)
            .map(|(id, _)| *id)
    }

    fn begin_stage(&mut self, tick: u64, stage: Stage, attempt: Option<u32>) {
        match self.stage_state {
            StageState::Active => {
                tracing::error!(
                    parent: &self.span,
                    old_stage = self.stage as i32,
                    old_attempt = self.stage_attempt,
                    "new stage started while stage was active"
                );
                self.finish_stage();
            }
            StageState::Ending => {
                tracing::warn!(
                    parent: &self.span,
                    old_stage = self.stage as i32,
                    old_attempt = self.stage_attempt,
                    ticks_discarded = self.tick_buffer.len() - self.broadcast_cursor,
                    "new stage started before old stage finished draining"
                );
                self.finish_stage();
            }
            StageState::Inactive => {}
        }

        tracing::info!(parent: &self.span, stage = stage as i32, attempt, "stage started");

        self.stage = stage;
        self.stage_attempt = attempt;
        self.stage_state = StageState::Active;
        self.tick_buffer.clear();
        self.broadcast_cursor = 0;
        self.pending_rewind = None;
        self.builder = None;
        self.poll_cursor = STREAM_START_CURSOR.to_string();
        self.state = ReaderState::Active;
        self.replay_chunks.clear();
        for state in self.client_states.values_mut() {
            state.event_count = 0;
            if state.active {
                state.last_active_tick = tick;
            }
        }

        let message = SseMessage::StageChange {
            stage: stage as i32,
            attempt,
        };
        self.send_to_all(&message);
    }

    fn process_clients(&mut self, clients: &HashMap<ClientId, ChallengeClient>, tick: u64) {
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
                    stage = self.stage as i32,
                    attempt = self.stage_attempt,
                    "stage became active",
                );
                self.begin_stage(tick, self.stage, self.stage_attempt);
            }
        }

        if clients.is_empty() {
            self.stall(StalledReason::NoClients, tick);
            return;
        }

        let all_completed = clients.values().all(|c| self.client_completed_stage(c));
        if self.stage_state.is_open() && all_completed {
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
                if let Some(primary_id) = self.select_primary_client(0, None) {
                    self.switch_to_primary(primary_id);
                }
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
    fn check_primary_switch(&mut self, primary_id: ClientId, tick: u64) {
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
            old_primary = old_primary.0,
            new_primary = new_primary.0,
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
    fn switch_to_primary(&mut self, new_primary: ClientId) {
        self.primary_client_id = Some(new_primary);
        self.generation += 1;
        self.tick_buffer.clear();
        self.broadcast_cursor = 0;
        self.pending_rewind = None;
        self.builder = None;
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
            stage = self.stage as i32,
            attempt = self.stage_attempt,
            "stage ended",
        );

        if let Some(builder) = &self.builder {
            let mut groups: Vec<(&BuildRejection, usize)> = Vec::new();
            for rejection in builder.rejections() {
                match groups.iter_mut().find(|(first, _)| {
                    first.kind == rejection.kind && first.reason == rejection.reason
                }) {
                    Some((_, count)) => *count += 1,
                    None => groups.push((rejection, 1)),
                }
            }

            for (first, count) in groups {
                tracing::warn!(
                    parent: &self.span,
                    stage = self.stage as i32,
                    attempt = self.stage_attempt,
                    kind = ?first.kind,
                    reason = ?first.reason,
                    count,
                    first_tick = first.tick.0,
                    "builder rejected events",
                );
            }
        }

        self.stage_state = StageState::Inactive;

        let msg = SseMessage::StageEnd {
            stage: self.stage as i32,
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
            stage: self.stage as i32,
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
            if chunk.end_tick().succ().as_usize() > self.broadcast_cursor {
                break;
            }

            messages.push(SseMessage::ReplayChunk {
                generation,
                start_tick: chunk.start_tick.0,
                tick_count: chunk.tick_count.0,
                data: chunk.data.clone(),
            });
            tail_start = chunk.end_tick().succ().as_usize();
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
                .map(|i| self.tick_buffer[i].tick.0),
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

    fn build_replay_chunks(&mut self, from_tick: Tick) {
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
            .unwrap_or_else(|| {
                self.replay_chunks
                    .last()
                    .map_or(Tick(0), |c| c.end_tick().succ())
            });
        self.replay_chunks.retain(|c| c.end_tick() < start_tick);

        let mut size_bytes = 0;

        // Concatenate tick data into chunks up to `MAX_SIZE_BYTES`.
        for entry in self.tick_buffer.iter().skip(start_tick.as_usize()) {
            if size_bytes > 0 && size_bytes + entry.data.len() > ReplayChunk::MAX_SIZE_BYTES {
                let mut data = BytesMut::with_capacity(size_bytes);
                for buffered in self
                    .tick_buffer
                    .range(start_tick.as_usize()..entry.tick.as_usize())
                {
                    data.extend_from_slice(&buffered.data);
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
    #![allow(clippy::too_many_lines, clippy::cast_possible_truncation)]
    use std::collections::HashMap;

    use blert::Point;
    use tokio::sync::mpsc;

    use super::*;

    fn challenge_state(stage: Stage, attempt: Option<u32>) -> ChallengeState {
        ChallengeState {
            status: crate::redis::ChallengeStatus::InProgress,
            challenge_type: proto::Challenge::Tob,
            mode: ChallengeMode::TobRegular,
            stage,
            stage_attempt: attempt,
            party: vec![Rsn::try_from("Dedion").unwrap()],
        }
    }

    fn challenge_client(
        client_id: ClientId,
        active: bool,
        stage: Stage,
        attempt: Option<u32>,
        stage_status: StageStatus,
    ) -> ChallengeClient {
        ChallengeClient {
            user_id: u64::from(client_id.0),
            client_id,
            recording_type: crate::redis::RecordingType::Participant,
            active,
            stage,
            stage_attempt: attempt,
            stage_status,
            last_completed: crate::redis::LastCompleted {
                stage: Stage::try_from(stage as i32 - 1).unwrap_or(Stage::UnknownStage),
                attempt: None,
            },
        }
    }

    fn stream_entry(id: &str, client_id: ClientId, tick: u32) -> StageStreamEntry {
        StageStreamEntry {
            id: id.to_string(),
            client_id,
            events: proto::EventStream {
                events: vec![maiden_events()[tick as usize].clone()],
            }
            .encode_to_vec(),
        }
    }

    fn maiden_events() -> Vec<proto::Event> {
        vec![
            proto::Event {
                r#type: proto::event::Type::PlayerUpdate as i32,
                stage: Stage::TobMaiden as i32,
                tick: 0,
                x_coord: 3184,
                y_coord: 4448,
                player: Some(proto::event::Player {
                    name: "Dedion".to_string(),
                    equipment_deltas: vec![
                        121_352_153_464_833,
                        372_895_503_089_665,
                        608_427_214_635_009,
                        1_216_083_482_640_385,
                        2_350_504_604_598_273,
                        2_666_837_535_883_265,
                    ],
                    data_source: proto::event::player::DataSource::Secondary as i32,
                    snapshot: true,
                    ..Default::default()
                }),
                ..Default::default()
            },
            proto::Event {
                r#type: proto::event::Type::PlayerUpdate as i32,
                stage: Stage::TobMaiden as i32,
                tick: 1,
                x_coord: 3184,
                y_coord: 4448,
                player: Some(proto::event::Player {
                    name: "Dedion".to_string(),
                    data_source: proto::event::player::DataSource::Secondary as i32,
                    ..Default::default()
                }),
                ..Default::default()
            },
            proto::Event {
                r#type: proto::event::Type::PlayerUpdate as i32,
                stage: Stage::TobMaiden as i32,
                tick: 2,
                x_coord: 3182,
                y_coord: 4448,
                player: Some(proto::event::Player {
                    name: "Dedion".to_string(),
                    data_source: proto::event::player::DataSource::Secondary as i32,
                    ..Default::default()
                }),
                ..Default::default()
            },
            proto::Event {
                r#type: proto::event::Type::PlayerUpdate as i32,
                stage: Stage::TobMaiden as i32,
                tick: 3,
                x_coord: 3180,
                y_coord: 4448,
                player: Some(proto::event::Player {
                    name: "Dedion".to_string(),
                    data_source: proto::event::player::DataSource::Secondary as i32,
                    ..Default::default()
                }),
                ..Default::default()
            },
            proto::Event {
                r#type: proto::event::Type::PlayerUpdate as i32,
                stage: Stage::TobMaiden as i32,
                tick: 4,
                x_coord: 3178,
                y_coord: 4448,
                player: Some(proto::event::Player {
                    name: "Dedion".to_string(),
                    data_source: proto::event::player::DataSource::Secondary as i32,
                    ..Default::default()
                }),
                ..Default::default()
            },
            proto::Event {
                r#type: proto::event::Type::PlayerUpdate as i32,
                stage: Stage::TobMaiden as i32,
                tick: 5,
                x_coord: 3176,
                y_coord: 4448,
                player: Some(proto::event::Player {
                    name: "Dedion".to_string(),
                    data_source: proto::event::player::DataSource::Secondary as i32,
                    ..Default::default()
                }),
                ..Default::default()
            },
        ]
    }

    fn new_active_reader(stage: Stage, attempt: Option<u32>) -> ChallengeReader {
        let (backfill_tx, _backfill_rx) = mpsc::unbounded_channel();
        let clients = HashMap::from([(
            ClientId(1),
            challenge_client(ClientId(1), true, stage, attempt, StageStatus::Started),
        )]);
        let mut reader = ChallengeReader::new(
            "challenge-id".to_string(),
            challenge_state(stage, attempt),
            &clients,
            backfill_tx,
        );
        reader.state = ReaderState::Active;
        reader.primary_client_id = Some(ClientId(1));
        reader
    }

    #[test]
    fn new_reader_starts_backfilling_and_sends_request() {
        let (backfill_tx, mut backfill_rx) = mpsc::unbounded_channel();
        let clients = HashMap::from([(
            ClientId(1),
            challenge_client(
                ClientId(1),
                true,
                Stage::TobMaiden,
                None,
                StageStatus::Started,
            ),
        )]);

        let reader = ChallengeReader::new(
            "test-uuid".to_string(),
            challenge_state(Stage::TobMaiden, None),
            &clients,
            backfill_tx,
        );

        assert!(matches!(reader.state, ReaderState::Backfilling(None)));
        assert_eq!(reader.backfill_id, 1);

        let req = backfill_rx.try_recv().unwrap();
        assert_eq!(req.challenge_id, "test-uuid");
        assert_eq!(req.backfill_id, 1);
        assert_eq!(req.stage, Stage::TobMaiden);
    }

    #[test]
    fn apply_poll_responses_ignores_stale_stage_stream_after_stage_change() {
        let mut reader = new_active_reader(Stage::TobMaiden, None);
        reader.process_stream_entries(&[stream_entry("0-0", ClientId(1), 0)], 0);

        let clients = HashMap::from([(
            ClientId(1),
            challenge_client(
                ClientId(1),
                true,
                Stage::TobBloat,
                None,
                StageStatus::Started,
            ),
        )]);

        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(Stage::TobBloat, None))),
                RedisResponse::ChallengeClients(clients),
                RedisResponse::StageStream(vec![stream_entry("1-0", ClientId(1), 3)]),
            ],
            0,
        );

        assert_eq!(reader.stage, Stage::TobBloat);
        assert_eq!(reader.stage_attempt, None);
        assert!(reader.tick_buffer.is_empty());
        assert!(reader.builder.is_none());
        assert_eq!(reader.poll_cursor, STREAM_START_CURSOR);
    }

    #[test]
    fn apply_poll_responses_processes_current_stage_stream_entries() {
        let mut reader = new_active_reader(Stage::TobMaiden, None);

        let clients = HashMap::from([(
            ClientId(1),
            challenge_client(
                ClientId(1),
                true,
                Stage::TobMaiden,
                None,
                StageStatus::Started,
            ),
        )]);

        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(Stage::TobMaiden, None))),
                RedisResponse::ChallengeClients(clients),
                RedisResponse::StageStream(vec![stream_entry("1-0", ClientId(1), 3)]),
            ],
            0,
        );

        assert_eq!(reader.poll_cursor, "1-0");
        assert_eq!(reader.tick_buffer.len(), 4);
        assert_eq!(reader.tick_buffer[3].tick, Tick(3));
    }

    #[test]
    fn apply_poll_responses_discards_stream_entries_after_stall() {
        let mut reader = new_active_reader(Stage::TobMaiden, None);

        // All clients go inactive, causing a stall. Stream entries from the
        // same poll should be discarded.
        let clients = HashMap::from([(
            ClientId(1),
            challenge_client(
                ClientId(1),
                false,
                Stage::TobMaiden,
                None,
                StageStatus::Started,
            ),
        )]);

        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(Stage::TobMaiden, None))),
                RedisResponse::ChallengeClients(clients),
                RedisResponse::StageStream(vec![stream_entry("5-0", ClientId(1), 5)]),
            ],
            0,
        );

        assert!(matches!(
            reader.state,
            ReaderState::Stalled {
                reason: StalledReason::AllInactive,
                ..
            }
        ));
        assert!(reader.tick_buffer.is_empty());
        assert_eq!(reader.poll_cursor, STREAM_START_CURSOR);
    }

    #[test]
    fn apply_poll_responses_discards_poll_with_malformed_response() {
        let mut reader = new_active_reader(Stage::TobMaiden, None);

        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(Stage::TobBloat, None))),
                RedisResponse::Malformed(crate::redis::RedisQueryError::Parse(
                    "invalid client JSON".into(),
                )),
                RedisResponse::StageStream(vec![stream_entry("4-0", ClientId(1), 4)]),
            ],
            20,
        );

        // Nothing from the poll is applied, including the silence check.
        assert_eq!(reader.stage, Stage::TobMaiden);
        assert_eq!(reader.state, ReaderState::Active);
        assert_eq!(reader.primary_client_id, Some(ClientId(1)));
        assert!(reader.tick_buffer.is_empty());
        assert_eq!(reader.poll_cursor, STREAM_START_CURSOR);
    }

    #[test]
    fn ingest_entries_gap_fills_for_contiguity() {
        let mut reader = new_active_reader(Stage::TobMaiden, None);

        // First event is for tick 3.
        let entries = vec![stream_entry("1-0", ClientId(1), 3)];
        let dirty = reader.ingest_entries(&entries, ClientId(1));

        assert_eq!(reader.tick_buffer.len(), 4);
        for tick in Tick(3).up_to() {
            assert_eq!(reader.tick_buffer[tick.as_usize()].tick, tick);
            assert!(reader.tick_buffer[tick.as_usize()].data.is_empty());
        }
        assert_eq!(reader.tick_buffer[3].tick, Tick(3));
        let events = proto::EventStream::decode(reader.tick_buffer[3].data.as_ref())
            .unwrap()
            .events;
        let updates: Vec<_> = events
            .iter()
            .map(|e| {
                let name = e.player.as_ref().map(|p| p.name.as_str());
                (e.r#type(), name, e.x_coord, e.y_coord)
            })
            .collect();
        assert_eq!(
            updates,
            vec![(proto::event::Type::PlayerUpdate, Some("Dedion"), 3180, 4448)]
        );
        assert_eq!(dirty, Some(Tick(3)));
    }

    #[test]
    fn ingest_entries_merges_into_existing_tick() {
        let mut reader = new_active_reader(Stage::TobMaiden, None);

        // Ingest tick 2, then merge more events into it.
        reader.ingest_entries(&[stream_entry("1-0", ClientId(1), 2)], ClientId(1));
        assert_eq!(reader.tick_buffer.len(), 3);

        let maiden_spawn = StageStreamEntry {
            id: "2-0".to_string(),
            client_id: ClientId(1),
            events: proto::EventStream {
                events: vec![proto::Event {
                    r#type: proto::event::Type::NpcSpawn as i32,
                    stage: Stage::TobMaiden as i32,
                    tick: 2,
                    x_coord: 3162,
                    y_coord: 4444,
                    npc: Some(proto::event::Npc {
                        id: 8360,
                        room_id: 64386,
                        hitpoints: 200_674_294,
                        r#type: Some(proto::event::npc::Type::Basic(())),
                        ..Default::default()
                    }),
                    ..Default::default()
                }],
            }
            .encode_to_vec(),
        };
        let dirty = reader.ingest_entries(&[maiden_spawn], ClientId(1));
        assert_eq!(reader.tick_buffer.len(), 3); // No new entries.
        let events = proto::EventStream::decode(reader.tick_buffer[2].data.as_ref())
            .unwrap()
            .events;
        let kinds: Vec<_> = events.iter().map(proto::Event::r#type).collect();
        assert_eq!(
            kinds,
            vec![
                proto::event::Type::PlayerUpdate,
                proto::event::Type::NpcSpawn
            ]
        );
        assert_eq!(dirty, Some(Tick(2)));

        let state = reader
            .builder
            .as_ref()
            .and_then(RecordingBuilder::recording)
            .and_then(|recording| recording.get_state(Tick(2)))
            .unwrap();
        let positions: Vec<_> = state.players.iter().map(|(_, p)| p.position).collect();
        assert_eq!(positions, vec![Point(3182, 4448)]);
        let npc_ids: Vec<_> = state.npcs.values().map(|npc| npc.npc_id).collect();
        assert_eq!(npc_ids, vec![8360]);
    }

    #[test]
    fn ingest_entries_drops_events_rejected_by_the_builder() {
        let mut reader = new_active_reader(Stage::TobMaiden, None);
        reader.ingest_entries(&[stream_entry("1-0", ClientId(1), 0)], ClientId(1));

        let mut outsider = maiden_events()[1].clone();
        outsider.player.as_mut().unwrap().name = "715".to_string();
        reader.ingest_entries(
            &[StageStreamEntry {
                id: "2-0".to_string(),
                client_id: ClientId(1),
                events: proto::EventStream {
                    events: vec![outsider],
                }
                .encode_to_vec(),
            }],
            ClientId(1),
        );

        let rejections: Vec<_> = reader
            .builder
            .as_ref()
            .unwrap()
            .rejections()
            .map(|rejection| (rejection.tick, rejection.kind))
            .collect();
        assert_eq!(
            rejections,
            vec![(Tick(1), proto::event::Type::PlayerUpdate)]
        );
        let names: Vec<_> = reader
            .tick_buffer
            .iter()
            .flat_map(|entry| {
                proto::EventStream::decode(entry.data.as_ref())
                    .unwrap()
                    .events
            })
            .filter_map(|event| event.player.map(|player| player.name))
            .collect();
        assert!(!names.contains(&"715".to_string()));
    }

    /// Drain all messages from a subscriber's channel.
    fn drain_messages(rx: &mut mpsc::UnboundedReceiver<SseMessage>) -> Vec<SseMessage> {
        std::iter::from_fn(|| rx.try_recv().ok()).collect()
    }

    #[test]
    fn new_subscriber_gets_replay_from_active_reader() {
        let mut reader = new_active_reader(Stage::TobMaiden, None);

        // Populate tick buffer.
        let entries: Vec<_> = (1..=3)
            .map(|t| stream_entry(&format!("{t}-0"), ClientId(1), t))
            .collect();
        reader.process_stream_entries(&entries, 0);
        reader.broadcast();

        // New subscriber connects after data exists.
        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(Stage::TobMaiden as i32), tx));

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
        let mut reader = new_active_reader(Stage::TobMaiden, None);

        let entries: Vec<_> = (0..=4)
            .map(|t| stream_entry(&format!("{t}-0"), ClientId(1), t))
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
        reader.add_subscriber(Subscriber::new(1, Some(Stage::TobMaiden as i32), tx));

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
        let mut reader = new_active_reader(Stage::TobMaiden, None);

        reader.process_stream_entries(
            &[
                stream_entry("0-0", ClientId(1), 0),
                stream_entry("1-0", ClientId(1), 1),
            ],
            0,
        );
        assert_eq!(reader.broadcast_cursor, 0);

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(Stage::TobMaiden as i32), tx));

        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 3);
        assert!(matches!(msgs[0], SseMessage::Metadata { .. }));
        assert!(matches!(msgs[1], SseMessage::Reset { .. }));
        assert!(matches!(msgs[2], SseMessage::ReplayEnd { tick: None, .. }));
    }

    #[test]
    fn replay_skips_cached_chunks_past_live_cursor() {
        let mut reader = new_active_reader(Stage::TobMaiden, None);
        let entries: Vec<_> = (0..=3)
            .map(|t| stream_entry(&format!("{t}-0"), ClientId(1), t))
            .collect();
        reader.process_stream_entries(&entries, 0);

        reader.replay_chunks = vec![
            ReplayChunk {
                start_tick: Tick(0),
                tick_count: Ticks(2),
                data: Bytes::from_static(b"chunk-a"),
            },
            ReplayChunk {
                start_tick: Tick(2),
                tick_count: Ticks(2),
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
            (
                ClientId(1),
                challenge_client(
                    ClientId(1),
                    true,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
            (
                ClientId(2),
                challenge_client(
                    ClientId(2),
                    true,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
        ]);
        let mut reader = ChallengeReader::new(
            "test".to_string(),
            challenge_state(Stage::TobMaiden, None),
            &clients,
            backfill_tx,
        );

        // Subscriber added while backfilling only gets metadata.
        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(Stage::TobMaiden as i32), tx));
        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 1);
        assert!(matches!(msgs[0], SseMessage::Metadata { .. }));

        // Backfill result selects an initial primary client.
        assert_eq!(reader.primary_client_id, None);
        let result = BackfillResult {
            challenge_id: "test".to_string(),
            backfill_id: reader.backfill_id,
            entries: vec![
                stream_entry("1-0", ClientId(1), 4),
                stream_entry("2-0", ClientId(2), 1),
                stream_entry("3-0", ClientId(2), 2),
                stream_entry("4-0", ClientId(2), 3),
            ],
            last_stream_id: "4-0".to_string(),
        };
        reader.apply_backfill(result, 5);

        assert_eq!(reader.state, ReaderState::Active);
        assert_eq!(reader.primary_client_id, Some(ClientId(2)));
        assert_eq!(reader.client_states[&ClientId(2)].last_active_tick, 5);

        let recording = reader
            .builder
            .as_ref()
            .and_then(RecordingBuilder::recording)
            .unwrap();
        let positions: Vec<_> = recording
            .states()
            .map(|(tick, state)| {
                let players: Vec<_> = state.players.iter().map(|(_, p)| p.position).collect();
                (tick, players)
            })
            .collect();
        assert_eq!(
            positions,
            vec![
                (Tick(1), vec![Point(3184, 4448)]),
                (Tick(2), vec![Point(3182, 4448)]),
                (Tick(3), vec![Point(3180, 4448)]),
            ]
        );

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
        reader.process_stream_entries(
            &[
                stream_entry("5-0", ClientId(2), 4),
                stream_entry("6-0", ClientId(2), 5),
            ],
            1,
        );

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
        let clients = HashMap::from([(
            ClientId(1),
            challenge_client(
                ClientId(1),
                true,
                Stage::TobMaiden,
                None,
                StageStatus::Started,
            ),
        )]);
        let mut reader = ChallengeReader::new(
            "test".to_string(),
            challenge_state(Stage::TobMaiden, None),
            &clients,
            backfill_tx,
        );

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(Stage::TobMaiden as i32), tx));
        drain_messages(&mut rx); // Consume metadata.

        // Send result with wrong backfill ID.
        reader.apply_backfill(
            BackfillResult {
                challenge_id: "test".to_string(),
                backfill_id: 99,
                entries: vec![stream_entry("1-0", ClientId(1), 1)],
                last_stream_id: "1-0".to_string(),
            },
            0,
        );

        assert!(matches!(reader.state, ReaderState::Backfilling(_)));
        assert!(drain_messages(&mut rx).is_empty());
    }

    #[test]
    fn completion_during_backfill_notifies_subscribers() {
        let (backfill_tx, _rx) = mpsc::unbounded_channel();
        let clients = HashMap::from([(
            ClientId(1),
            challenge_client(
                ClientId(1),
                true,
                Stage::TobMaiden,
                None,
                StageStatus::Started,
            ),
        )]);
        let mut reader = ChallengeReader::new(
            "test".to_string(),
            challenge_state(Stage::TobMaiden, None),
            &clients,
            backfill_tx,
        );

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(Stage::TobMaiden as i32), tx));
        drain_messages(&mut rx);

        reader.apply_challenge_update(&ChallengeServerUpdate::Finish {
            id: "test".to_string(),
        });

        assert_eq!(reader.state, ReaderState::Completed);
        let msgs = drain_messages(&mut rx);
        assert!(matches!(msgs.last().unwrap(), SseMessage::Complete));

        assert!(reader.subscribers.is_empty());

        // The late backfill result is rejected.
        reader.apply_backfill(
            BackfillResult {
                challenge_id: "test".to_string(),
                backfill_id: 1,
                entries: vec![stream_entry("1-0", ClientId(1), 1)],
                last_stream_id: "1-0".to_string(),
            },
            0,
        );
        assert_eq!(reader.state, ReaderState::Completed);
    }

    #[test]
    fn missing_challenge_completes_ignoring_empty_clients() {
        let mut reader = new_active_reader(Stage::TobMaiden, None);

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(5, Some(Stage::TobMaiden as i32), tx));
        drain_messages(&mut rx);

        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(None),
                RedisResponse::ChallengeClients(HashMap::new()),
                RedisResponse::StageStream(vec![]),
            ],
            9,
        );

        assert_eq!(reader.state, ReaderState::Completed);
        assert!(reader.poll_queries().is_empty());

        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 2);
        assert!(matches!(
            msgs[0],
            SseMessage::StageEnd { stage, .. } if stage == Stage::TobMaiden as i32
        ));
        assert!(matches!(msgs[1], SseMessage::Complete));
    }

    #[test]
    fn backfill_with_inactive_clients_populates_buffer_without_primary() {
        let (backfill_tx, _rx) = mpsc::unbounded_channel();
        let clients = HashMap::from([(
            ClientId(1),
            challenge_client(
                ClientId(1),
                false,
                Stage::TobMaiden,
                None,
                StageStatus::Started,
            ),
        )]);
        let mut reader = ChallengeReader::new(
            "test".to_string(),
            challenge_state(Stage::TobMaiden, None),
            &clients,
            backfill_tx,
        );

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(Stage::TobMaiden as i32), tx));
        drain_messages(&mut rx);

        assert_eq!(reader.primary_client_id, None);

        reader.apply_backfill(
            BackfillResult {
                challenge_id: "test".to_string(),
                backfill_id: reader.backfill_id,
                entries: vec![
                    stream_entry("1-0", ClientId(1), 1),
                    stream_entry("2-0", ClientId(1), 2),
                ],
                last_stream_id: "2-0".to_string(),
            },
            0,
        );

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
    fn primary_selected_after_backfill_without_primary_requests_backfill() {
        let (backfill_tx, mut backfill_rx) = mpsc::unbounded_channel();
        let clients = HashMap::from([
            (
                ClientId(1),
                challenge_client(
                    ClientId(1),
                    false,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
            (
                ClientId(2),
                challenge_client(
                    ClientId(2),
                    false,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
        ]);
        let mut reader = ChallengeReader::new(
            "test".to_string(),
            challenge_state(Stage::TobMaiden, None),
            &clients,
            backfill_tx,
        );
        backfill_rx.try_recv().unwrap();

        // With no active clients, the buffer is filled from client 1.
        reader.apply_backfill(
            BackfillResult {
                challenge_id: "test".to_string(),
                backfill_id: reader.backfill_id,
                entries: vec![
                    stream_entry("1-0", ClientId(1), 1),
                    stream_entry("2-0", ClientId(1), 2),
                ],
                last_stream_id: "2-0".to_string(),
            },
            0,
        );
        assert_eq!(reader.primary_client_id, None);

        let updated_clients = HashMap::from([
            (
                ClientId(1),
                challenge_client(
                    ClientId(1),
                    false,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
            (
                ClientId(2),
                challenge_client(
                    ClientId(2),
                    true,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
        ]);
        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(Stage::TobMaiden, None))),
                RedisResponse::ChallengeClients(updated_clients),
                RedisResponse::StageStream(vec![]),
            ],
            3,
        );

        assert_eq!(reader.primary_client_id, Some(ClientId(2)));
        assert!(matches!(
            reader.state,
            ReaderState::Backfilling(Some(ClientId(2)))
        ));
        assert_eq!(reader.generation, 1);
        assert!(reader.tick_buffer.is_empty());

        let req = backfill_rx.try_recv().unwrap();
        assert_eq!(req.backfill_id, reader.backfill_id);
    }

    #[test]
    fn stage_ending_drains_all_ticks_before_stage_end() {
        let mut reader = new_active_reader(Stage::TobMaiden, None);

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(Stage::TobMaiden as i32), tx));
        drain_messages(&mut rx);

        // Ingest ticks 1-3.
        let entries: Vec<_> = (1..=3)
            .map(|t| stream_entry(&format!("{t}-0"), ClientId(1), t))
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
        let mut reader = new_active_reader(Stage::TobMaiden, None);
        reader.state = ReaderState::Completed;

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(42, Some(Stage::TobMaiden as i32), tx));

        assert!(reader.subscribers.is_empty());
        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 2);
        assert!(matches!(msgs[0], SseMessage::Metadata { .. }));
        assert!(matches!(msgs[1], SseMessage::Complete));
    }

    #[test]
    fn process_clients_detects_first_stage_activation() {
        let (backfill_tx, _rx) = mpsc::unbounded_channel();
        let clients = HashMap::from([(
            ClientId(1),
            challenge_client(
                ClientId(1),
                true,
                Stage::TobMaiden,
                None,
                StageStatus::Entered,
            ),
        )]);
        let mut reader = ChallengeReader::new(
            "test".to_string(),
            challenge_state(Stage::TobMaiden, None),
            &clients,
            backfill_tx,
        );
        reader.state = ReaderState::Active;

        assert_eq!(reader.stage_state, StageState::Inactive);

        let started_clients = HashMap::from([(
            ClientId(1),
            challenge_client(
                ClientId(1),
                true,
                Stage::TobMaiden,
                None,
                StageStatus::Started,
            ),
        )]);
        reader.process_clients(&started_clients, 0);

        assert_eq!(reader.stage_state, StageState::Active);
    }

    #[test]
    fn jitter_buffer_holds_back_ticks() {
        let mut reader = new_active_reader(Stage::TobMaiden, None);

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(Stage::TobMaiden as i32), tx));
        drain_messages(&mut rx);

        let entries: Vec<_> = (0..(JITTER_DEPTH + 1) as u32)
            .map(|t| stream_entry(&format!("{t}-0"), ClientId(1), t))
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
        let mut reader = new_active_reader(Stage::TobMaiden, None);

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(Stage::TobMaiden as i32), tx));
        drain_messages(&mut rx);

        let num_ticks = (JITTER_DEPTH + LAG_THRESHOLD + 1) as u32;

        let entries: Vec<_> = (0..num_ticks)
            .map(|t| stream_entry(&format!("{t}-0"), ClientId(1), t))
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
    fn broadcast_rewinds_ticks_that_changed_after_sending() {
        let mut reader = new_active_reader(Stage::MokhaiotlDelve2, None);
        reader.challenge_type = proto::Challenge::Mokhaiotl;
        reader.challenge_mode = ChallengeMode::NoMode;

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(Stage::MokhaiotlDelve2 as i32), tx));
        drain_messages(&mut rx);

        reader.process_stream_entries(
            &[
                StageStreamEntry {
                    id: "1-0".to_string(),
                    client_id: ClientId(1),
                    events: proto::EventStream {
                        events: vec![
                            proto::Event {
                                r#type: proto::event::Type::NpcSpawn as i32,
                                stage: Stage::MokhaiotlDelve2 as i32,
                                tick: 0,
                                x_coord: 3421,
                                y_coord: 6435,
                                npc: Some(proto::event::Npc {
                                    id: 14707,
                                    room_id: 49601,
                                    hitpoints: 36_045_350,
                                    r#type: Some(proto::event::npc::Type::Basic(())),
                                    ..Default::default()
                                }),
                                ..Default::default()
                            },
                            proto::Event {
                                r#type: proto::event::Type::NpcAttack as i32,
                                stage: Stage::MokhaiotlDelve2 as i32,
                                tick: 1,
                                x_coord: 3421,
                                y_coord: 6435,
                                npc: Some(proto::event::Npc {
                                    id: 14707,
                                    room_id: 49601,
                                    r#type: Some(proto::event::npc::Type::Basic(())),
                                    ..Default::default()
                                }),
                                npc_attack: Some(proto::event::NpcAttacked {
                                    attack: proto::NpcAttack::MokhaiotlBall as i32,
                                    target: Some("Dedion".to_string()),
                                }),
                                ..Default::default()
                            },
                        ],
                    }
                    .encode_to_vec(),
                },
                StageStreamEntry {
                    id: "2-0".to_string(),
                    client_id: ClientId(1),
                    events: proto::EventStream {
                        events: vec![proto::Event {
                            r#type: proto::event::Type::NpcUpdate as i32,
                            stage: Stage::MokhaiotlDelve2 as i32,
                            tick: 1,
                            x_coord: 3421,
                            y_coord: 6435,
                            npc: Some(proto::event::Npc {
                                id: 14707,
                                room_id: 49601,
                                hitpoints: 36_045_350,
                                r#type: Some(proto::event::npc::Type::Basic(())),
                                ..Default::default()
                            }),
                            ..Default::default()
                        }],
                    }
                    .encode_to_vec(),
                },
                StageStreamEntry {
                    id: "3-0".to_string(),
                    client_id: ClientId(1),
                    events: proto::EventStream {
                        events: vec![
                            proto::Event {
                                r#type: proto::event::Type::NpcUpdate as i32,
                                stage: Stage::MokhaiotlDelve2 as i32,
                                tick: 2,
                                x_coord: 3421,
                                y_coord: 6435,
                                npc: Some(proto::event::Npc {
                                    id: 14707,
                                    room_id: 49601,
                                    hitpoints: 36_045_350,
                                    r#type: Some(proto::event::npc::Type::Basic(())),
                                    ..Default::default()
                                }),
                                ..Default::default()
                            },
                            proto::Event {
                                r#type: proto::event::Type::PlayerUpdate as i32,
                                stage: Stage::MokhaiotlDelve2 as i32,
                                tick: 3,
                                x_coord: 3423,
                                y_coord: 6430,
                                player: Some(proto::event::Player {
                                    name: "Dedion".to_string(),
                                    off_cooldown_tick: 3,
                                    hitpoints: Some(7_012_451),
                                    prayer: Some(5_505_116),
                                    attack: Some(7_733_347),
                                    strength: Some(7_733_347),
                                    defence: Some(7_733_347),
                                    ranged: Some(7_340_131),
                                    magic: Some(6_488_163),
                                    equipment_deltas: vec![988_714_356_441_089],
                                    active_prayers: Some(134_217_728),
                                    ..Default::default()
                                }),
                                ..Default::default()
                            },
                        ],
                    }
                    .encode_to_vec(),
                },
            ],
            0,
        );

        // Two cycles with no new entries send ticks 0 and 1, holding the rest.
        // Tick 1 sends an unidentified attack and tick 4 rewrites it.
        reader.broadcast();
        reader.broadcast();
        assert_eq!(reader.broadcast_cursor, 2);
        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 2);
        match &msgs[1] {
            SseMessage::Tick { tick: 1, data, .. } => {
                let attacks: Vec<_> = proto::EventStream::decode(data.as_ref())
                    .unwrap()
                    .events
                    .iter()
                    .filter_map(|e| e.npc_attack.as_ref().map(proto::event::NpcAttacked::attack))
                    .collect();
                assert_eq!(attacks, vec![proto::NpcAttack::MokhaiotlBall]);
            }
            other => panic!("expected Tick for tick 1, got {other:?}"),
        }

        reader.process_stream_entries(
            &[StageStreamEntry {
                id: "4-0".to_string(),
                client_id: ClientId(1),
                events: proto::EventStream {
                    events: vec![
                        proto::Event {
                            r#type: proto::event::Type::NpcUpdate as i32,
                            stage: Stage::MokhaiotlDelve2 as i32,
                            tick: 3,
                            x_coord: 3421,
                            y_coord: 6435,
                            npc: Some(proto::event::Npc {
                                id: 14707,
                                room_id: 49601,
                                hitpoints: 36_045_350,
                                r#type: Some(proto::event::npc::Type::Basic(())),
                                ..Default::default()
                            }),
                            ..Default::default()
                        },
                        proto::Event {
                            r#type: proto::event::Type::MokhaiotlAttackStyle as i32,
                            stage: Stage::MokhaiotlDelve2 as i32,
                            tick: 4,
                            mokhaiotl_attack_style: Some(proto::event::AttackStyle {
                                style: proto::event::attack_style::Style::Mage as i32,
                                npc_attack_tick: 1,
                            }),
                            ..Default::default()
                        },
                    ],
                }
                .encode_to_vec(),
            }],
            1,
        );

        let rewinds = crate::metrics::REWINDS_TOTAL.get();
        reader.broadcast();
        assert_eq!(crate::metrics::REWINDS_TOTAL.get(), rewinds + 1);

        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 3);
        assert!(matches!(msgs[0], SseMessage::Rewind { tick: 1, .. }));
        match &msgs[1] {
            SseMessage::Tick {
                tick: 1,
                tick_count: 1,
                data,
                ..
            } => {
                let attacks: Vec<_> = proto::EventStream::decode(data.as_ref())
                    .unwrap()
                    .events
                    .iter()
                    .filter_map(|e| e.npc_attack.as_ref().map(proto::event::NpcAttacked::attack))
                    .collect();
                assert_eq!(attacks, vec![proto::NpcAttack::MokhaiotlMageBall]);
            }
            other => panic!("expected re-sent Tick for tick 1, got {other:?}"),
        }
        assert!(matches!(
            msgs[2],
            SseMessage::Tick {
                tick: 2,
                tick_count: 1,
                ..
            }
        ));

        reader.broadcast();
        assert!(drain_messages(&mut rx).is_empty());
    }

    #[test]
    fn ending_stage_ignores_jitter_buffer() {
        let mut reader = new_active_reader(Stage::TobMaiden, None);

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(Stage::TobMaiden as i32), tx));
        drain_messages(&mut rx);

        reader.process_stream_entries(
            &[
                stream_entry("0-0", ClientId(1), 0),
                stream_entry("1-0", ClientId(1), 1),
            ],
            0,
        );

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
        let mut reader = new_active_reader(Stage::TobMaiden, None);

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(Stage::TobMaiden as i32), tx));
        drain_messages(&mut rx);

        reader.stage_state = StageState::Ending;
        reader.broadcast();

        assert_eq!(reader.stage_state, StageState::Inactive);
        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 1);
        assert!(matches!(msgs[0], SseMessage::StageEnd { .. }));
    }

    #[test]
    fn ending_stage_drains_after_pending_backfill() {
        let (backfill_tx, _rx) = mpsc::unbounded_channel();
        let clients = HashMap::from([(
            ClientId(1),
            challenge_client(
                ClientId(1),
                true,
                Stage::TobMaiden,
                None,
                StageStatus::Started,
            ),
        )]);
        let mut reader = ChallengeReader::new(
            "test".to_string(),
            challenge_state(Stage::TobMaiden, None),
            &clients,
            backfill_tx,
        );

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(6, Some(Stage::TobMaiden as i32), tx));
        drain_messages(&mut rx);

        // The stage ends before the initial backfill lands.
        reader.apply_challenge_update(&ChallengeServerUpdate::StageEnd {
            id: "test".to_string(),
            stage: Stage::TobMaiden,
            attempt: None,
        });
        reader.broadcast();

        assert_eq!(reader.stage_state, StageState::Ending);
        assert!(drain_messages(&mut rx).is_empty());

        reader.apply_backfill(
            BackfillResult {
                challenge_id: "test".to_string(),
                backfill_id: reader.backfill_id,
                entries: (0..4)
                    .map(|t| stream_entry(&format!("{t}-0"), ClientId(1), t))
                    .collect(),
                last_stream_id: "3-0".to_string(),
            },
            2,
        );

        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 3);
        assert!(matches!(
            msgs[0],
            SseMessage::Reset {
                stage_active: true,
                ..
            }
        ));
        assert!(matches!(
            msgs[1],
            SseMessage::ReplayChunk {
                start_tick: 0,
                tick_count: 2,
                ..
            }
        ));
        assert!(matches!(
            msgs[2],
            SseMessage::ReplayEnd { tick: Some(1), .. }
        ));

        // The ticks held back from the replay drain before the stage ends.
        reader.broadcast();
        reader.broadcast();

        assert_eq!(reader.stage_state, StageState::Inactive);
        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 3);
        assert!(matches!(msgs[0], SseMessage::Tick { tick: 2, .. }));
        assert!(matches!(msgs[1], SseMessage::Tick { tick: 3, .. }));
        assert!(matches!(
            msgs[2],
            SseMessage::StageEnd { stage, .. } if stage == Stage::TobMaiden as i32
        ));
    }

    #[test]
    fn primary_switches_when_inactive() {
        let (backfill_tx, mut backfill_rx) = mpsc::unbounded_channel();
        let clients = HashMap::from([
            (
                ClientId(1),
                challenge_client(
                    ClientId(1),
                    true,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
            (
                ClientId(2),
                challenge_client(
                    ClientId(2),
                    true,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
        ]);
        let mut reader = ChallengeReader::new(
            "test".to_string(),
            challenge_state(Stage::TobMaiden, None),
            &clients,
            backfill_tx,
        );
        reader.state = ReaderState::Active;
        reader.primary_client_id = Some(ClientId(1));

        // Drain the initial backfill request.
        backfill_rx.try_recv().unwrap();

        reader.process_stream_entries(&[stream_entry("1-0", ClientId(1), 0)], 0);

        // Primary goes inactive.
        let updated_clients = HashMap::from([
            (
                ClientId(1),
                challenge_client(
                    ClientId(1),
                    false,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
            (
                ClientId(2),
                challenge_client(
                    ClientId(2),
                    true,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
        ]);
        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(Stage::TobMaiden, None))),
                RedisResponse::ChallengeClients(updated_clients),
            ],
            1,
        );

        assert_eq!(reader.primary_client_id, Some(ClientId(2)));
        assert!(matches!(
            reader.state,
            ReaderState::Backfilling(Some(ClientId(2)))
        ));
        assert_eq!(reader.generation, 1);
        assert!(reader.tick_buffer.is_empty());
        assert!(reader.builder.is_none());

        let req = backfill_rx.try_recv().unwrap();
        assert_eq!(req.backfill_id, reader.backfill_id);
    }

    #[test]
    fn primary_switches_when_silent() {
        let (backfill_tx, mut backfill_rx) = mpsc::unbounded_channel();
        let clients = HashMap::from([
            (
                ClientId(1),
                challenge_client(
                    ClientId(1),
                    true,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
            (
                ClientId(2),
                challenge_client(
                    ClientId(2),
                    true,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
        ]);
        let mut reader = ChallengeReader::new(
            "test".to_string(),
            challenge_state(Stage::TobMaiden, None),
            &clients,
            backfill_tx,
        );
        reader.state = ReaderState::Active;
        reader.primary_client_id = Some(ClientId(1));
        backfill_rx.try_recv().unwrap();

        // Prior poll: client 2 sent events, client 1 did not.
        reader.process_stream_entries(&[stream_entry("1-0", ClientId(2), 1)], 10);

        // Current poll: no new events from client 1. Should switch to 2.
        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(Stage::TobMaiden, None))),
                RedisResponse::ChallengeClients(clients),
                RedisResponse::StageStream(vec![]),
            ],
            10,
        );

        assert_eq!(reader.primary_client_id, Some(ClientId(2)));
        assert!(matches!(
            reader.state,
            ReaderState::Backfilling(Some(ClientId(2)))
        ));
        assert_eq!(reader.generation, 1);
        backfill_rx.try_recv().unwrap();
    }

    #[test]
    fn silent_switch_prefers_recently_active_client() {
        let (backfill_tx, mut backfill_rx) = mpsc::unbounded_channel();
        let clients = HashMap::from([
            (
                ClientId(1),
                challenge_client(
                    ClientId(1),
                    true,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
            (
                ClientId(2),
                challenge_client(
                    ClientId(2),
                    true,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
            (
                ClientId(3),
                challenge_client(
                    ClientId(3),
                    true,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
        ]);
        let mut reader = ChallengeReader::new(
            "test".to_string(),
            challenge_state(Stage::TobMaiden, None),
            &clients,
            backfill_tx,
        );
        reader.state = ReaderState::Active;
        reader.primary_client_id = Some(ClientId(1));
        backfill_rx.try_recv().unwrap();

        // Prior polls: client 3 had high activity early, client 2 sent
        // events recently.
        reader.process_stream_entries(
            &[
                stream_entry("1-0", ClientId(3), 1),
                stream_entry("2-0", ClientId(3), 2),
                stream_entry("3-0", ClientId(3), 3),
                stream_entry("4-0", ClientId(3), 4),
                stream_entry("5-0", ClientId(3), 5),
            ],
            2,
        );
        reader.process_stream_entries(&[stream_entry("6-0", ClientId(2), 1)], 10);

        // Poll contains no new events. Should switch to recently active client
        // 2 over client 3, which is still silent.
        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(Stage::TobMaiden, None))),
                RedisResponse::ChallengeClients(clients),
                RedisResponse::StageStream(vec![]),
            ],
            10,
        );

        assert_eq!(reader.primary_client_id, Some(ClientId(2)));
        assert!(matches!(
            reader.state,
            ReaderState::Backfilling(Some(ClientId(2)))
        ));
        backfill_rx.try_recv().unwrap();
    }

    #[test]
    fn stalls_when_all_clients_are_silent() {
        let mut reader = new_active_reader(Stage::TobMaiden, None);

        let clients = HashMap::from([
            (
                ClientId(1),
                challenge_client(
                    ClientId(1),
                    true,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
            (
                ClientId(2),
                challenge_client(
                    ClientId(2),
                    true,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
        ]);

        // Nobody has sent events by tick 10.
        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(Stage::TobMaiden, None))),
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
                since: 10,
                ..
            }
        ));
        assert_eq!(reader.generation, 0);
    }

    #[test]
    fn silence_stall_recovers_when_stream_entries_arrive() {
        let mut reader = new_active_reader(Stage::TobMaiden, None);

        let clients = HashMap::from([(
            ClientId(1),
            challenge_client(
                ClientId(1),
                true,
                Stage::TobMaiden,
                None,
                StageStatus::Started,
            ),
        )]);

        // No events by tick 10 triggers a stall.
        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(Stage::TobMaiden, None))),
                RedisResponse::ChallengeClients(clients.clone()),
                RedisResponse::StageStream(vec![]),
            ],
            10,
        );
        assert!(matches!(
            reader.state,
            ReaderState::Stalled {
                reason: StalledReason::AllSilent,
                ..
            }
        ));

        // Stream entries arrive on the next poll.
        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(Stage::TobMaiden, None))),
                RedisResponse::ChallengeClients(clients),
                RedisResponse::StageStream(vec![stream_entry("5-0", ClientId(1), 5)]),
            ],
            11,
        );
        assert_eq!(reader.state, ReaderState::Backfilling(Some(ClientId(1))));
        assert_eq!(reader.poll_cursor, "5-0");
    }

    #[test]
    fn no_switch_when_primary_is_healthy() {
        let mut reader = new_active_reader(Stage::TobMaiden, None);

        // Prior poll: primary sent events recently.
        reader.process_stream_entries(&[stream_entry("1-0", ClientId(1), 1)], 8);

        let clients = HashMap::from([
            (
                ClientId(1),
                challenge_client(
                    ClientId(1),
                    true,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
            (
                ClientId(2),
                challenge_client(
                    ClientId(2),
                    true,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
        ]);
        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(Stage::TobMaiden, None))),
                RedisResponse::ChallengeClients(clients),
                RedisResponse::StageStream(vec![]),
            ],
            10,
        );

        assert_eq!(reader.primary_client_id, Some(ClientId(1)));
        assert_eq!(reader.state, ReaderState::Active);
        assert_eq!(reader.generation, 0);
    }

    #[test]
    fn primary_is_kept_between_stages() {
        let mut reader = new_active_reader(Stage::TobMaiden, None);

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(7, Some(Stage::TobMaiden as i32), tx));
        drain_messages(&mut rx);

        reader.process_stream_entries(&[stream_entry("1-0", ClientId(1), 1)], 4);

        // The stage ends after the primary has been silent past the threshold.
        reader.apply_challenge_update(&ChallengeServerUpdate::StageEnd {
            id: "challenge-id".to_string(),
            stage: Stage::TobMaiden,
            attempt: None,
        });
        let completed_clients = HashMap::from([(
            ClientId(1),
            challenge_client(
                ClientId(1),
                true,
                Stage::TobMaiden,
                None,
                StageStatus::Completed,
            ),
        )]);
        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(Stage::TobMaiden, None))),
                RedisResponse::ChallengeClients(completed_clients.clone()),
                RedisResponse::StageStream(vec![]),
            ],
            10,
        );

        assert_eq!(reader.state, ReaderState::Active);
        assert_eq!(reader.primary_client_id, Some(ClientId(1)));

        reader.broadcast();
        reader.broadcast();

        assert_eq!(reader.stage_state, StageState::Inactive);
        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 3);
        assert!(matches!(msgs[0], SseMessage::Tick { tick: 0, .. }));
        assert!(matches!(msgs[1], SseMessage::Tick { tick: 1, .. }));
        assert!(matches!(
            msgs[2],
            SseMessage::StageEnd { stage, .. } if stage == Stage::TobMaiden as i32
        ));

        // The primary sends nothing between stages, as no stream is open.
        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(Stage::TobMaiden, None))),
                RedisResponse::ChallengeClients(completed_clients),
            ],
            12,
        );

        assert_eq!(reader.state, ReaderState::Active);
        assert_eq!(reader.primary_client_id, Some(ClientId(1)));

        let started_clients = HashMap::from([(
            ClientId(1),
            challenge_client(
                ClientId(1),
                true,
                Stage::TobBloat,
                None,
                StageStatus::Started,
            ),
        )]);
        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(Stage::TobBloat, None))),
                RedisResponse::ChallengeClients(started_clients),
            ],
            13,
        );

        assert_eq!(reader.stage, Stage::TobBloat);
        assert_eq!(reader.state, ReaderState::Active);
        assert_eq!(reader.primary_client_id, Some(ClientId(1)));
        assert_eq!(reader.generation, 0);

        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 1);
        assert!(matches!(
            msgs[0],
            SseMessage::StageChange {
                stage,
                attempt: None
            } if stage == Stage::TobBloat as i32
        ));
    }

    #[test]
    fn stalls_when_clients_leave_between_stages() {
        let mut reader = new_active_reader(Stage::TobMaiden, None);

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(3, Some(Stage::TobMaiden as i32), tx));
        reader.stage_state = StageState::Ending;
        reader.broadcast();
        drain_messages(&mut rx);

        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(Stage::TobMaiden, None))),
                RedisResponse::ChallengeClients(HashMap::new()),
            ],
            6,
        );

        assert!(matches!(
            reader.state,
            ReaderState::Stalled {
                reason: StalledReason::NoClients,
                since: 6,
            }
        ));
        assert_eq!(reader.primary_client_id, None);

        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 1);
        assert!(matches!(
            msgs[0],
            SseMessage::Stalled {
                reason: StalledReason::NoClients
            }
        ));
    }

    #[test]
    fn stalls_when_clients_go_inactive_between_stages() {
        let mut reader = new_active_reader(Stage::TobMaiden, None);

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(4, Some(Stage::TobMaiden as i32), tx));
        reader.stage_state = StageState::Ending;
        reader.broadcast();
        drain_messages(&mut rx);

        let inactive_clients = HashMap::from([(
            ClientId(1),
            challenge_client(
                ClientId(1),
                false,
                Stage::TobMaiden,
                None,
                StageStatus::Completed,
            ),
        )]);
        reader.apply_poll_responses(
            vec![
                RedisResponse::ChallengeState(Some(challenge_state(Stage::TobMaiden, None))),
                RedisResponse::ChallengeClients(inactive_clients),
            ],
            7,
        );

        assert!(matches!(
            reader.state,
            ReaderState::Stalled {
                reason: StalledReason::AllInactive,
                since: 7,
            }
        ));
        assert_eq!(reader.primary_client_id, None);

        let msgs = drain_messages(&mut rx);
        assert_eq!(msgs.len(), 1);
        assert!(matches!(
            msgs[0],
            SseMessage::Stalled {
                reason: StalledReason::AllInactive
            }
        ));
    }

    #[test]
    fn backfill_after_primary_switch_uses_primary_change_reason() {
        let (backfill_tx, _rx) = mpsc::unbounded_channel();
        let clients = HashMap::from([
            (
                ClientId(1),
                challenge_client(
                    ClientId(1),
                    true,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
            (
                ClientId(2),
                challenge_client(
                    ClientId(2),
                    true,
                    Stage::TobMaiden,
                    None,
                    StageStatus::Started,
                ),
            ),
        ]);
        let mut reader = ChallengeReader::new(
            "test".to_string(),
            challenge_state(Stage::TobMaiden, None),
            &clients,
            backfill_tx,
        );
        // Simulate initial backfill completing then primary switch.
        reader.state = ReaderState::Backfilling(Some(ClientId(2)));
        reader.primary_client_id = Some(ClientId(2));
        reader.generation = 1;

        let (tx, mut rx) = mpsc::unbounded_channel();
        reader.add_subscriber(Subscriber::new(1, Some(Stage::TobMaiden as i32), tx));
        drain_messages(&mut rx);

        reader.apply_backfill(
            BackfillResult {
                challenge_id: "test".to_string(),
                backfill_id: reader.backfill_id,
                entries: vec![stream_entry("1-0", ClientId(2), 1)],
                last_stream_id: "1-0".to_string(),
            },
            0,
        );

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

//! Deterministic scenario harness for the challenge lifecycle.
//!
//! A scenario scripts clients issuing timed commands against a real
//! [`Coordinator`] under tokio's paused clock. Actions sharing an instant are
//! issued serially in declaration order, so arrival order is always scripted
//! rather than raced at the scheduler.
//!
//! Following a run, structural invariants of the output are checked.

mod scenarios;

use core::time::Duration;
use std::collections::{BTreeMap, BTreeSet, HashSet, VecDeque};
use std::ops::Index;
use std::slice;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use tokio::time::Instant;

use tokio::sync::{mpsc, watch};

use super::challenge::{
    ChallengeClaim, ChallengeServerUpdate, ChallengeSignal, ChallengeStore, Claim, Rejoin, Start,
    StoreError,
};
use super::coordinator::Coordinator;
use super::core::apply::apply;
use super::core::command::{
    ClientStatus, ClientStatusChange, Command, Create, Envelope, Finish, Join, StageProgress,
    Update,
};
use super::core::deadline::LifecycleConfig;
use super::core::event::{Cause, JournalEntry, LifecycleEvent};
use super::core::state::{
    ChallengePhase, ChallengeState, Processing, PublishedClient, Snapshot, Trigger,
};
use super::core::types::{
    ChallengeMode, ChallengeStatus, ChallengeType, ClientId, MsgId, ProcessingError,
    ProcessingOutcome, RecordingType, ReportedTimes, SessionToken, Stage, StageExt, StageStatus,
    UserId, Uuid,
};
use crate::processing::{ProcessingRequest, StageProcessor};

/// A scripted client action, issued at a scenario-relative time.
pub enum Action {
    Start {
        challenge_type: ChallengeType,
        mode: ChallengeMode,
        party: Vec<String>,
        stage: Stage,
    },
    Update {
        mode: Option<ChallengeMode>,
        stage: Option<StageProgress>,
        party: Option<Vec<String>>,
    },
    Finish {
        times: Option<ReportedTimes>,
        soft: bool,
    },
    Status(ClientStatus),
    /// Reconnects to the client's current challenge from a new connection.
    Reconnect {
        token: &'static str,
    },
    /// A status claim from a connection holding a specific session token.
    StatusAs(ClientStatus, &'static str),
}

#[derive(Clone)]
struct Identity {
    name: &'static str,
    user_id: UserId,
    client_id: ClientId,
    session_token: SessionToken,
    recording_type: RecordingType,
}

pub struct Client {
    identity: Identity,
    actions: Vec<(u64, Action)>,
}

impl Client {
    pub fn participant(name: &'static str, id: i64) -> Self {
        Client::new(name, id, RecordingType::Participant)
    }

    pub fn spectator(name: &'static str, id: i64) -> Self {
        Client::new(name, id, RecordingType::Spectator)
    }

    fn new(name: &'static str, id: i64, recording_type: RecordingType) -> Self {
        Client {
            identity: Identity {
                name,
                user_id: UserId(id),
                client_id: ClientId(10 * id),
                session_token: format!("tok{id}").into(),
                recording_type,
            },
            actions: Vec::new(),
        }
    }

    /// Schedules an action at a scenario-relative time, in milliseconds.
    #[must_use]
    pub fn at(mut self, at: u64, action: Action) -> Self {
        self.actions.push((at, action));
        self
    }

    /// Overrides the client's user ID.
    #[must_use]
    pub fn with_user(mut self, id: i64) -> Self {
        self.identity.user_id = UserId(id);
        self
    }
}

pub struct Scenario {
    pub clients: Vec<Client>,
    /// Virtual time to run to after the last action.
    pub run_until: u64,
}

/// A client's view of one issued action.
pub struct Outcome {
    pub client: &'static str,
    pub at: u64,
    pub response: Option<Snapshot>,
}

pub struct ScenarioResult {
    pub journals: CollectedJournals,
    pub outcomes: Vec<Outcome>,
    pub snapshots: BTreeMap<Uuid, Snapshot>,
    pub projections: BTreeMap<Uuid, Snapshot>,
    /// Milestones announced to external consumers, in publish order.
    pub updates: Vec<(Uuid, ChallengeServerUpdate)>,
    /// IDs of every command sent to each challenge's inbox, in send order.
    pub inboxes: BTreeMap<Uuid, Vec<MsgId>>,
    /// Challenges whose state was deleted from the store.
    pub deleted: BTreeSet<Uuid>,
}

impl ScenarioResult {
    /// Expects exactly one challenge in the scenario, returning its journal.
    pub fn only_challenge(&self) -> (Uuid, &[JournalEntry]) {
        assert_eq!(
            self.journals.len(),
            1,
            "scenario produced {} challenges",
            self.journals.len(),
        );
        let (uuid, journal) = self.journals.into_iter().next().unwrap();
        (*uuid, journal)
    }

    /// Final projected status of the scenario's only challenge.
    pub fn only_status(&self) -> ChallengeStatus {
        let (uuid, _) = self.only_challenge();
        self.projections[&uuid].status
    }

    /// A canonical serialization of every challenge's journal.
    pub fn trace(&self) -> String {
        serde_json::to_string(&self.journals.journals).expect("journals should serialize")
    }

    /// Returns the trace with each uuid replaced by its creation index.
    pub fn normalized_trace(&self) -> String {
        let ordered: Vec<&Vec<JournalEntry>> = self
            .journals
            .into_iter()
            .map(|(_, journal)| journal)
            .collect();
        let mut trace = serde_json::to_string(&ordered).expect("journals should serialize");
        for (index, (uuid, _)) in self.journals.into_iter().enumerate() {
            trace = trace.replace(&uuid.to_string(), &format!("challenge-{index}"));
        }
        trace
    }
}

/// FNV-1a hash.
pub fn hash(s: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in s.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    hash
}

/// A deterministic PRNG.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed)
    }

    pub fn draw(&mut self) -> u64 {
        // splitmix64
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// Returns a uniform value in `0..bound`.
    pub fn below(&mut self, bound: u64) -> u64 {
        self.draw() % bound
    }
}

/// Milliseconds per jitter step. Deltas are quantized so that perturbed
/// actions can still collide on the same instant instead of jitter breaking
/// every tie.
const JITTER_STEP_MS: u64 = 10;

/// Reshapes a scenario's cross-client interleaving without changing any
/// client's own action order.
///
/// Clients are shuffled to vary delivery order, and jitter is applied to
/// gaps between actions.
pub fn perturb(scenario: &mut Scenario, rng: &mut Rng, jitter_ms: u64) {
    let mut keyed: Vec<(u64, Client)> = scenario
        .clients
        .drain(..)
        .map(|client| (rng.draw(), client))
        .collect();
    keyed.sort_by_key(|(key, _)| *key);
    scenario
        .clients
        .extend(keyed.into_iter().map(|(_, client)| client));

    let steps = jitter_ms / JITTER_STEP_MS;
    for client in &mut scenario.clients {
        let mut original = 0;
        let mut perturbed = 0;
        for (at, _) in &mut client.actions {
            let gap = *at - original;
            original = *at;
            // gap + [-steps, +steps] * STEP, clamped at zero.
            let stretched = gap + rng.below(2 * steps + 1) * JITTER_STEP_MS;
            perturbed += stretched.saturating_sub(steps * JITTER_STEP_MS);
            *at = perturbed;
        }
    }
}

type SignalSink = Arc<Mutex<Option<mpsc::Sender<ChallengeSignal>>>>;

/// Identity of a party for routing, built from its raw names.
fn party_identity(challenge_type: ChallengeType, party: &[String]) -> String {
    let mut sorted: Vec<&str> = party.iter().map(String::as_str).collect();
    sorted.sort_unstable();
    format!("{challenge_type:?}-{}", sorted.join("-"))
}

/// A record of commands sent to each challenge.
#[derive(Default)]
struct CollectorInboxes {
    entries: BTreeMap<Uuid, Vec<Envelope>>,
    sinks: BTreeMap<Uuid, mpsc::Sender<Envelope>>,
}

/// Party routing state written by challenge starts.
#[derive(Default)]
struct CollectorRouting {
    directory: BTreeMap<String, Uuid>,
    clients: BTreeMap<ClientId, Uuid>,
    existing: BTreeSet<Uuid>,
    /// Challenges whose state has been deleted from the store.
    deleted: BTreeSet<Uuid>,
}

/// In-memory [`ChallengeStore`] collecting everything written through it.
/// Update signals are delivered synchronously on projection, keeping runs
/// deterministic.
#[derive(Clone, Default)]
pub(crate) struct Collector {
    inboxes: Arc<Mutex<CollectorInboxes>>,
    routing: Arc<Mutex<CollectorRouting>>,
    journals: Arc<Mutex<CollectedJournals>>,
    projections: Arc<Mutex<BTreeMap<Uuid, Snapshot>>>,
    updates: Arc<Mutex<Vec<(Uuid, ChallengeServerUpdate)>>>,
    signals: SignalSink,
}

impl Collector {
    /// The journal of challenge `uuid`, in order.
    pub fn journal(&self, uuid: Uuid) -> Vec<JournalEntry> {
        self.journals
            .lock()
            .expect("collector lock poisoned")
            .journals
            .get(&uuid)
            .cloned()
            .unwrap_or_default()
    }

    /// Whether the state of challenge `uuid` has been deleted.
    pub fn is_deleted(&self, uuid: Uuid) -> bool {
        self.routing
            .lock()
            .expect("collector lock poisoned")
            .deleted
            .contains(&uuid)
    }

    /// How many times the finish of challenge `uuid` has been announced.
    pub fn finish_announcements(&self, uuid: Uuid) -> usize {
        self.updates
            .lock()
            .expect("collector lock poisoned")
            .iter()
            .filter(|(id, update)| *id == uuid && *update == ChallengeServerUpdate::Finish)
            .count()
    }

    fn collector_claim(&self, uuid: Uuid) -> CollectorClaim {
        CollectorClaim {
            uuid,
            inboxes: self.inboxes.clone(),
            routing: self.routing.clone(),
            journals: self.journals.clone(),
            projections: self.projections.clone(),
            updates: self.updates.clone(),
            signals: self.signals.clone(),
        }
    }

    /// Appends a command to a challenge's inbox record, delivering it
    /// synchronously to the inbox's follower if one is registered.
    async fn enqueue(&self, uuid: Uuid, cmd: Command) -> MsgId {
        let (envelope, sink) = {
            let mut inboxes = self.inboxes.lock().expect("collector lock poisoned");
            let entries = inboxes.entries.entry(uuid).or_default();
            // Ids are 1-based positions within the challenge's own inbox,
            // as each inbox is an independent stream.
            let id = MsgId::sequence(u64::try_from(entries.len()).expect("inbox fits") + 1);
            let envelope = Envelope { id, cmd };
            entries.push(envelope.clone());
            (envelope, inboxes.sinks.get(&uuid).cloned())
        };
        let id = envelope.id;
        if let Some(sink) = sink {
            let _ = sink.send(envelope).await;
        }
        id
    }
}

/// Claim on one challenge, journaling into its collector.
struct CollectorClaim {
    uuid: Uuid,
    inboxes: Arc<Mutex<CollectorInboxes>>,
    routing: Arc<Mutex<CollectorRouting>>,
    journals: Arc<Mutex<CollectedJournals>>,
    projections: Arc<Mutex<BTreeMap<Uuid, Snapshot>>>,
    updates: Arc<Mutex<Vec<(Uuid, ChallengeServerUpdate)>>>,
    signals: SignalSink,
}

/// Journals of every challenge in a run.
#[derive(Clone, Default)]
pub struct CollectedJournals {
    journals: BTreeMap<Uuid, Vec<JournalEntry>>,
    creation_order: Vec<Uuid>,
}

impl CollectedJournals {
    pub fn len(&self) -> usize {
        self.journals.len()
    }

    pub fn is_empty(&self) -> bool {
        self.journals.is_empty()
    }
}

impl Index<&Uuid> for CollectedJournals {
    type Output = Vec<JournalEntry>;

    fn index(&self, uuid: &Uuid) -> &Vec<JournalEntry> {
        &self.journals[uuid]
    }
}

/// Iterates journals in challenge creation order.
pub struct JournalsIter<'a> {
    journals: &'a CollectedJournals,
    order: slice::Iter<'a, Uuid>,
}

impl<'a> Iterator for JournalsIter<'a> {
    type Item = (&'a Uuid, &'a Vec<JournalEntry>);

    fn next(&mut self) -> Option<Self::Item> {
        let uuid = self.order.next()?;
        Some((uuid, &self.journals.journals[uuid]))
    }
}

impl<'a> IntoIterator for &'a CollectedJournals {
    type Item = (&'a Uuid, &'a Vec<JournalEntry>);
    type IntoIter = JournalsIter<'a>;

    fn into_iter(self) -> Self::IntoIter {
        JournalsIter {
            journals: self,
            order: self.creation_order.iter(),
        }
    }
}

#[async_trait]
impl ChallengeStore for Collector {
    // Claims any existing challenge not excluded. The sim does not model
    // lease deadlines.
    async fn claim_unowned(
        &self,
        batch_size: usize,
        exclude: &[Uuid],
    ) -> Result<Vec<Claim>, StoreError> {
        let claimable: Vec<Uuid> = {
            let routing = self.routing.lock().expect("collector lock poisoned");
            routing
                .existing
                .iter()
                .filter(|uuid| !exclude.contains(uuid))
                .take(batch_size)
                .copied()
                .collect()
        };
        Ok(claimable
            .into_iter()
            .map(|uuid| Claim::new(uuid, Box::new(self.collector_claim(uuid))))
            .collect())
    }

    async fn start(&self, create: Create) -> Result<Start, StoreError> {
        let client_id = create.client_id;
        let party = party_identity(create.challenge_type, &create.party);
        let (joined, uuid, left) = {
            let mut routing = self.routing.lock().expect("collector lock poisoned");
            let incumbent = routing.directory.get(&party).copied().filter(|incumbent| {
                self.projections
                    .lock()
                    .expect("collector lock poisoned")
                    .get(incumbent)
                    .is_some_and(|snapshot| {
                        snapshot.phase == ChallengePhase::Active
                            && !create.stage.later_stages().contains(&snapshot.stage)
                    })
            });
            if let Some(incumbent) = incumbent {
                let previous = routing.clients.insert(client_id, incumbent);
                let left = previous.filter(|p| *p != incumbent && routing.existing.contains(p));
                (true, incumbent, left)
            } else {
                let uuid = Uuid::new_v4();
                routing.directory.insert(party, uuid);
                routing.existing.insert(uuid);
                let previous = routing.clients.insert(client_id, uuid);
                let left = previous.filter(|p| routing.existing.contains(p));
                (false, uuid, left)
            }
        };

        // The client leaves any challenge it was still recorded in.
        if let Some(previous) = left {
            self.enqueue(
                previous,
                Command::ClientStatus(ClientStatusChange {
                    user_id: create.user_id,
                    client_id,
                    session_token: create.session_token.clone(),
                    status: ClientStatus::Disconnected,
                }),
            )
            .await;
        }

        if joined {
            let id = self.enqueue(uuid, Command::Join(Join::from(&create))).await;
            Ok(Start::Joined { uuid, id })
        } else {
            let id = self.enqueue(uuid, Command::Create(create)).await;
            Ok(Start::Created {
                claim: Claim::new(uuid, Box::new(self.collector_claim(uuid))),
                id,
            })
        }
    }

    async fn rejoin(&self, uuid: Uuid, join: &Join) -> Result<Rejoin, StoreError> {
        {
            let routing = self.routing.lock().expect("collector lock poisoned");
            if !routing.existing.contains(&uuid) {
                return Ok(Rejoin::UnknownChallenge);
            }
        }
        let terminated = self
            .projections
            .lock()
            .expect("collector lock poisoned")
            .get(&uuid)
            .is_some_and(|snapshot| snapshot.phase == ChallengePhase::Terminated);
        if terminated {
            return Ok(Rejoin::UnknownChallenge);
        }
        {
            let mut routing = self.routing.lock().expect("collector lock poisoned");
            let elsewhere = routing
                .clients
                .get(&join.client_id)
                .is_some_and(|current| *current != uuid);
            if elsewhere {
                return Ok(Rejoin::AlreadyInChallenge);
            }
            routing.clients.insert(join.client_id, uuid);
        }
        Ok(Rejoin::Queued(
            self.enqueue(uuid, Command::Join(join.clone())).await,
        ))
    }

    async fn send(&self, uuid: Uuid, cmd: &Command) -> Result<Option<MsgId>, StoreError> {
        let exists = self
            .routing
            .lock()
            .expect("collector lock poisoned")
            .existing
            .contains(&uuid);
        if !exists {
            return Ok(None);
        }
        Ok(Some(self.enqueue(uuid, cmd.clone()).await))
    }

    async fn send_to_current_challenge(
        &self,
        client: ClientId,
        cmd: &Command,
    ) -> Result<Option<(Uuid, MsgId)>, StoreError> {
        let uuid = self
            .routing
            .lock()
            .expect("collector lock poisoned")
            .clients
            .get(&client)
            .copied();
        let Some(uuid) = uuid else {
            return Ok(None);
        };

        let terminated = self
            .projections
            .lock()
            .expect("collector lock poisoned")
            .get(&uuid)
            .is_some_and(|snapshot| snapshot.phase == ChallengePhase::Terminated);
        if terminated {
            return Ok(None);
        }
        Ok(Some((uuid, self.enqueue(uuid, cmd.clone()).await)))
    }

    async fn read(&self, uuid: Uuid) -> Result<Option<Snapshot>, StoreError> {
        Ok(self
            .projections
            .lock()
            .expect("collector lock poisoned")
            .get(&uuid)
            .cloned())
    }

    fn subscribe(&self, sink: mpsc::Sender<ChallengeSignal>) {
        *self.signals.lock().expect("collector lock poisoned") = Some(sink);
    }
}

#[async_trait]
impl ChallengeClaim for CollectorClaim {
    async fn load(&self) -> Result<Vec<JournalEntry>, StoreError> {
        Ok(self
            .journals
            .lock()
            .expect("collector lock poisoned")
            .journals
            .get(&self.uuid)
            .cloned()
            .unwrap_or_default())
    }

    fn follow(&self, from: MsgId, sink: mpsc::Sender<Envelope>) {
        let mut inboxes = self.inboxes.lock().expect("collector lock poisoned");
        if let Some(entries) = inboxes.entries.get(&self.uuid) {
            for envelope in entries.iter().filter(|e| e.id > from) {
                sink.try_send(envelope.clone())
                    .expect("sim inbox backlog exceeds channel capacity");
            }
        }
        inboxes.sinks.insert(self.uuid, sink);
    }

    async fn append(&self, batch: &[JournalEntry]) -> Result<(), StoreError> {
        let mut collected = self.journals.lock().expect("collector lock poisoned");
        if !collected.journals.contains_key(&self.uuid) {
            collected.creation_order.push(self.uuid);
        }
        collected
            .journals
            .entry(self.uuid)
            .or_default()
            .extend(batch.iter().cloned());
        Ok(())
    }

    async fn project(
        &self,
        snapshot: &Snapshot,
        _clients: &[PublishedClient],
    ) -> Result<(), StoreError> {
        self.projections
            .lock()
            .expect("collector lock poisoned")
            .insert(self.uuid, snapshot.clone());
        let sink = self
            .signals
            .lock()
            .expect("collector lock poisoned")
            .clone();
        if let Some(sink) = sink {
            let _ = sink
                .send(ChallengeSignal::Updated {
                    uuid: self.uuid,
                    cursor: snapshot.cursor,
                })
                .await;
        }
        Ok(())
    }

    async fn announce(&self, update: &ChallengeServerUpdate) -> Result<(), StoreError> {
        self.updates
            .lock()
            .expect("collector lock poisoned")
            .push((self.uuid, *update));
        Ok(())
    }

    async fn renew(&self) -> Result<(), StoreError> {
        Ok(())
    }

    async fn release(&self) -> Result<(), StoreError> {
        Ok(())
    }

    async fn delete(&self, state: &ChallengeState) -> Result<(), StoreError> {
        {
            let mut routing = self.routing.lock().expect("collector lock poisoned");
            routing.existing.remove(&self.uuid);
            let party = party_identity(state.challenge_type, &state.party);
            if routing.directory.get(&party) == Some(&self.uuid) {
                routing.directory.remove(&party);
            }
            for client in &state.recorded_by {
                if routing.clients.get(client) == Some(&self.uuid) {
                    routing.clients.remove(client);
                }
            }
            routing.deleted.insert(self.uuid);
        }
        let sink = self
            .signals
            .lock()
            .expect("collector lock poisoned")
            .clone();
        if let Some(sink) = sink {
            let _ = sink
                .send(ChallengeSignal::Deleted { uuid: self.uuid })
                .await;
        }
        Ok(())
    }
}

/// A scripted resolution of a processing run.
pub(crate) enum ProcessingAttempt {
    /// Resolve with `result` after a delay in virtual milliseconds.
    Resolve(u64, Result<ProcessingOutcome, ProcessingError>),
    /// Hang until aborted.
    Hang,
}

/// A scripted [`StageProcessor`], resolving each attempt with the next
/// scripted result in order. Attempts past the script's end complete
/// instantly.
#[derive(Default)]
pub(crate) struct ScriptedProcessor {
    script: Mutex<VecDeque<ProcessingAttempt>>,
    requests: Mutex<Vec<ProcessingRequest>>,
}

impl ScriptedProcessor {
    pub fn new(script: Vec<ProcessingAttempt>) -> Arc<Self> {
        Arc::new(ScriptedProcessor {
            script: Mutex::new(script.into()),
            requests: Mutex::default(),
        })
    }

    /// Every processing request received, in arrival order.
    pub fn requests(&self) -> Vec<ProcessingRequest> {
        self.requests
            .lock()
            .expect("processor lock poisoned")
            .clone()
    }
}

#[async_trait]
impl StageProcessor for ScriptedProcessor {
    async fn process(
        &self,
        request: ProcessingRequest,
    ) -> Result<ProcessingOutcome, ProcessingError> {
        self.requests
            .lock()
            .expect("processor lock poisoned")
            .push(request);
        let attempt = self
            .script
            .lock()
            .expect("processor lock poisoned")
            .pop_front();
        match attempt {
            Some(ProcessingAttempt::Resolve(delay_ms, result)) => {
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                result
            }
            Some(ProcessingAttempt::Hang) => std::future::pending().await,
            None => Ok(match request.trigger {
                Trigger::Stage { .. } => ProcessingOutcome::Stage {
                    status: StageStatus::Completed,
                    ticks: 0,
                },
                Trigger::Create { .. } | Trigger::Finish { .. } => ProcessingOutcome::Boundary,
            }),
        }
    }
}

/// Runs a scenario to completion under default lifecycle timings and checks
/// structural invariants.
pub async fn run(scenario: Scenario) -> ScenarioResult {
    run_with(RunOptions::default(), scenario).await
}

#[derive(Default)]
pub struct RunOptions {
    /// Lifecycle timings for every challenge in the scenario.
    pub config: LifecycleConfig,
    /// Serves the challenges' stage processing runs.
    pub processor: Option<Arc<dyn StageProcessor>>,
}

impl From<LifecycleConfig> for RunOptions {
    fn from(config: LifecycleConfig) -> Self {
        RunOptions {
            config,
            processor: None,
        }
    }
}

/// Runs a scenario to completion under specific options and checks
/// structural invariants.
pub async fn run_with(options: impl Into<RunOptions>, scenario: Scenario) -> ScenarioResult {
    let RunOptions { config, processor } = options.into();
    let collector = Collector::default();
    let (_tx, rx) = watch::channel(false);
    let mut coordinator =
        Coordinator::with_store(Arc::new(collector.clone()), rx).with_config(config.clone());
    if let Some(processor) = processor {
        coordinator = coordinator.with_processor(processor);
    }
    let coordinator = Arc::new(coordinator);
    let started = Instant::now();

    let mut identities = Vec::new();
    let mut schedule: BTreeMap<u64, Vec<(usize, Action)>> = BTreeMap::new();
    for (index, client) in scenario.clients.into_iter().enumerate() {
        identities.push(client.identity);
        for (at, action) in client.actions {
            schedule.entry(at).or_default().push((index, action));
        }
    }

    let uuid_slots: Vec<Arc<Mutex<Option<Uuid>>>> =
        identities.iter().map(|_| Arc::default()).collect();
    let mut outcomes = Vec::new();

    for (at, group) in schedule {
        tokio::time::sleep_until(started + Duration::from_millis(at)).await;

        // Same-instant actions issue serially in declaration order.
        for (index, action) in group {
            let outcome = issue(
                &coordinator,
                &mut identities[index],
                &uuid_slots[index],
                at,
                action,
            )
            .await;
            outcomes.push(outcome);
        }
    }

    // Run past the end of the scenario to let any remaining deadlines fire.
    tokio::time::sleep_until(started + Duration::from_millis(scenario.run_until)).await;
    tokio::time::sleep(Duration::from_millis(1)).await;

    let journals = collector
        .journals
        .lock()
        .expect("collector lock poisoned")
        .clone();
    let projections = collector
        .projections
        .lock()
        .expect("collector lock poisoned")
        .clone();
    let updates = collector
        .updates
        .lock()
        .expect("collector lock poisoned")
        .clone();
    let inboxes = collector
        .inboxes
        .lock()
        .expect("collector lock poisoned")
        .entries
        .iter()
        .map(|(uuid, entries)| (*uuid, entries.iter().map(|e| e.id).collect()))
        .collect();
    let deleted = collector
        .routing
        .lock()
        .expect("collector lock poisoned")
        .deleted
        .clone();

    // Terminated challenges' snapshots outlive them.
    let mut snapshots = BTreeMap::new();
    for (uuid, _) in &journals {
        if let Some(snapshot) = coordinator.snapshot(*uuid).await
            && snapshot.phase != ChallengePhase::Terminated
        {
            snapshots.insert(*uuid, snapshot);
        }
    }

    let result = ScenarioResult {
        journals,
        outcomes,
        snapshots,
        projections,
        updates,
        inboxes,
        deleted,
    };
    check_invariants(&result, &config);
    result
}

#[allow(clippy::too_many_lines)]
async fn issue(
    coordinator: &Coordinator,
    identity: &mut Identity,
    current_uuid: &Mutex<Option<Uuid>>,
    at: u64,
    action: Action,
) -> Outcome {
    let response = match action {
        Action::Start {
            challenge_type,
            mode,
            party,
            stage,
        } => {
            let response = coordinator
                .create_or_join_challenge(Create {
                    user_id: identity.user_id,
                    client_id: identity.client_id,
                    session_token: identity.session_token.clone(),
                    plugin_version: "0.9.14".into(),
                    runelite_version: "1.12.31.1".into(),
                    challenge_type,
                    mode,
                    party,
                    stage,
                    recording_type: identity.recording_type,
                })
                .await;
            if let Some(snapshot) = &response {
                *current_uuid.lock().expect("uuid slot poisoned") = Some(snapshot.uuid);
            }
            response
        }
        Action::Update { mode, stage, party } => {
            let uuid = current_challenge(identity, current_uuid);
            coordinator
                .update(
                    uuid,
                    Update {
                        user_id: identity.user_id,
                        client_id: identity.client_id,
                        session_token: identity.session_token.clone(),
                        mode,
                        stage,
                        party,
                    },
                )
                .await
                .ok()
        }
        Action::Finish { times, soft } => {
            let _ = coordinator
                .finish(
                    current_challenge(identity, current_uuid),
                    Finish {
                        user_id: identity.user_id,
                        client_id: identity.client_id,
                        session_token: identity.session_token.clone(),
                        times,
                        soft,
                    },
                )
                .await;
            None
        }
        Action::Status(status) => {
            let _ = coordinator
                .update_client_status(ClientStatusChange {
                    user_id: identity.user_id,
                    client_id: identity.client_id,
                    session_token: identity.session_token.clone(),
                    status,
                })
                .await;
            None
        }
        Action::Reconnect { token } => {
            identity.session_token = token.into();
            let uuid = current_challenge(identity, current_uuid);
            coordinator
                .rejoin(
                    uuid,
                    Join {
                        user_id: identity.user_id,
                        client_id: identity.client_id,
                        session_token: identity.session_token.clone(),
                        plugin_version: "0.9.14".into(),
                        runelite_version: "1.12.31.1".into(),
                        recording_type: identity.recording_type,
                    },
                )
                .await
                .ok()
        }
        Action::StatusAs(status, token) => {
            let _ = coordinator
                .update_client_status(ClientStatusChange {
                    user_id: identity.user_id,
                    client_id: identity.client_id,
                    session_token: token.into(),
                    status,
                })
                .await;
            None
        }
    };

    Outcome {
        client: identity.name,
        at,
        response,
    }
}

fn current_challenge(identity: &Identity, current_uuid: &Mutex<Option<Uuid>>) -> Uuid {
    current_uuid
        .lock()
        .expect("uuid slot poisoned")
        .unwrap_or_else(|| panic!("client {} is not in a challenge", identity.name))
}

#[allow(clippy::too_many_lines)]
fn check_invariants(result: &ScenarioResult, config: &LifecycleConfig) {
    for (uuid, journal) in &result.journals {
        let terminated = journal
            .iter()
            .any(|entry| matches!(entry.event, LifecycleEvent::ChallengeTerminated { .. }));
        if terminated {
            assert!(
                !result.snapshots.contains_key(uuid),
                "terminated challenge was not reaped: {uuid}",
            );
        } else {
            assert!(
                result.snapshots.contains_key(uuid),
                "live challenge missing from the registry: {uuid}",
            );
        }

        // Compare computed state to what the journal produces.
        let mut folded = ChallengeState {
            uuid: *uuid,
            processing: Processing::new(config.processing.clone()),
            ..ChallengeState::default()
        };
        for entry in journal {
            apply(&mut folded, entry.clone());
        }

        // A challenge whose processing completed after termination is deleted
        // and announces its finish exactly once.
        let concluded = terminated && folded.processing.settled();
        assert_eq!(
            result.deleted.contains(uuid),
            concluded,
            "deletion mismatch: {uuid}",
        );
        let finishes = result
            .updates
            .iter()
            .filter(|(id, update)| id == uuid && *update == ChallengeServerUpdate::Finish)
            .count();
        assert_eq!(
            finishes,
            usize::from(concluded),
            "finish announcements: {uuid}",
        );

        if let Some(snapshot) = result.snapshots.get(uuid) {
            assert_eq!(
                snapshot.phase,
                folded.phase.phase(),
                "phase diverged: {uuid}"
            );
            assert_eq!(snapshot.stage, folded.stage, "stage diverged: {uuid}");
            assert_eq!(
                snapshot.stage_attempt, folded.stage_attempt,
                "attempt diverged: {uuid}",
            );
            assert_eq!(snapshot.mode, folded.mode, "mode diverged: {uuid}");
        }

        // Every challenge's final projected reflects its journal.
        // The cursor is excluded as it advances on commands which journal
        // nothing, while the fold only sees journaled entries.
        let projection = result
            .projections
            .get(uuid)
            .unwrap_or_else(|| panic!("challenge was never projected: {uuid}"));
        assert_eq!(
            projection.phase,
            folded.phase.phase(),
            "projected phase: {uuid}"
        );
        assert_eq!(
            projection.status,
            folded.status(),
            "projected status: {uuid}",
        );
        assert_eq!(projection.stage, folded.stage, "projected stage: {uuid}");
        assert_eq!(
            projection.stage_attempt, folded.stage_attempt,
            "projected attempt: {uuid}",
        );
        assert_eq!(projection.mode, folded.mode, "projected mode: {uuid}");
        assert_eq!(projection.party, folded.party, "projected party: {uuid}");

        // Every journaled command decision traces back to a command that was
        // actually sent to this challenge's inbox.
        for entry in journal {
            if let Cause::Command(id) = entry.caused_by {
                let sent = result
                    .inboxes
                    .get(uuid)
                    .is_some_and(|inbox| inbox.contains(&id));
                assert!(sent, "journaled command {id} was never sent: {uuid}");
            }
        }

        let mut seals = Vec::new();
        let mut trigger_seqs = HashSet::new();
        let mut terminated = false;

        for entry in journal {
            let processing_event = matches!(
                entry.event,
                LifecycleEvent::ProcessingStarted { .. }
                    | LifecycleEvent::ProcessingFinished { .. }
                    | LifecycleEvent::ProcessingFailed { .. }
                    | LifecycleEvent::ProcessingTimedOut { .. }
            );
            assert!(
                !terminated || processing_event,
                "non-processing entry recorded after termination: {uuid}",
            );
            terminated |= matches!(entry.event, LifecycleEvent::ChallengeTerminated { .. });

            match &entry.event {
                LifecycleEvent::ChallengeCreated { .. }
                | LifecycleEvent::ChallengeTerminated { .. } => {
                    trigger_seqs.insert(entry.seq);
                }
                LifecycleEvent::StageSealed { stage, attempt, .. } => {
                    assert!(
                        !seals.contains(&(*stage, *attempt)),
                        "stage {stage:?} attempt {attempt:?} sealed twice: {uuid}",
                    );
                    seals.push((*stage, *attempt));
                    trigger_seqs.insert(entry.seq);
                }
                LifecycleEvent::ProcessingStarted { trigger }
                | LifecycleEvent::ProcessingFinished { trigger, .. }
                | LifecycleEvent::ProcessingFailed { trigger, .. }
                | LifecycleEvent::ProcessingTimedOut { trigger } => {
                    assert!(
                        trigger_seqs.contains(trigger),
                        "processing entry references no trigger: {uuid}",
                    );
                }
                _ => {}
            }
        }
    }
}

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
use std::collections::BTreeMap;
use std::ops::Index;
use std::slice;
use std::sync::{Arc, Mutex};

use tokio::time::Instant;

use super::challenge::JournalSink;
use super::coordinator::Coordinator;
use super::core::apply::apply;
use super::core::command::{
    ClientStatus, ClientStatusChange, Create, Finish, StageProgress, Update,
};
use super::core::deadline::LifecycleConfig;
use super::core::event::{JournalEntry, LifecycleEvent};
use super::core::state::{ChallengeState, Snapshot};
use super::core::types::{
    ChallengeMode, ChallengeType, ClientId, RecordingType, ReportedTimes, SessionToken, Stage,
    UserId, Uuid,
};

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
    },
    Finish {
        times: Option<ReportedTimes>,
        soft: bool,
    },
    Status(ClientStatus),
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

#[derive(Default)]
struct Collector(Mutex<CollectedJournals>);

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

impl JournalSink for Collector {
    fn append(&self, uuid: Uuid, entry: &JournalEntry) {
        let mut collected = self.0.lock().expect("collector lock poisoned");
        if !collected.journals.contains_key(&uuid) {
            collected.creation_order.push(uuid);
        }
        collected
            .journals
            .entry(uuid)
            .or_default()
            .push(entry.clone());
    }
}

/// Runs a scenario to completion under default lifecycle timings and checks
/// structural invariants.
pub async fn run(scenario: Scenario) -> ScenarioResult {
    run_with(LifecycleConfig::default(), scenario).await
}

/// Runs a scenario to completion under specific lifecycle timings and checks
/// structural invariants.
pub async fn run_with(config: LifecycleConfig, scenario: Scenario) -> ScenarioResult {
    let collector = Arc::new(Collector::default());
    let coordinator =
        Arc::new(Coordinator::with_journal_sink(collector.clone()).with_config(config));
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
                &identities[index],
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

    let journals = collector.0.lock().expect("collector lock poisoned").clone();
    let snapshots = journals
        .into_iter()
        .filter_map(|(uuid, _)| coordinator.snapshot(*uuid).map(|s| (*uuid, s)))
        .collect();

    let result = ScenarioResult {
        journals,
        outcomes,
        snapshots,
    };
    check_invariants(&result);
    result
}

async fn issue(
    coordinator: &Coordinator,
    identity: &Identity,
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
        Action::Update { mode, stage } => {
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
                        party: None,
                    },
                )
                .await
                .ok()
        }
        Action::Finish { times, soft } => {
            let uuid = current_challenge(identity, current_uuid);
            coordinator
                .finish(
                    uuid,
                    Finish {
                        user_id: identity.user_id,
                        client_id: identity.client_id,
                        session_token: identity.session_token.clone(),
                        times,
                        soft,
                    },
                )
                .await
                .ok()
        }
        Action::Status(status) => coordinator
            .update_client_status(ClientStatusChange {
                user_id: identity.user_id,
                client_id: identity.client_id,
                session_token: identity.session_token.clone(),
                status,
            })
            .await
            .ok()
            .flatten(),
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

fn check_invariants(result: &ScenarioResult) {
    for (uuid, journal) in &result.journals {
        let terminated = journal
            .last()
            .is_some_and(|entry| matches!(entry.event, LifecycleEvent::ChallengeTerminated { .. }));
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
            ..ChallengeState::default()
        };
        for entry in journal {
            apply(&mut folded, entry.clone());
        }

        if let Some(snapshot) = result.snapshots.get(uuid) {
            assert_eq!(snapshot.phase, folded.phase, "phase diverged: {uuid}");
            assert_eq!(snapshot.stage, folded.stage, "stage diverged: {uuid}");
            assert_eq!(
                snapshot.stage_attempt, folded.stage_attempt,
                "attempt diverged: {uuid}",
            );
            assert_eq!(snapshot.mode, folded.mode, "mode diverged: {uuid}");
        }

        let mut seals = Vec::new();
        for (position, entry) in journal.iter().enumerate() {
            match &entry.event {
                LifecycleEvent::StageSealed { stage, attempt, .. } => {
                    assert!(
                        !seals.contains(&(*stage, *attempt)),
                        "stage {stage:?} attempt {attempt:?} sealed twice: {uuid}",
                    );
                    seals.push((*stage, *attempt));
                }
                LifecycleEvent::ChallengeTerminated { .. } => {
                    assert_eq!(
                        position,
                        journal.len() - 1,
                        "entries recorded after termination: {uuid}",
                    );
                }
                _ => {}
            }
        }
    }
}

//! Deterministic scenario harness for the challenge lifecycle.
//!
//! A scenario scripts clients issuing timed commands against a real
//! [`Coordinator`] under tokio's paused clock. Each client individually issues
//! actions, which may arrive concurrently with other clients' actions.
//!
//! Following a run, structural invariants of the output are checked.

mod scenarios;

use core::time::Duration;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use tokio::time::Instant;

use super::challenge::JournalSink;
use super::coordinator::Coordinator;
use super::core::apply::apply;
use super::core::command::{Create, Finish, StageProgress, Update};
use super::core::event::{JournalEntry, LifecycleEvent};
use super::core::state::{ChallengeState, Snapshot};
use super::core::types::{
    ChallengeMode, ChallengeType, ClientId, RecordingType, ReportedTimes, Stage, UserId, Uuid,
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
}

#[derive(Clone)]
struct Identity {
    name: &'static str,
    user_id: UserId,
    client_id: ClientId,
    session_token: String,
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
                session_token: format!("tok{id}"),
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
    pub journals: BTreeMap<Uuid, Vec<JournalEntry>>,
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
        let (uuid, journal) = self.journals.first_key_value().unwrap();
        (*uuid, journal)
    }

    /// A canonical serialization of every challenge's journal.
    pub fn trace(&self) -> String {
        serde_json::to_string(&self.journals).expect("journals should serialize")
    }
}

#[derive(Default)]
struct Collector(Mutex<BTreeMap<Uuid, Vec<JournalEntry>>>);

impl JournalSink for Collector {
    fn append(&self, uuid: Uuid, entry: &JournalEntry) {
        self.0
            .lock()
            .expect("collector lock poisoned")
            .entry(uuid)
            .or_default()
            .push(entry.clone());
    }
}

/// Runs a scenario to completion and checks structural invariants.
pub async fn run(scenario: Scenario) -> ScenarioResult {
    let collector = Arc::new(Collector::default());
    let coordinator = Arc::new(Coordinator::with_journal_sink(collector.clone()));
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

        // Each client's actions within the instant stay serial, but all clients
        // issue concurrently.
        let mut per_client: Vec<(usize, Vec<Action>)> = Vec::new();
        for (index, action) in group {
            match per_client.last_mut() {
                Some((last, actions)) if *last == index => actions.push(action),
                _ => per_client.push((index, vec![action])),
            }
        }

        let tasks: Vec<_> = per_client
            .into_iter()
            .map(|(index, actions)| {
                let coordinator = coordinator.clone();
                let identity = identities[index].clone();
                let uuid_slot = uuid_slots[index].clone();
                tokio::spawn(async move {
                    let mut outcomes = Vec::new();
                    for action in actions {
                        outcomes.push(issue(&coordinator, &identity, &uuid_slot, at, action).await);
                    }
                    outcomes
                })
            })
            .collect();
        for task in tasks {
            outcomes.extend(task.await.expect("client task panicked"));
        }
    }

    // Run past the end of the scenario to let any remaining deadlines fire.
    tokio::time::sleep_until(started + Duration::from_millis(scenario.run_until)).await;
    tokio::time::sleep(Duration::from_millis(1)).await;

    let journals = collector.0.lock().expect("collector lock poisoned").clone();
    let snapshots = journals
        .keys()
        .filter_map(|uuid| coordinator.snapshot(*uuid).map(|s| (*uuid, s)))
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

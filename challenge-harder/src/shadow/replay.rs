//! Capture replay engine.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::process::ExitStatus;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use futures_util::StreamExt;
use http_body_util::{BodyExt, Full};
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;
use serde_json::{Value, json};
use thiserror::Error;
use tokio::sync::mpsc;
use tokio::time::Instant;
use uuid::Uuid;

use super::capture::{Capture, CaptureOp};
use super::remap::{Mapping, Remap};
use super::schedule::{Planned, ScheduleError, path, schedule};
use super::server::{HttpClient, Server, ServerError};
use crate::lifecycle::core::deadline::LifecycleConfig;
use crate::lifecycle::core::event::JournalEntry;
use crate::lifecycle::core::types::ClientId;

#[derive(Debug, Error)]
pub enum ReplayError {
    #[error(transparent)]
    Schedule(#[from] ScheduleError),
    #[error(transparent)]
    Server(#[from] ServerError),
    #[error("scratch Redis must name a dedicated database, e.g. redis://localhost:6379/11")]
    DefaultDatabase,
    #[error("scratch Redis is unusable")]
    Redis(#[from] redis::RedisError),
    #[error("journal for {uuid} is corrupt: {detail}")]
    Journal { uuid: Uuid, detail: String },
}

/// The artifacts a replay run leaves behind.
pub struct ReplayResult {
    pub events: Vec<Event>,
    pub announcements: Vec<Announcement>,
    pub remapped: BTreeMap<Uuid, Uuid>,
    pub incomplete: Vec<Uuid>,
    pub journals: BTreeMap<Uuid, Vec<JournalEntry>>,
    pub exit: ExitStatus,
    pub graceful: bool,
}

/// A message observed on the challenge-updates pubsub channel.
#[derive(Debug, Clone, PartialEq)]
pub struct Announcement {
    /// Arrival offset on the same clock as command send offsets.
    pub offset: Duration,
    pub payload: Value,
}

/// Replays a capture against a fresh server backed by `redis_uri`, writing
/// results to `run_dir`.
pub async fn run(
    capture: &Capture,
    redis_uri: &str,
    time_scale: u32,
    run_dir: &Path,
) -> Result<ReplayResult, ReplayError> {
    let plan = schedule(&capture.records, time_scale)?;
    let config = LifecycleConfig::default().scaled(time_scale);

    let mut redis = connect_redis(redis_uri).await?;
    redis::cmd("FLUSHDB").exec_async(&mut redis).await?;

    let mut server = Server::spawn(run_dir, redis_uri, time_scale)?;
    let client: HttpClient = Client::builder(TokioExecutor::new()).build_http();
    server.wait_until_healthy(&client).await?;

    // Start listening before any commands can run.
    let base = Instant::now();
    let (recorder, announcements) = record_announcements(redis_uri, base).await?;

    let sender = Arc::new(HttpSender {
        client,
        base: format!("http://127.0.0.1:{}", server.port()),
    });
    let remap = Arc::new(Remap::default());
    let events = replay(base, plan, sender, Arc::clone(&remap)).await;
    let incomplete = wait_for_timeouts(&mut redis, &config).await?;

    let (exit, graceful) = server.shut_down().await?;
    recorder.abort();
    let announcements = std::mem::take(&mut *announcements.lock().expect("announcement lock"));
    let journals = read_journals(&mut redis, &events).await?;
    Ok(ReplayResult {
        events,
        announcements,
        remapped: remap.table(),
        incomplete,
        journals,
        exit,
        graceful,
    })
}

/// Reads back every replayed challenge's journal.
async fn read_journals(
    redis: &mut redis::aio::MultiplexedConnection,
    events: &[Event],
) -> Result<BTreeMap<Uuid, Vec<JournalEntry>>, ReplayError> {
    let mut challenges = std::collections::BTreeSet::new();
    for event in events {
        if let Event::CommandSent { response, .. } = event
            && let Some(uuid) = response_uuid(response)
        {
            challenges.insert(uuid);
        }
    }

    let mut journals = BTreeMap::new();
    for uuid in challenges {
        let batches: Vec<(String, Vec<(String, String)>)> = redis::cmd("XRANGE")
            .arg(crate::store::journal_key(uuid))
            .arg("-")
            .arg("+")
            .query_async(redis)
            .await?;

        let mut entries = Vec::new();
        for (id, fields) in batches {
            let batch = fields
                .iter()
                .find(|(name, _)| name == "batch")
                .map(|(_, value)| value)
                .ok_or_else(|| ReplayError::Journal {
                    uuid,
                    detail: format!("entry {id} has no batch"),
                })?;
            let batch: Vec<JournalEntry> =
                serde_json::from_str(batch).map_err(|error| ReplayError::Journal {
                    uuid,
                    detail: format!("invalid batch {id}: {error}"),
                })?;
            entries.extend(batch);
        }
        journals.insert(uuid, entries);
    }
    Ok(journals)
}

/// Waits for every outstanding challenge to leave the existence index following
/// the completion of a run, leaving time for their final timeouts to run.
/// Returns the IDs of any challenges that failed to exit gracefully.
async fn wait_for_timeouts(
    redis: &mut redis::aio::MultiplexedConnection,
    config: &LifecycleConfig,
) -> Result<Vec<Uuid>, ReplayError> {
    let ceiling = config
        .stage_end_timeout
        .max(config.challenge_end_grace)
        .max(config.reconnection_window)
        .max(config.inactivity_timeout)
        + Duration::from_secs(5);
    let deadline = Instant::now() + ceiling;

    loop {
        let members: Vec<String> = redis::cmd("ZRANGE")
            .arg(crate::store::LEASES_KEY)
            .arg(0)
            .arg(-1)
            .query_async(redis)
            .await?;
        if members.is_empty() {
            return Ok(Vec::new());
        }
        if Instant::now() >= deadline {
            return Ok(members
                .into_iter()
                .map(|member| member.parse().expect("lease member is a uuid"))
                .collect());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

type Announcements = Arc<Mutex<Vec<Announcement>>>;

/// Subscribes to challenge-updates and records every message until aborted.
async fn record_announcements(
    redis_uri: &str,
    base: Instant,
) -> Result<(tokio::task::JoinHandle<()>, Announcements), ReplayError> {
    let mut pubsub = redis::Client::open(redis_uri)?.get_async_pubsub().await?;
    pubsub
        .subscribe(crate::store::CHALLENGE_UPDATES_CHANNEL)
        .await?;

    let announcements = Announcements::default();
    let recorder = {
        let announcements = Arc::clone(&announcements);
        tokio::spawn(async move {
            let mut messages = pubsub.on_message();
            while let Some(message) = messages.next().await {
                let payload: Vec<u8> = message.get_payload().unwrap_or_default();
                let payload = serde_json::from_slice(&payload).unwrap_or_else(|_| {
                    Value::String(String::from_utf8_lossy(&payload).into_owned())
                });
                announcements
                    .lock()
                    .expect("announcement lock")
                    .push(Announcement {
                        offset: base.elapsed(),
                        payload,
                    });
            }
        })
    };
    Ok((recorder, announcements))
}

/// Issues commands to the server under test.
#[async_trait]
trait CommandSender: Send + Sync {
    /// Sends a single command to the server, returning its result.
    async fn send(&self, path: &str, body: &Value) -> Outcome;
}

/// A sent command's result. Transport failures record as status 0.
#[derive(Debug, Clone, PartialEq)]
pub struct Outcome {
    pub status: u16,
    pub response: Value,
}

/// An event recorded during replay, in stream order.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    CommandSent {
        index: usize,
        op: CaptureOp,
        client: ClientId,
        captured: Option<Uuid>,
        scheduled: Duration,
        sent: Duration,
        latency: Duration,
        status: u16,
        response: Value,
        mapping: Option<Mapping>,
    },
    /// A command was scheduled for a challenge that was not previously mapped.
    CommandUnmapped {
        index: usize,
        op: CaptureOp,
        client: ClientId,
        captured: Uuid,
    },
}

impl Event {
    fn index(&self) -> usize {
        match self {
            Event::CommandSent { index, .. } | Event::CommandUnmapped { index, .. } => *index,
        }
    }
}

/// Plays a plan to completion, returning every recorded event in stream order.
async fn replay(
    base: Instant,
    plan: Vec<Planned>,
    sender: Arc<dyn CommandSender>,
    remap: Arc<Remap>,
) -> Vec<Event> {
    let mut clients: BTreeMap<ClientId, Vec<Planned>> = BTreeMap::new();
    for planned in plan {
        clients.entry(planned.client).or_default().push(planned);
    }

    let (events_tx, mut events_rx) = mpsc::unbounded_channel();
    for (client, commands) in clients {
        tokio::spawn(run_client(
            client,
            commands,
            base,
            Arc::clone(&sender),
            Arc::clone(&remap),
            events_tx.clone(),
        ));
    }
    drop(events_tx);

    let mut events = Vec::new();
    while let Some(event) = events_rx.recv().await {
        events.push(event);
    }
    events.sort_by_key(Event::index);
    events
}

async fn run_client(
    client: ClientId,
    commands: Vec<Planned>,
    base: Instant,
    sender: Arc<dyn CommandSender>,
    remap: Arc<Remap>,
    events: mpsc::UnboundedSender<Event>,
) {
    // On a creation mismatch, later commands follow what the server under
    // test told this client, not the globally established mapping.
    let mut own: HashMap<Uuid, Uuid> = HashMap::new();

    for command in commands {
        tokio::time::sleep_until(base + command.offset).await;

        let target = match command.requires {
            Some(captured) => {
                let Some(target) = own.get(&captured).copied().or_else(|| remap.get(captured))
                else {
                    let _ = events.send(Event::CommandUnmapped {
                        index: command.index,
                        op: command.op,
                        client,
                        captured,
                    });
                    continue;
                };
                Some(target)
            }
            None => None,
        };
        let path = path(command.op, target);

        if command.op == CaptureOp::Status {
            // Status updates are always fire-and-forget.
            let sender = Arc::clone(&sender);
            let events = events.clone();
            tokio::spawn(async move {
                let sent_at = Instant::now();
                let outcome = sender.send(&path, &command.body).await;
                let _ = events.send(Event::CommandSent {
                    index: command.index,
                    op: command.op,
                    client,
                    captured: None,
                    scheduled: command.offset,
                    sent: sent_at.duration_since(base),
                    latency: sent_at.elapsed(),
                    status: outcome.status,
                    response: outcome.response,
                    mapping: None,
                });
            });
            continue;
        }

        let sent_at = Instant::now();
        let outcome = sender.send(&path, &command.body).await;
        let latency = sent_at.elapsed();

        let captured = command.creates.or(command.requires);
        let mapping = match (captured, response_uuid(&outcome.response)) {
            (Some(captured), Some(replayed)) => {
                let mapping = remap.record(captured, replayed);
                if let Mapping::Mismatch { .. } = mapping {
                    own.insert(captured, replayed);
                }
                Some(mapping)
            }
            _ => None,
        };

        let _ = events.send(Event::CommandSent {
            index: command.index,
            op: command.op,
            client,
            captured,
            scheduled: command.offset,
            sent: sent_at.duration_since(base),
            latency,
            status: outcome.status,
            response: outcome.response,
            mapping,
        });
    }
}

fn response_uuid(response: &Value) -> Option<Uuid> {
    response.get("uuid")?.as_str()?.parse().ok()
}

struct HttpSender {
    client: HttpClient,
    base: String,
}

#[async_trait]
impl CommandSender for HttpSender {
    async fn send(&self, path: &str, body: &Value) -> Outcome {
        let request = axum::http::Request::post(format!("{}{path}", self.base))
            .header("content-type", "application/json")
            .body(Full::from(body.to_string()))
            .expect("replay request builds");

        let response = match self.client.request(request).await {
            Ok(response) => response,
            Err(e) => {
                return Outcome {
                    status: 0,
                    response: json!({ "transportError": e.to_string() }),
                };
            }
        };

        let status = response.status().as_u16();
        let body = match response.into_body().collect().await {
            Ok(collected) => collected.to_bytes(),
            Err(e) => {
                return Outcome {
                    status: 0,
                    response: json!({ "transportError": e.to_string() }),
                };
            }
        };
        let response = if body.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&body)
                .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&body).into_owned()))
        };
        Outcome { status, response }
    }
}

async fn connect_redis(uri: &str) -> Result<redis::aio::MultiplexedConnection, ReplayError> {
    let client = redis::Client::open(uri)?;
    if client.get_connection_info().redis_settings().db() == 0 {
        return Err(ReplayError::DefaultDatabase);
    }
    Ok(client.get_multiplexed_async_connection().await?)
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::Mutex;

    use super::*;

    const UUID_A: &str = "11111111-1111-1111-1111-111111111111";
    const UUID_B: &str = "33333333-3333-3333-3333-333333333333";
    const REPLAYED_Y: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const REPLAYED_Z: &str = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    fn uuid(value: &str) -> Uuid {
        value.parse().unwrap()
    }

    fn ok(body: Value) -> Outcome {
        Outcome {
            status: 200,
            response: body,
        }
    }

    /// Scripted sender. Each send pops the next scripted response for its
    /// path after the scripted latency, logging the send offset.
    struct Scripted {
        base: Instant,
        script: Mutex<HashMap<String, VecDeque<(Duration, Outcome)>>>,
        log: Mutex<Vec<(String, Duration)>>,
    }

    impl Scripted {
        fn new(entries: Vec<(String, Duration, Outcome)>) -> Arc<Scripted> {
            let mut script: HashMap<String, VecDeque<(Duration, Outcome)>> = HashMap::new();
            for (path, latency, outcome) in entries {
                script
                    .entry(path)
                    .or_default()
                    .push_back((latency, outcome));
            }
            Arc::new(Scripted {
                base: Instant::now(),
                script: Mutex::new(script),
                log: Mutex::new(Vec::new()),
            })
        }

        fn log(&self) -> Vec<(String, Duration)> {
            self.log.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl CommandSender for Scripted {
        async fn send(&self, path: &str, _body: &Value) -> Outcome {
            self.log
                .lock()
                .unwrap()
                .push((path.to_owned(), self.base.elapsed()));
            let (latency, outcome) = self
                .script
                .lock()
                .unwrap()
                .get_mut(path)
                .and_then(VecDeque::pop_front)
                .unwrap_or_else(|| panic!("unscripted request to {path}"));
            tokio::time::sleep(latency).await;
            outcome
        }
    }

    fn planned(
        index: usize,
        offset_ms: u64,
        client: i64,
        op: CaptureOp,
        creates: Option<&str>,
        requires: Option<&str>,
    ) -> Planned {
        Planned {
            index,
            offset: Duration::from_millis(offset_ms),
            client: ClientId(client),
            op,
            creates: creates.map(uuid),
            requires: requires.map(uuid),
            body: Value::Null,
        }
    }

    async fn run(plan: Vec<Planned>, sender: Arc<Scripted>) -> Vec<Event> {
        replay(Instant::now(), plan, sender, Arc::new(Remap::default())).await
    }

    #[tokio::test(start_paused = true)]
    async fn a_client_serializes_on_responses() {
        let sender = Scripted::new(vec![
            (
                "/challenges/new".to_owned(),
                Duration::from_millis(50),
                ok(json!({ "uuid": REPLAYED_Y })),
            ),
            (
                format!("/challenges/{REPLAYED_Y}"),
                Duration::ZERO,
                ok(json!({ "uuid": REPLAYED_Y })),
            ),
        ]);

        let events = run(
            vec![
                planned(0, 0, 1, CaptureOp::Start, Some(UUID_A), None),
                planned(1, 10, 1, CaptureOp::Update, None, Some(UUID_A)),
            ],
            Arc::clone(&sender),
        )
        .await;

        // The update was scheduled at 10ms but held for the start's
        // response at 50ms.
        assert_eq!(
            events,
            vec![
                Event::CommandSent {
                    index: 0,
                    op: CaptureOp::Start,
                    client: ClientId(1),
                    captured: Some(uuid(UUID_A)),
                    scheduled: Duration::ZERO,
                    sent: Duration::ZERO,
                    latency: Duration::from_millis(50),
                    status: 200,
                    response: json!({ "uuid": REPLAYED_Y }),
                    mapping: Some(Mapping::New),
                },
                Event::CommandSent {
                    index: 1,
                    op: CaptureOp::Update,
                    client: ClientId(1),
                    captured: Some(uuid(UUID_A)),
                    scheduled: Duration::from_millis(10),
                    sent: Duration::from_millis(50),
                    latency: Duration::ZERO,
                    status: 200,
                    response: json!({ "uuid": REPLAYED_Y }),
                    mapping: Some(Mapping::Match),
                },
            ],
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_slow_client_does_not_block_others() {
        let sender = Scripted::new(vec![
            (
                "/challenges/new".to_owned(),
                Duration::from_secs(1),
                ok(json!({ "uuid": REPLAYED_Y })),
            ),
            (
                "/challenges/new".to_owned(),
                Duration::ZERO,
                ok(json!({ "uuid": REPLAYED_Y })),
            ),
        ]);

        let events = run(
            vec![
                planned(0, 0, 1, CaptureOp::Start, Some(UUID_A), None),
                planned(1, 10, 2, CaptureOp::Start, Some(UUID_A), None),
            ],
            Arc::clone(&sender),
        )
        .await;

        let sent: Vec<Duration> = events
            .iter()
            .map(|event| match event {
                Event::CommandSent { sent, .. } => *sent,
                Event::CommandUnmapped { .. } => panic!("unexpected unmapped event"),
            })
            .collect();
        assert_eq!(sent, vec![Duration::ZERO, Duration::from_millis(10)]);
    }

    #[tokio::test(start_paused = true)]
    async fn statuses_do_not_gate_the_client() {
        let sender = Scripted::new(vec![
            (
                "/challenges/new".to_owned(),
                Duration::ZERO,
                ok(json!({ "uuid": REPLAYED_Y })),
            ),
            (
                "/client-status".to_owned(),
                Duration::from_millis(500),
                ok(Value::Null),
            ),
            (
                format!("/challenges/{REPLAYED_Y}"),
                Duration::ZERO,
                ok(json!({ "uuid": REPLAYED_Y })),
            ),
        ]);

        let events = run(
            vec![
                planned(0, 0, 1, CaptureOp::Start, Some(UUID_A), None),
                planned(1, 10, 1, CaptureOp::Status, None, None),
                planned(2, 20, 1, CaptureOp::Update, None, Some(UUID_A)),
            ],
            Arc::clone(&sender),
        )
        .await;

        // The update fires on schedule while the status is still in flight.
        let Event::CommandSent { sent, .. } = &events[2] else {
            panic!("update was not sent");
        };
        assert_eq!(*sent, Duration::from_millis(20));
        let Event::CommandSent { latency, .. } = &events[1] else {
            panic!("status was not sent");
        };
        assert_eq!(*latency, Duration::from_millis(500));
    }

    #[tokio::test(start_paused = true)]
    async fn a_creation_mismatch_follows_the_clients_own_mapping() {
        let sender = Scripted::new(vec![
            (
                "/challenges/new".to_owned(),
                Duration::ZERO,
                ok(json!({ "uuid": REPLAYED_Y })),
            ),
            (
                "/challenges/new".to_owned(),
                Duration::ZERO,
                ok(json!({ "uuid": REPLAYED_Z })),
            ),
            (
                format!("/challenges/{REPLAYED_Z}"),
                Duration::ZERO,
                ok(json!({ "uuid": REPLAYED_Z })),
            ),
        ]);

        let events = run(
            vec![
                planned(0, 0, 1, CaptureOp::Start, Some(UUID_A), None),
                planned(1, 10, 2, CaptureOp::Start, Some(UUID_A), None),
                planned(2, 20, 2, CaptureOp::Update, None, Some(UUID_A)),
            ],
            Arc::clone(&sender),
        )
        .await;

        let Event::CommandSent { mapping, .. } = &events[1] else {
            panic!("second start was not sent");
        };
        assert_eq!(
            *mapping,
            Some(Mapping::Mismatch {
                existing: uuid(REPLAYED_Y),
            }),
        );
        // The mismatched client's update goes to its own challenge.
        assert_eq!(sender.log()[2].0, format!("/challenges/{REPLAYED_Z}"));
    }

    #[tokio::test(start_paused = true)]
    async fn an_unmapped_command_is_recorded_and_skipped() {
        let sender = Scripted::new(vec![(
            "/challenges/new".to_owned(),
            Duration::ZERO,
            Outcome {
                status: 400,
                response: json!({ "error": { "message": "nope" } }),
            },
        )]);

        let events = run(
            vec![
                planned(0, 0, 1, CaptureOp::Start, Some(UUID_A), None),
                planned(1, 10, 1, CaptureOp::Finish, None, Some(UUID_A)),
            ],
            Arc::clone(&sender),
        )
        .await;

        assert_eq!(
            events[1],
            Event::CommandUnmapped {
                index: 1,
                op: CaptureOp::Finish,
                client: ClientId(1),
                captured: uuid(UUID_A),
            },
        );
        // Only the refused start reached the wire.
        assert_eq!(sender.log().len(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn distinct_challenges_map_independently() {
        let sender = Scripted::new(vec![
            (
                "/challenges/new".to_owned(),
                Duration::ZERO,
                ok(json!({ "uuid": REPLAYED_Y })),
            ),
            (
                "/challenges/new".to_owned(),
                Duration::ZERO,
                ok(json!({ "uuid": REPLAYED_Z })),
            ),
        ]);

        let events = run(
            vec![
                planned(0, 0, 1, CaptureOp::Start, Some(UUID_A), None),
                planned(1, 10, 2, CaptureOp::Start, Some(UUID_B), None),
            ],
            Arc::clone(&sender),
        )
        .await;

        let mappings: Vec<Option<Mapping>> = events
            .iter()
            .map(|event| match event {
                Event::CommandSent { mapping, .. } => *mapping,
                Event::CommandUnmapped { .. } => panic!("unexpected unmapped event"),
            })
            .collect();
        assert_eq!(mappings, vec![Some(Mapping::New), Some(Mapping::New)]);
    }
}

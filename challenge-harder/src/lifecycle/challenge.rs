//! Live challenge state processing.

use core::future::Future;
use core::pin::Pin;
use core::time::Duration;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use tokio::sync::{mpsc, watch};

use super::core::apply::apply;
use super::core::command::{Command, Envelope};
use super::core::deadline::{LifecycleConfig, next_deadline};
use super::core::decide::decide;
use super::core::event::{Cause, JournalEntry, LifecycleEvent};
use super::core::state::{ChallengePhase, ChallengeState, Snapshot};
use super::core::types::{JournalSeq, MsgId, Timestamp, Uuid};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StoreError {
    /// A newer incarnation owns the challenge; the challenge must exit.
    #[error("fenced off by a newer incarnation")]
    Fenced,
    /// The operation could not be completed.
    #[error("store unavailable: {0}")]
    Unavailable(String),
}

pub type ClaimFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Box<dyn ChallengeClaim>, StoreError>> + Send + 'a>>;
pub type AppendFuture<'a> = Pin<Box<dyn Future<Output = Result<(), StoreError>> + Send + 'a>>;

/// Durable storage for challenge state, granting exclusive access through claims.
pub trait ChallengeStore: Send + Sync + 'static {
    /// Opens a new epoch claim on challenge `uuid`.
    fn claim(&self, uuid: Uuid) -> ClaimFuture<'_>;
}

/// An exclusive handle to a challenge's durable state. Gives access to writes
/// to the state, as long as the epoch is still valid.
pub trait ChallengeClaim: Send + Sync + 'static {
    /// Appends a decision's entries to the challenge's journal as a single atomic batch.
    fn append<'a>(&'a self, batch: &'a [JournalEntry]) -> AppendFuture<'a>;
}

pub struct NoopStore;

impl ChallengeStore for NoopStore {
    fn claim(&self, _uuid: Uuid) -> ClaimFuture<'_> {
        Box::pin(async { Ok(Box::new(NoopClaim) as Box<dyn ChallengeClaim>) })
    }
}

struct NoopClaim;

impl ChallengeClaim for NoopClaim {
    fn append<'a>(&'a self, _batch: &'a [JournalEntry]) -> AppendFuture<'a> {
        Box::pin(async { Ok(()) })
    }
}

/// Claims challenge `uuid`, retrying transient failures.
pub async fn claim_challenge(
    store: &dyn ChallengeStore,
    uuid: Uuid,
) -> Result<Box<dyn ChallengeClaim>, StoreError> {
    with_retries(uuid, || store.claim(uuid)).await
}

// Transient store failures are retried inline before the caller gives up.
const STORE_ATTEMPTS: u32 = 3;
const STORE_RETRY_DELAY: Duration = Duration::from_millis(250);

/// Runs a store operation, retrying transient failures.
async fn with_retries<T, F, Fut>(uuid: Uuid, op: F) -> Result<T, StoreError>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<T, StoreError>>,
{
    let mut attempts = STORE_ATTEMPTS;
    loop {
        match op().await {
            Err(StoreError::Unavailable(reason)) if attempts > 1 => {
                attempts -= 1;
                tracing::warn!(%uuid, reason, "store_retry");
                tokio::time::sleep(STORE_RETRY_DELAY).await;
            }
            result => return result,
        }
    }
}

// TODO(frolv): This is temporary for initial testing.
#[derive(Clone)]
pub struct CommandSender {
    tx: mpsc::UnboundedSender<Envelope>,
    next_id: Arc<AtomicU64>,
}

impl CommandSender {
    /// Queues a command, returning its inbox position. A caller can await its
    /// application by watching for a snapshot whose cursor reaches it.
    pub fn send(&self, cmd: Command) -> MsgId {
        let id = MsgId(self.next_id.fetch_add(1, Ordering::Relaxed) + 1);
        // Failure means the challenge is gone.
        let _ = self.tx.send(Envelope { id, cmd });
        id
    }
}

#[must_use]
pub fn inbox() -> (CommandSender, mpsc::UnboundedReceiver<Envelope>) {
    let (tx, rx) = mpsc::unbounded_channel();
    (
        CommandSender {
            tx,
            next_id: Arc::new(AtomicU64::new(0)),
        },
        rx,
    )
}

/// Processing task for an ongoing challenge.
pub struct ActiveChallenge {
    pub state: ChallengeState,
    config: LifecycleConfig,
    claim: Box<dyn ChallengeClaim>,
    next_seq: u64,
}

impl ActiveChallenge {
    #[must_use]
    pub fn new(uuid: Uuid, config: LifecycleConfig, claim: Box<dyn ChallengeClaim>) -> Self {
        ActiveChallenge {
            state: ChallengeState {
                uuid,
                ..ChallengeState::default()
            },
            config,
            claim,
            next_seq: 0,
        }
    }

    /// Serially applies inbox commands and their implied deadline timers until
    /// the challenge terminates, publishing a fresh state snapshot after each.
    pub async fn run(
        &mut self,
        mut inbox: mpsc::UnboundedReceiver<Envelope>,
        snapshot: watch::Sender<Snapshot>,
    ) {
        let started = tokio::time::Instant::now();
        let mut cursor = self.state.cursor;

        loop {
            let deadline = next_deadline(&self.state, &self.config);
            let wake_at = deadline.map_or(started, |d| {
                started + Duration::from_millis(d.at.as_millis())
            });

            let input = tokio::select! {
                // Commands should be processed before deadlines.
                biased;
                envelope = inbox.recv() => envelope.map(|e| (Cause::Command(e.id), e.cmd)),
                () = tokio::time::sleep_until(wake_at), if deadline.is_some() => {
                    deadline.map(|d| (Cause::Deadline(d.kind), Command::DeadlineFired(d)))
                }
            };
            let Some((cause, cmd)) = input else {
                break;
            };

            let elapsed = started.elapsed().as_millis();
            let at = Timestamp::from_millis(u64::try_from(elapsed).unwrap_or(u64::MAX));

            let batch: Vec<JournalEntry> = decide(&self.state, &self.config, &cmd)
                .into_iter()
                .map(|event| {
                    let seq = JournalSeq(self.next_seq);
                    self.next_seq += 1;
                    JournalEntry {
                        seq,
                        at,
                        caused_by: cause,
                        event,
                    }
                })
                .collect();

            if !batch.is_empty() {
                if let Err(error) = self.append(&batch).await {
                    tracing::error!(uuid = %self.state.uuid, %error, "journal_append_failed");
                    return;
                }
                for entry in batch {
                    tracing::info!(
                        uuid = %self.state.uuid,
                        seq = entry.seq.0,
                        caused_by = ?entry.caused_by,
                        event = ?entry.event,
                        "journal_entry",
                    );
                    apply(&mut self.state, entry);
                }
            }

            if let Cause::Command(id) = cause {
                cursor = id;
            }
            snapshot.send_replace(Snapshot::of(&self.state, cursor));

            if let ChallengePhase::Terminated { .. } = self.state.phase {
                break;
            }
        }
    }

    async fn append(&self, batch: &[JournalEntry]) -> Result<(), StoreError> {
        with_retries(self.state.uuid, || self.claim.append(batch)).await
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::Mutex;

    use super::*;
    use crate::lifecycle::core::command::Create;
    use crate::lifecycle::core::types::{
        ChallengeMode, ChallengeType, ClientId, RecordingType, Stage, UserId,
    };

    #[derive(Default)]
    struct ClaimLog {
        /// Errors for upcoming appends; once drained, appends succeed.
        failures: Mutex<VecDeque<StoreError>>,
        appended: Mutex<Vec<JournalEntry>>,
        calls: AtomicU64,
    }

    struct ScriptedClaim(Arc<ClaimLog>);

    impl ChallengeClaim for ScriptedClaim {
        fn append<'a>(&'a self, batch: &'a [JournalEntry]) -> AppendFuture<'a> {
            Box::pin(async move {
                self.0.calls.fetch_add(1, Ordering::Relaxed);
                if let Some(failure) = self.0.failures.lock().unwrap().pop_front() {
                    return Err(failure);
                }
                self.0
                    .appended
                    .lock()
                    .unwrap()
                    .extend(batch.iter().cloned());
                Ok(())
            })
        }
    }

    struct RunOutcome {
        log: Arc<ClaimLog>,
        uuid: Uuid,
        initial: Snapshot,
        last: Snapshot,
    }

    /// Runs a challenge over a single create command whose appends are
    /// scripted to fail with `failures` before succeeding.
    async fn run_solo_create(failures: Vec<StoreError>) -> RunOutcome {
        let uuid = Uuid::new_v4();
        let log = Arc::new(ClaimLog {
            failures: Mutex::new(failures.into()),
            ..ClaimLog::default()
        });
        let mut challenge = ActiveChallenge::new(
            uuid,
            LifecycleConfig::default(),
            Box::new(ScriptedClaim(log.clone())),
        );

        let (sender, rx) = inbox();
        let (tx, snapshot_rx) = watch::channel(Snapshot::of(&challenge.state, MsgId(0)));
        let initial = *snapshot_rx.borrow();

        sender.send(Command::Create(Create {
            user_id: UserId(1),
            client_id: ClientId(10),
            session_token: "tok1".into(),
            plugin_version: "0.9.14".into(),
            runelite_version: "1.12.31.1".into(),
            challenge_type: ChallengeType::Tob,
            mode: ChallengeMode::TobRegular,
            party: vec!["a".into()],
            stage: Stage::TobMaiden,
            recording_type: RecordingType::Participant,
        }));
        drop(sender);
        challenge.run(rx, tx).await;

        let last = *snapshot_rx.borrow();
        RunOutcome {
            log,
            uuid,
            initial,
            last,
        }
    }

    fn unavailable() -> StoreError {
        StoreError::Unavailable("scripted".into())
    }

    #[tokio::test(start_paused = true)]
    async fn transient_append_retries_until_durable() {
        let outcome = run_solo_create(vec![unavailable()]).await;

        assert_eq!(outcome.log.calls.load(Ordering::Relaxed), 2);
        assert_eq!(
            *outcome.log.appended.lock().unwrap(),
            vec![
                JournalEntry {
                    seq: JournalSeq(0),
                    at: Timestamp::ZERO,
                    caused_by: Cause::Command(MsgId(1)),
                    event: LifecycleEvent::ChallengeCreated {
                        uuid: outcome.uuid,
                        challenge_type: ChallengeType::Tob,
                        mode: ChallengeMode::TobRegular,
                        party: vec!["a".into()],
                        stage: Stage::TobMaiden,
                    },
                },
                JournalEntry {
                    seq: JournalSeq(1),
                    at: Timestamp::ZERO,
                    caused_by: Cause::Command(MsgId(1)),
                    event: LifecycleEvent::ClientJoined {
                        client_id: ClientId(10),
                        user_id: UserId(1),
                        session_token: "tok1".into(),
                        recording_type: RecordingType::Participant,
                    },
                },
            ],
        );
        assert_eq!(outcome.last.cursor, MsgId(1));
        assert_eq!(outcome.last.phase, ChallengePhase::Active);
        assert_eq!(outcome.last.stage, Stage::TobMaiden);
    }

    #[tokio::test(start_paused = true)]
    async fn repeated_transient_failures_exit_unapplied() {
        let failures = STORE_ATTEMPTS as usize;
        let outcome = run_solo_create(vec![unavailable(); failures]).await;

        assert_eq!(
            outcome.log.calls.load(Ordering::Relaxed),
            u64::from(STORE_ATTEMPTS),
        );
        assert!(outcome.log.appended.lock().unwrap().is_empty());
        assert_eq!(outcome.last, outcome.initial);
    }

    #[tokio::test(start_paused = true)]
    async fn fenced_append_immediately_exits_unapplied() {
        let outcome = run_solo_create(vec![StoreError::Fenced]).await;

        assert_eq!(outcome.log.calls.load(Ordering::Relaxed), 1);
        assert!(outcome.log.appended.lock().unwrap().is_empty());
        assert_eq!(outcome.last, outcome.initial);
    }
}

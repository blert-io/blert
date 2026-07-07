//! Live challenge state processing.

use core::future::Future;
use core::time::Duration;

use async_trait::async_trait;
use tokio::sync::mpsc;

use super::core::apply::apply;
use super::core::command::{Command, Create, Envelope};
use super::core::deadline::{LifecycleConfig, next_deadline};
use super::core::decide::decide;
use super::core::event::{Cause, JournalEntry, LifecycleEvent};
use super::core::state::{ChallengeState, PhaseState, Snapshot};
use super::core::types::{ClientId, JournalSeq, MsgId, Timestamp, Uuid};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StoreError {
    /// A newer incarnation owns the challenge; the challenge must exit.
    #[error("fenced off by a newer incarnation")]
    Fenced,
    /// The operation could not be completed.
    #[error("store unavailable: {0}")]
    Unavailable(String),
}

/// A claim on a challenge, pairing the challenge's identity with exclusive
/// write access to its durable state.
pub struct Claim {
    uuid: Uuid,
    inner: Box<dyn ChallengeClaim>,
}

impl Claim {
    #[must_use]
    pub fn new(uuid: Uuid, inner: Box<dyn ChallengeClaim>) -> Self {
        Claim { uuid, inner }
    }

    /// Identifier of the challenge this claim owns.
    #[must_use]
    pub fn uuid(&self) -> Uuid {
        self.uuid
    }
}

impl std::ops::Deref for Claim {
    type Target = dyn ChallengeClaim;

    fn deref(&self) -> &Self::Target {
        self.inner.as_ref()
    }
}

/// Resolution of a request to start a challenge for a party.
pub enum Start {
    /// This instance created and owns the challenge; its create is queued at
    /// the returned position.
    Created { claim: Claim, id: MsgId },
    /// Joined an active challenge for the party; the join is queued at the
    /// returned position.
    Joined { uuid: Uuid, id: MsgId },
}

/// A lifecycle milestone broadcast to external consumers.
/// Mirrors `ChallengeServerUpdate` in `//common/db/redis.ts`.
// TODO(frolv): STAGE_END should be added alongside the stage processor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChallengeServerUpdate {
    /// The challenge has ended.
    Finish,
}

/// Durable storage for challenge state, granting exclusive access through claims.
#[async_trait]
pub trait ChallengeStore: Send + Sync + 'static {
    /// Opens a new epoch claim on challenge `uuid`.
    async fn claim(&self, uuid: Uuid) -> Result<Box<dyn ChallengeClaim>, StoreError>;

    /// Starts a challenge for `party`, either creating and claiming a new one
    /// with `create` queued as its first command, or joining the party's
    /// running challenge with a join queued. Atomic with respect to other
    /// starts.
    async fn start(&self, party: &str, create: Create) -> Result<Start, StoreError>;

    /// Queues a command into the inbox for challenge `uuid`, returning its
    /// assigned ID, or `None` if no such challenge exists.
    ///
    /// The inbox is durable, ordered, and independent of any processing task;
    /// commands may be queued before one exists.
    async fn send(&self, uuid: Uuid, cmd: &Command) -> Result<Option<MsgId>, StoreError>;

    /// Queues a command into the inbox of the challenge that `client` is
    /// currently recording. Returns the challenge and the command's assigned
    /// ID, or `None` if the client is not in a live challenge.
    async fn send_to_current_challenge(
        &self,
        client: ClientId,
        cmd: &Command,
    ) -> Result<Option<(Uuid, MsgId)>, StoreError>;

    /// Reads the last projected state of challenge `uuid`.
    async fn read(&self, uuid: Uuid) -> Result<Option<Snapshot>, StoreError>;

    /// Delivers notifications of all challenge state updates to `sink`.
    fn subscribe(&self, sink: mpsc::Sender<(Uuid, MsgId)>);
}

/// An exclusive handle to a challenge's durable state. Gives access to writes
/// to the state, as long as the epoch is still valid.
#[async_trait]
pub trait ChallengeClaim: Send + Sync + 'static {
    /// Delivers the challenge's inbox entries positioned after `from` into
    /// `sink`, in order, until `sink` closes.
    fn follow(&self, from: MsgId, sink: mpsc::Sender<Envelope>);

    /// Appends a decision's entries to the challenge's journal as a single atomic batch.
    async fn append(&self, batch: &[JournalEntry]) -> Result<(), StoreError>;

    /// Publishes a snapshot of the challenge's state, signaling its update.
    async fn project(&self, snapshot: &Snapshot) -> Result<(), StoreError>;

    /// Broadcasts a lifecycle milestone to consumers.
    async fn announce(&self, update: &ChallengeServerUpdate) -> Result<(), StoreError>;
}

/// Capacity of the channel between a challenge's inbox feed and its actor task.
const INBOX_BUFFER_LEN: usize = 32;

/// Processes a claimed challenge's inbox until it terminates.
pub async fn run_challenge(config: LifecycleConfig, claim: Claim) {
    let (tx, rx) = mpsc::channel(INBOX_BUFFER_LEN);
    claim.follow(MsgId::default(), tx);
    ActiveChallenge::new(config, claim).run(rx).await;
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

/// Processing task for an ongoing challenge.
pub struct ActiveChallenge {
    pub state: ChallengeState,
    config: LifecycleConfig,
    claim: Claim,
    next_seq: u64,
}

impl ActiveChallenge {
    #[must_use]
    pub fn new(config: LifecycleConfig, claim: Claim) -> Self {
        ActiveChallenge {
            state: ChallengeState {
                uuid: claim.uuid,
                ..ChallengeState::default()
            },
            config,
            claim,
            next_seq: 0,
        }
    }

    /// Serially applies inbox commands and their implied deadline timers until
    /// the challenge terminates, publishing a fresh state snapshot after each.
    pub async fn run(&mut self, mut inbox: mpsc::Receiver<Envelope>) {
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

            let decided = !batch.is_empty();
            if decided {
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

            // Only publish if the state changed.
            let changed = decided || matches!(cause, Cause::Command(_));
            if changed {
                let current = Snapshot::of(&self.state, cursor);
                if let Err(error) =
                    with_retries(self.state.uuid, || self.claim.project(&current)).await
                {
                    tracing::error!(uuid = %self.state.uuid, %error, "projection_failed");
                    return;
                }
            }

            if let PhaseState::Terminated { .. } = self.state.phase {
                let finish = ChallengeServerUpdate::Finish;
                if let Err(error) =
                    with_retries(self.state.uuid, || self.claim.announce(&finish)).await
                {
                    tracing::error!(uuid = %self.state.uuid, %error, "announce_failed");
                }
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
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::lifecycle::core::command::Create;
    use crate::lifecycle::core::state::ChallengePhase;
    use crate::lifecycle::core::types::{
        ChallengeMode, ChallengeStatus, ChallengeType, ClientId, RecordingType, Stage, UserId,
    };

    #[derive(Default)]
    struct ClaimLog {
        /// Outcomes of upcoming store operations, popped per call in order;
        /// once drained, operations succeed.
        results: Mutex<VecDeque<Result<(), StoreError>>>,
        appended: Mutex<Vec<JournalEntry>>,
        projected: Mutex<Vec<Snapshot>>,
        announced: Mutex<Vec<ChallengeServerUpdate>>,
        calls: AtomicU64,
    }

    impl ClaimLog {
        fn next_result(&self) -> Result<(), StoreError> {
            self.calls.fetch_add(1, Ordering::Relaxed);
            self.results.lock().unwrap().pop_front().unwrap_or(Ok(()))
        }
    }

    struct ScriptedClaim(Arc<ClaimLog>);

    #[async_trait]
    impl ChallengeClaim for ScriptedClaim {
        fn follow(&self, _from: MsgId, _sink: mpsc::Sender<Envelope>) {
            unimplemented!("scripted runs feed the actor's inbox directly");
        }

        async fn append(&self, batch: &[JournalEntry]) -> Result<(), StoreError> {
            self.0.next_result()?;
            self.0
                .appended
                .lock()
                .unwrap()
                .extend(batch.iter().cloned());
            Ok(())
        }

        async fn project(&self, snapshot: &Snapshot) -> Result<(), StoreError> {
            self.0.next_result()?;
            self.0.projected.lock().unwrap().push(snapshot.clone());
            Ok(())
        }

        async fn announce(&self, update: &ChallengeServerUpdate) -> Result<(), StoreError> {
            self.0.next_result()?;
            self.0.announced.lock().unwrap().push(*update);
            Ok(())
        }
    }

    struct RunOutcome {
        log: Arc<ClaimLog>,
        uuid: Uuid,
    }

    /// Runs a challenge over a single create command whose store operations
    /// resolve with the scripted results, in call order.
    async fn run_solo_create(script: Vec<Result<(), StoreError>>) -> RunOutcome {
        let uuid = Uuid::new_v4();
        let log = Arc::new(ClaimLog {
            results: Mutex::new(script.into()),
            ..ClaimLog::default()
        });
        let mut challenge = ActiveChallenge::new(
            LifecycleConfig::default(),
            Claim::new(uuid, Box::new(ScriptedClaim(log.clone()))),
        );

        let (tx, rx) = mpsc::channel(1);
        tx.send(Envelope {
            id: MsgId::sequence(1),
            cmd: Command::Create(Create {
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
            }),
        })
        .await
        .expect("inbox should accept the create");
        drop(tx);
        challenge.run(rx).await;

        RunOutcome { log, uuid }
    }

    fn unavailable() -> Result<(), StoreError> {
        Err(StoreError::Unavailable("scripted".into()))
    }

    #[tokio::test(start_paused = true)]
    async fn transient_append_retries_until_durable() {
        let outcome = run_solo_create(vec![unavailable()]).await;

        // A failed append, its successful retry, and the projection.
        assert_eq!(outcome.log.calls.load(Ordering::Relaxed), 3);
        assert_eq!(
            *outcome.log.appended.lock().unwrap(),
            vec![
                JournalEntry {
                    seq: JournalSeq(0),
                    at: Timestamp::ZERO,
                    caused_by: Cause::Command(MsgId::sequence(1)),
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
                    caused_by: Cause::Command(MsgId::sequence(1)),
                    event: LifecycleEvent::ClientJoined {
                        client_id: ClientId(10),
                        user_id: UserId(1),
                        session_token: "tok1".into(),
                        recording_type: RecordingType::Participant,
                    },
                },
            ],
        );
        let expected = Snapshot {
            uuid: outcome.uuid,
            challenge_type: ChallengeType::Tob,
            mode: ChallengeMode::TobRegular,
            stage: Stage::TobMaiden,
            stage_attempt: None,
            party: vec!["a".into()],
            phase: ChallengePhase::Active,
            status: ChallengeStatus::InProgress,
            cursor: MsgId::sequence(1),
        };
        assert_eq!(*outcome.log.projected.lock().unwrap(), vec![expected]);
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
        assert!(outcome.log.projected.lock().unwrap().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn fenced_append_immediately_exits_unapplied() {
        let outcome = run_solo_create(vec![Err(StoreError::Fenced)]).await;

        assert_eq!(outcome.log.calls.load(Ordering::Relaxed), 1);
        assert!(outcome.log.appended.lock().unwrap().is_empty());
        assert!(outcome.log.projected.lock().unwrap().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn fenced_projection_exits_after_durable_append() {
        let outcome = run_solo_create(vec![Ok(()), Err(StoreError::Fenced)]).await;
        assert_eq!(outcome.log.appended.lock().unwrap().len(), 2);
        assert!(outcome.log.projected.lock().unwrap().is_empty());
    }
}

//! Live challenge state processing.

use core::future::Future;
use core::time::Duration;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, watch};

use super::core::apply::apply;
use super::core::command::{Command, Create, Envelope, Join};
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
    /// Stored state exists but cannot be interpreted.
    #[error("corrupt state: {0}")]
    Corrupt(String),
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

/// Resolution of a client's request to rejoin a challenge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rejoin {
    /// The rejoin routed and is queued at the returned position.
    Queued(MsgId),
    /// No live challenge with the requested ID exists.
    UnknownChallenge,
    /// The client is routed to a different challenge.
    AlreadyInChallenge,
}

/// A lifecycle milestone broadcast to external consumers.
/// Mirrors `ChallengeServerUpdate` in `//common/db/redis.ts`.
// TODO(frolv): STAGE_END should be added alongside the stage processor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChallengeServerUpdate {
    /// The challenge has ended.
    Finish,
}

/// A change to a challenge's published state, delivered to store subscribers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChallengeSignal {
    /// The challenge's state has been published up to inbox message `cursor`.
    Updated { uuid: Uuid, cursor: MsgId },
    /// The challenge's state has been deleted.
    Deleted { uuid: Uuid },
}

/// Durable storage for challenge state, granting exclusive access through claims.
///
/// A store is expected to maintain several bits of state:
///
/// - An index of all known challenges, alongside their owner and lease epoch.
/// - The inbox and journal of each challenge.
/// - A snapshot of each challenge's public state.
/// - A mapping of parties to their active challenge.
/// - A mapping of clients to their active challenge.
/// - A mapping of players to their active challenge.
///
/// In addition to this, stores should have a mechanism for signalling state
/// updates and challenge lifecycle updates to subscribers.
#[async_trait]
pub trait ChallengeStore: Send + Sync + 'static {
    /// Finds up to `batch_size` claimable challenges not listed in `exclude`
    /// and claims each under a fresh epoch, fencing off any previous owner.
    async fn claim_unowned(
        &self,
        batch_size: usize,
        exclude: &[Uuid],
    ) -> Result<Vec<Claim>, StoreError>;

    /// Starts a challenge for the party of `create`, either creating and claiming
    /// a new one with `create` queued as its first command, or joining the
    /// party's running challenge with a join queued. Atomic with respect to
    /// other starts.
    async fn start(&self, create: Create) -> Result<Start, StoreError>;

    /// Queues a join into the inbox for challenge `uuid` unless the client is
    /// already in a different challenge.
    async fn rejoin(&self, uuid: Uuid, join: &Join) -> Result<Rejoin, StoreError>;

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

    /// Delivers every challenge's state change signals to `sink`.
    fn subscribe(&self, sink: mpsc::Sender<ChallengeSignal>);
}

/// An exclusive handle to a challenge's durable state. Gives access to writes
/// to the state, as long as the epoch is still valid.
#[async_trait]
pub trait ChallengeClaim: Send + Sync + 'static {
    /// Returns every entry in the challenge's journal, in order.
    async fn load(&self) -> Result<Vec<JournalEntry>, StoreError>;

    /// Delivers the challenge's inbox entries positioned after `from` into
    /// `sink`, in order, until `sink` closes.
    fn follow(&self, from: MsgId, sink: mpsc::Sender<Envelope>);

    /// Appends a decision's entries to the challenge's journal as a single atomic batch.
    async fn append(&self, batch: &[JournalEntry]) -> Result<(), StoreError>;

    /// Publishes a snapshot of the challenge's state, signaling its update.
    async fn project(&self, snapshot: &Snapshot) -> Result<(), StoreError>;

    /// Broadcasts a lifecycle milestone to consumers.
    async fn announce(&self, update: &ChallengeServerUpdate) -> Result<(), StoreError>;

    /// Extends this claim's hold on the challenge.
    async fn renew(&self) -> Result<(), StoreError>;

    /// Releases this claim's hold on the challenge, leaving it immediately
    /// claimable by any instance.
    async fn release(&self) -> Result<(), StoreError>;

    /// Deletes all of the challenge's state from the store and prevents the
    /// routing of future commands to it. Signals the deletion to subscribers.
    /// The provided `state` is the final folded state of the challenge.
    async fn delete(&self, state: &ChallengeState) -> Result<(), StoreError>;
}

/// Capacity of the channel between a challenge's inbox feed and its actor task.
const INBOX_BUFFER_LEN: usize = 32;

/// Runs a claimed challenge until it terminates, then deletes its state.
/// Challenges are initialized from their existing journal state, if it exists,
/// continuing from where they left off.
/// When `shutdown` flips true, the challenge releases its lease and exits.
pub async fn run_challenge(config: LifecycleConfig, claim: Claim, shutdown: watch::Receiver<bool>) {
    let uuid = claim.uuid();
    let mut state = ChallengeState {
        uuid,
        ..ChallengeState::default()
    };
    let mut next_seq = 0;
    let mut resumed_at = Timestamp::ZERO;

    match with_retries(uuid, || claim.load()).await {
        Ok(entries) => {
            for entry in entries {
                next_seq = entry.seq.0 + 1;
                resumed_at = entry.at;
                apply(&mut state, entry);
            }
        }
        Err(StoreError::Corrupt(reason)) => {
            // Hold onto the claim for corrupt challenge data without modifying
            // or processing it to avoid it from coming up in future scans.
            // The data issue must be resolved manually by either deleting the
            // bad journal or updating the server to understand it.
            tracing::error!(%uuid, reason, "journal_corrupt");
            ActiveChallenge::new(config, claim, state, next_seq)
                .quarantine(shutdown)
                .await;
            return;
        }
        Err(error) => {
            tracing::error!(%uuid, %error, "journal_load_failed");
            return;
        }
    }

    let mut challenge = ActiveChallenge::new(config, claim, state, next_seq);
    challenge.run(resumed_at, shutdown).await;
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
    pub fn new(
        config: LifecycleConfig,
        claim: Claim,
        state: ChallengeState,
        next_seq: u64,
    ) -> Self {
        ActiveChallenge {
            state,
            config,
            claim,
            next_seq,
        }
    }

    /// Serially applies inbox commands and their implied deadline timers until
    /// the challenge terminates, publishing a fresh state snapshot after each.
    /// Deletes the challenge's state at the end if it terminates.
    /// `resumed_at` is the time of the last journal entry in the challenge's
    /// clock, to continue timestamps from it.
    pub async fn run(&mut self, resumed_at: Timestamp, mut shutdown: watch::Receiver<bool>) {
        if let PhaseState::Terminated { .. } = self.state.phase {
            // A previous task stopped between its terminal entry and deletion.
            self.conclude().await;
            return;
        }

        if *shutdown.borrow_and_update() {
            self.release_lease().await;
            return;
        }

        // A previous task may have exited after appending journal entries it
        // never projected, so republish the latest state on resume.
        if self.next_seq > 0 && !self.project(self.state.cursor).await {
            return;
        }

        let (tx, mut inbox) = mpsc::channel(INBOX_BUFFER_LEN);
        self.claim.follow(self.state.cursor, tx);

        let started = tokio::time::Instant::now();
        let base = resumed_at.as_millis();
        let mut cursor = self.state.cursor;

        let mut renewal = tokio::time::interval(self.config.lease_renewal_interval);
        renewal.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            let deadline = next_deadline(&self.state, &self.config);
            let wake_at = deadline.map_or(started, |d| {
                started + Duration::from_millis(d.at.as_millis().saturating_sub(base))
            });

            let input = tokio::select! {
                // Shutdown prioritized, and commands should be processed before deadlines.
                biased;
                _ = shutdown.changed() => {
                    shutdown.borrow_and_update();
                    self.release_lease().await;
                    return;
                }
                envelope = inbox.recv() => envelope.map(|e| (Cause::Command(e.id), e.cmd)),
                () = tokio::time::sleep_until(wake_at), if deadline.is_some() => {
                    deadline.map(|d| (Cause::Deadline(d.kind), Command::DeadlineFired(d)))
                }
                _ = renewal.tick() => {
                    if self.renew_lease().await {
                        continue;
                    }
                    return;
                }
            };
            let Some((cause, cmd)) = input else {
                break;
            };

            let elapsed = started.elapsed().as_millis();
            let at = Timestamp::from_millis(
                base.saturating_add(u64::try_from(elapsed).unwrap_or(u64::MAX)),
            );

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
            if changed && !self.project(cursor).await {
                return;
            }

            if let PhaseState::Terminated { .. } = self.state.phase {
                self.conclude().await;
                break;
            }
        }
    }

    /// Publishes a snapshot of the current state, returning false if the
    /// projection could not be written.
    async fn project(&self, cursor: MsgId) -> bool {
        let current = Snapshot::of(&self.state, cursor);
        if let Err(error) = with_retries(self.state.uuid, || self.claim.project(&current)).await {
            tracing::error!(uuid = %self.state.uuid, %error, "projection_failed");
            return false;
        }
        true
    }

    /// Repeatedly renews the lease of the challenge without processing it.
    async fn quarantine(&self, mut shutdown: watch::Receiver<bool>) {
        let mut renewal = tokio::time::interval(self.config.lease_renewal_interval);
        renewal.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                _ = shutdown.changed() => {
                    self.release_lease().await;
                    return;
                }
                _ = renewal.tick() => {
                    if !self.renew_lease().await {
                        return;
                    }
                }
            }
        }
    }

    /// Extends the challenge's lease. Returns false if claimed away.
    async fn renew_lease(&self) -> bool {
        match self.claim.renew().await {
            Ok(()) => true,
            Err(StoreError::Fenced) => {
                tracing::warn!(uuid = %self.state.uuid, "lease_lost");
                false
            }
            Err(error) => {
                // The next tick retries; the lease outlasts several misses.
                tracing::warn!(uuid = %self.state.uuid, %error, "lease_renewal_failed");
                true
            }
        }
    }

    async fn release_lease(&self) {
        match with_retries(self.state.uuid, || self.claim.release()).await {
            Ok(()) => tracing::info!(uuid = %self.state.uuid, "lease_released"),
            Err(error) => {
                tracing::error!(uuid = %self.state.uuid, %error, "lease_release_failed");
            }
        }
    }

    /// Publishes the challenge's finish and deletes its durable state.
    async fn conclude(&self) {
        let finish = ChallengeServerUpdate::Finish;
        if let Err(error) = with_retries(self.state.uuid, || self.claim.announce(&finish)).await {
            tracing::error!(uuid = %self.state.uuid, %error, "announce_failed");
        }
        if let Err(error) = with_retries(self.state.uuid, || self.claim.delete(&self.state)).await {
            tracing::error!(uuid = %self.state.uuid, %error, "challenge_delete_failed");
        }
    }

    async fn append(&self, batch: &[JournalEntry]) -> Result<(), StoreError> {
        with_retries(self.state.uuid, || self.claim.append(batch)).await
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, VecDeque};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::lifecycle::core::command::{Create, Finish};
    use crate::lifecycle::core::deadline::DeadlineKind;
    use crate::lifecycle::core::state::{ChallengePhase, StageState};
    use crate::lifecycle::core::types::{
        ChallengeMode, ChallengeStatus, ChallengeType, ClientId, RecordingType, Stage, StageStatus,
        UserId,
    };

    #[derive(Default)]
    struct ClaimLog {
        /// Outcomes of upcoming store operations, popped per call in order;
        /// once drained, operations succeed.
        results: Mutex<VecDeque<Result<(), StoreError>>>,
        /// Outcomes of upcoming lease renewals.
        renew_results: Mutex<VecDeque<Result<(), StoreError>>>,
        renewals: AtomicU64,
        releases: AtomicU64,
        appended: Mutex<Vec<JournalEntry>>,
        projected: Mutex<Vec<Snapshot>>,
        announced: Mutex<Vec<ChallengeServerUpdate>>,
        deleted: Mutex<Vec<ChallengeState>>,
        // Holds the inbox feed's sender when the run is deadline-driven,
        // as dropping it would close the actor's inbox and end the run.
        sink: Mutex<Option<mpsc::Sender<Envelope>>>,
        calls: AtomicU64,
    }

    impl ClaimLog {
        fn next_result(&self) -> Result<(), StoreError> {
            self.calls.fetch_add(1, Ordering::Relaxed);
            self.results.lock().unwrap().pop_front().unwrap_or(Ok(()))
        }
    }

    struct ScriptedClaim {
        log: Arc<ClaimLog>,
        /// Journal contents returned by `load`.
        journal: Vec<JournalEntry>,
        /// Inbox contents delivered by `follow`.
        inbox: Vec<Envelope>,
        /// Keep the inbox open after its backlog, letting deadlines drive
        /// the run instead of the feed's end.
        hold_inbox: bool,
    }

    #[async_trait]
    impl ChallengeClaim for ScriptedClaim {
        async fn load(&self) -> Result<Vec<JournalEntry>, StoreError> {
            self.log.next_result()?;
            Ok(self.journal.clone())
        }

        fn follow(&self, from: MsgId, sink: mpsc::Sender<Envelope>) {
            for envelope in self.inbox.iter().filter(|e| e.id > from) {
                sink.try_send(envelope.clone())
                    .expect("scripted inbox exceeds channel capacity");
            }
            if self.hold_inbox {
                *self.log.sink.lock().unwrap() = Some(sink);
            }
        }

        async fn append(&self, batch: &[JournalEntry]) -> Result<(), StoreError> {
            self.log.next_result()?;
            self.log
                .appended
                .lock()
                .unwrap()
                .extend(batch.iter().cloned());
            Ok(())
        }

        async fn project(&self, snapshot: &Snapshot) -> Result<(), StoreError> {
            self.log.next_result()?;
            self.log.projected.lock().unwrap().push(snapshot.clone());
            Ok(())
        }

        async fn announce(&self, update: &ChallengeServerUpdate) -> Result<(), StoreError> {
            self.log.next_result()?;
            self.log.announced.lock().unwrap().push(*update);
            Ok(())
        }

        async fn renew(&self) -> Result<(), StoreError> {
            self.log.renewals.fetch_add(1, Ordering::Relaxed);
            self.log
                .renew_results
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Ok(()))
        }

        async fn release(&self) -> Result<(), StoreError> {
            self.log.releases.fetch_add(1, Ordering::Relaxed);
            Ok(())
        }

        async fn delete(&self, state: &ChallengeState) -> Result<(), StoreError> {
            self.log.next_result()?;
            self.log.deleted.lock().unwrap().push(state.clone());
            Ok(())
        }
    }

    struct RunOutcome {
        log: Arc<ClaimLog>,
        uuid: Uuid,
    }

    fn create_command() -> Command {
        Command::Create(Create {
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
        })
    }

    fn finish_command() -> Command {
        Command::Finish(Finish {
            user_id: UserId(1),
            client_id: ClientId(10),
            session_token: "tok1".into(),
            times: None,
            soft: false,
        })
    }

    /// Runs a challenge through `run_challenge` over a scripted journal and
    /// inbox, with store operations resolving from the scripted results in
    /// call order.
    async fn run_scripted(
        script: Vec<Result<(), StoreError>>,
        journal: Vec<JournalEntry>,
        commands: Vec<Command>,
        hold_inbox: bool,
    ) -> RunOutcome {
        let uuid = Uuid::new_v4();
        let log = Arc::new(ClaimLog {
            results: Mutex::new(script.into()),
            ..ClaimLog::default()
        });
        let inbox = commands
            .into_iter()
            .enumerate()
            .map(|(position, cmd)| Envelope {
                id: MsgId::sequence(position as u64 + 1),
                cmd,
            })
            .collect();
        let claim = Claim::new(
            uuid,
            Box::new(ScriptedClaim {
                log: log.clone(),
                journal,
                inbox,
                hold_inbox,
            }),
        );
        let (_tx, rx) = watch::channel(false);
        run_challenge(LifecycleConfig::default(), claim, rx).await;

        RunOutcome { log, uuid }
    }

    /// Runs a fresh challenge over a sequence of commands whose store
    /// operations resolve with the scripted results, in call order.
    async fn run_commands(
        script: Vec<Result<(), StoreError>>,
        commands: Vec<Command>,
    ) -> RunOutcome {
        run_scripted(script, Vec::new(), commands, false).await
    }

    /// Runs a challenge over a single create command whose store operations
    /// resolve with the scripted results, in call order.
    async fn run_solo_create(script: Vec<Result<(), StoreError>>) -> RunOutcome {
        run_commands(script, vec![create_command()]).await
    }

    fn unavailable() -> Result<(), StoreError> {
        Err(StoreError::Unavailable("scripted".into()))
    }

    #[tokio::test(start_paused = true)]
    async fn transient_append_retries_until_durable() {
        let outcome = run_solo_create(vec![Ok(()), unavailable()]).await;

        // The load, a failed append, its successful retry, and the projection.
        assert_eq!(outcome.log.calls.load(Ordering::Relaxed), 4);
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
        let mut script = vec![Ok(())];
        script.extend(vec![unavailable(); STORE_ATTEMPTS as usize]);
        let outcome = run_solo_create(script).await;

        // The load, then the append's exhausted attempts.
        assert_eq!(
            outcome.log.calls.load(Ordering::Relaxed),
            u64::from(STORE_ATTEMPTS) + 1,
        );
        assert!(outcome.log.appended.lock().unwrap().is_empty());
        assert!(outcome.log.projected.lock().unwrap().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn fenced_append_immediately_exits_unapplied() {
        let outcome = run_solo_create(vec![Ok(()), Err(StoreError::Fenced)]).await;

        assert_eq!(outcome.log.calls.load(Ordering::Relaxed), 2);
        assert!(outcome.log.appended.lock().unwrap().is_empty());
        assert!(outcome.log.projected.lock().unwrap().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn fenced_projection_exits_after_durable_append() {
        let outcome = run_solo_create(vec![Ok(()), Ok(()), Err(StoreError::Fenced)]).await;
        assert_eq!(outcome.log.appended.lock().unwrap().len(), 2);
        assert!(outcome.log.projected.lock().unwrap().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn termination_deletes_challenge_state() {
        let outcome = run_commands(vec![], vec![create_command(), finish_command()]).await;

        // Load, create's append and projection, finish's append, projection,
        // announcement, and deletion.
        assert_eq!(outcome.log.calls.load(Ordering::Relaxed), 7);
        assert_eq!(
            *outcome.log.announced.lock().unwrap(),
            vec![ChallengeServerUpdate::Finish],
        );

        let appended = outcome.log.appended.lock().unwrap();
        assert_eq!(appended.len(), 4);
        assert_eq!(
            appended[2..],
            [
                JournalEntry {
                    seq: JournalSeq(2),
                    at: Timestamp::ZERO,
                    caused_by: Cause::Command(MsgId::sequence(2)),
                    event: LifecycleEvent::ClientFinished {
                        client_id: ClientId(10),
                        definitive: true,
                        soft: false,
                        times: None,
                    },
                },
                JournalEntry {
                    seq: JournalSeq(3),
                    at: Timestamp::ZERO,
                    caused_by: Cause::Command(MsgId::sequence(2)),
                    event: LifecycleEvent::ChallengeTerminated {
                        status: ChallengeStatus::Reset,
                        empty: false,
                    },
                },
            ],
        );

        let expected = ChallengeState {
            uuid: outcome.uuid,
            challenge_type: ChallengeType::Tob,
            mode: ChallengeMode::TobRegular,
            party: vec!["a".into()],
            party_changed: false,
            phase: PhaseState::Terminated {
                status: ChallengeStatus::Reset,
            },
            reported_times: None,
            stage: Stage::TobMaiden,
            stage_attempt: None,
            stage_status: StageStatus::Entered,
            stage_state: StageState::InProgress,
            clients: BTreeMap::new(),
            recorded_by: [ClientId(10)].into(),
            dormant_since: Some(Timestamp::ZERO),
            cursor: MsgId::sequence(2),
        };
        assert_eq!(*outcome.log.deleted.lock().unwrap(), vec![expected]);
    }

    #[tokio::test(start_paused = true)]
    async fn fenced_deletion_exits_cleanly() {
        let mut script = vec![Ok(()); 6];
        script.push(Err(StoreError::Fenced));
        let outcome = run_commands(script, vec![create_command(), finish_command()]).await;

        assert_eq!(outcome.log.calls.load(Ordering::Relaxed), 7);
        assert_eq!(
            *outcome.log.announced.lock().unwrap(),
            vec![ChallengeServerUpdate::Finish],
        );
        assert!(outcome.log.deleted.lock().unwrap().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn transient_deletion_failures_retry() {
        let mut script = vec![Ok(()); 6];
        script.push(unavailable());
        let outcome = run_commands(script, vec![create_command(), finish_command()]).await;

        // The seventh call is the failed deletion; the eighth its retry.
        assert_eq!(outcome.log.calls.load(Ordering::Relaxed), 8);
        assert_eq!(outcome.log.deleted.lock().unwrap().len(), 1);
    }

    /// A journal fixture entry caused by inbox message `msg`.
    fn journaled(seq: u64, at_ms: u64, msg: u64, event: LifecycleEvent) -> JournalEntry {
        JournalEntry {
            seq: JournalSeq(seq),
            at: Timestamp::from_millis(at_ms),
            caused_by: Cause::Command(MsgId::sequence(msg)),
            event,
        }
    }

    /// The journal of the challenge created by `create_command`, as of its application.
    fn created_journal(uuid: Uuid) -> Vec<JournalEntry> {
        vec![
            journaled(
                0,
                0,
                1,
                LifecycleEvent::ChallengeCreated {
                    uuid,
                    challenge_type: ChallengeType::Tob,
                    mode: ChallengeMode::TobRegular,
                    party: vec!["a".into()],
                    stage: Stage::TobMaiden,
                },
            ),
            journaled(
                1,
                0,
                1,
                LifecycleEvent::ClientJoined {
                    client_id: ClientId(10),
                    user_id: UserId(1),
                    session_token: "tok1".into(),
                    recording_type: RecordingType::Participant,
                },
            ),
        ]
    }

    #[tokio::test(start_paused = true)]
    async fn failing_load_exits_before_processing() {
        let script = vec![unavailable(); STORE_ATTEMPTS as usize];
        let outcome = run_commands(script, vec![create_command()]).await;

        assert_eq!(
            outcome.log.calls.load(Ordering::Relaxed),
            u64::from(STORE_ATTEMPTS),
        );
        assert!(outcome.log.appended.lock().unwrap().is_empty());
        assert!(outcome.log.projected.lock().unwrap().is_empty());
        assert!(outcome.log.deleted.lock().unwrap().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn terminal_journal_resumes_straight_to_deletion() {
        let uuid = Uuid::new_v4();
        let mut journal = created_journal(uuid);
        journal.push(journaled(
            2,
            500,
            2,
            LifecycleEvent::ClientFinished {
                client_id: ClientId(10),
                definitive: true,
                soft: false,
                times: None,
            },
        ));
        journal.push(journaled(
            3,
            500,
            2,
            LifecycleEvent::ChallengeTerminated {
                status: ChallengeStatus::Reset,
                empty: false,
            },
        ));

        // The queued command is never processed.
        let outcome = run_scripted(vec![], journal, vec![finish_command()], false).await;

        // Load, announcement, deletion.
        assert_eq!(outcome.log.calls.load(Ordering::Relaxed), 3);
        assert!(outcome.log.appended.lock().unwrap().is_empty());
        assert!(outcome.log.projected.lock().unwrap().is_empty());
        assert_eq!(
            *outcome.log.announced.lock().unwrap(),
            vec![ChallengeServerUpdate::Finish],
        );
        let expected = ChallengeState {
            uuid,
            challenge_type: ChallengeType::Tob,
            mode: ChallengeMode::TobRegular,
            party: vec!["a".into()],
            party_changed: false,
            phase: PhaseState::Terminated {
                status: ChallengeStatus::Reset,
            },
            reported_times: None,
            stage: Stage::TobMaiden,
            stage_attempt: None,
            stage_status: StageStatus::Entered,
            stage_state: StageState::InProgress,
            clients: BTreeMap::new(),
            recorded_by: [ClientId(10)].into(),
            dormant_since: Some(Timestamp::from_millis(500)),
            cursor: MsgId::sequence(2),
        };
        assert_eq!(*outcome.log.deleted.lock().unwrap(), vec![expected]);
    }

    #[tokio::test(start_paused = true)]
    async fn resume_projects_the_folded_state_once() {
        let uuid = Uuid::new_v4();
        let outcome = run_scripted(vec![], created_journal(uuid), vec![], false).await;

        assert!(outcome.log.appended.lock().unwrap().is_empty());
        assert_eq!(
            *outcome.log.projected.lock().unwrap(),
            vec![Snapshot {
                uuid,
                challenge_type: ChallengeType::Tob,
                mode: ChallengeMode::TobRegular,
                stage: Stage::TobMaiden,
                stage_attempt: None,
                party: vec!["a".into()],
                phase: ChallengePhase::Active,
                status: ChallengeStatus::InProgress,
                cursor: MsgId::sequence(1),
            }],
        );
    }

    #[tokio::test(start_paused = true)]
    async fn resume_skips_already_applied_commands() {
        // Create has already been applied, so only finish is left.
        let uuid = Uuid::new_v4();
        let outcome = run_scripted(
            vec![],
            created_journal(uuid),
            vec![create_command(), finish_command()],
            false,
        )
        .await;

        let appended = outcome.log.appended.lock().unwrap();
        assert_eq!(
            *appended,
            vec![
                journaled(
                    2,
                    0,
                    2,
                    LifecycleEvent::ClientFinished {
                        client_id: ClientId(10),
                        definitive: true,
                        soft: false,
                        times: None,
                    },
                ),
                journaled(
                    3,
                    0,
                    2,
                    LifecycleEvent::ChallengeTerminated {
                        status: ChallengeStatus::Reset,
                        empty: false,
                    },
                ),
            ],
        );
        assert_eq!(outcome.log.deleted.lock().unwrap().len(), 1);
    }

    /// A journal whose challenge's only client joined and then disconnected
    /// `removed_at_ms` into the challenge.
    fn dormant_journal(uuid: Uuid, removed_at_ms: u64) -> Vec<JournalEntry> {
        let mut journal = created_journal(uuid);
        journal.push(journaled(
            2,
            removed_at_ms,
            2,
            LifecycleEvent::ClientRemoved {
                client_id: ClientId(10),
            },
        ));
        journal
    }

    #[tokio::test(start_paused = true)]
    async fn resumed_window_waits_out_its_remainder() {
        let config = LifecycleConfig::default();
        let window = u64::try_from(config.reconnection_window.as_millis()).unwrap();

        let uuid = Uuid::new_v4();
        let outcome = run_scripted(vec![], dormant_journal(uuid, 1_000), vec![], true).await;

        // The reconnection window opened at the disconnect and fires a full
        // window after it on the resumed clock.
        let appended = outcome.log.appended.lock().unwrap();
        assert_eq!(
            *appended,
            vec![JournalEntry {
                seq: JournalSeq(3),
                at: Timestamp::from_millis(1_000 + window),
                caused_by: Cause::Deadline(DeadlineKind::CleanupDisconnect),
                event: LifecycleEvent::ChallengeTerminated {
                    status: ChallengeStatus::Reset,
                    empty: false,
                },
            }],
        );
        assert_eq!(outcome.log.deleted.lock().unwrap().len(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn resumed_overdue_deadline_fires_immediately() {
        let config = LifecycleConfig::default();
        let window = u64::try_from(config.reconnection_window.as_millis()).unwrap();

        // The challenge's clock is already far past the reconnection window
        // that the disconnect at 1s armed.
        let uuid = Uuid::new_v4();
        let mut journal = dormant_journal(uuid, 1_000);
        journal.push(journaled(
            3,
            window * 3,
            3,
            LifecycleEvent::ModeChanged {
                mode: ChallengeMode::TobHard,
            },
        ));
        let outcome = run_scripted(vec![], journal, vec![], true).await;

        let appended = outcome.log.appended.lock().unwrap();
        assert_eq!(
            *appended,
            vec![JournalEntry {
                seq: JournalSeq(4),
                at: Timestamp::from_millis(window * 3),
                caused_by: Cause::Deadline(DeadlineKind::CleanupDisconnect),
                event: LifecycleEvent::ChallengeTerminated {
                    status: ChallengeStatus::Reset,
                    empty: false,
                },
            }],
        );
        assert_eq!(outcome.log.deleted.lock().unwrap().len(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn lease_renews_on_its_interval_while_running() {
        let config = LifecycleConfig::default();
        let window = config.reconnection_window.as_millis();
        let interval = config.lease_renewal_interval.as_millis();

        let uuid = Uuid::new_v4();
        let outcome = run_scripted(vec![], dormant_journal(uuid, 1_000), vec![], true).await;

        assert_eq!(
            u128::from(outcome.log.renewals.load(Ordering::Relaxed)),
            window / interval,
        );
        assert_eq!(outcome.log.deleted.lock().unwrap().len(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn lost_lease_exits_without_concluding() {
        let uuid = Uuid::new_v4();
        let log = Arc::new(ClaimLog {
            renew_results: Mutex::new(vec![Err(StoreError::Fenced)].into()),
            ..ClaimLog::default()
        });
        let claim = Claim::new(
            uuid,
            Box::new(ScriptedClaim {
                log: log.clone(),
                journal: created_journal(uuid),
                inbox: Vec::new(),
                hold_inbox: true,
            }),
        );
        let (_tx, rx) = watch::channel(false);
        run_challenge(LifecycleConfig::default(), claim, rx).await;

        assert_eq!(log.renewals.load(Ordering::Relaxed), 1);
        assert!(log.appended.lock().unwrap().is_empty());
        assert!(log.announced.lock().unwrap().is_empty());
        assert!(log.deleted.lock().unwrap().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn shutdown_releases_the_lease_and_exits() {
        let uuid = Uuid::new_v4();
        let log = Arc::new(ClaimLog::default());
        let claim = Claim::new(
            uuid,
            Box::new(ScriptedClaim {
                log: log.clone(),
                journal: created_journal(uuid),
                inbox: Vec::new(),
                hold_inbox: true,
            }),
        );
        let (shutdown, rx) = watch::channel(false);
        let actor = tokio::spawn(run_challenge(LifecycleConfig::default(), claim, rx));

        tokio::time::sleep(Duration::from_secs(1)).await;
        shutdown.send(true).expect("actor should be listening");
        actor.await.expect("actor should exit cleanly");

        assert_eq!(log.releases.load(Ordering::Relaxed), 1);
        assert!(log.appended.lock().unwrap().is_empty());
        assert!(log.announced.lock().unwrap().is_empty());
        assert!(log.deleted.lock().unwrap().is_empty());
    }
}

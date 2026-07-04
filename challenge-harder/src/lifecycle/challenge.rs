//! Live challenge state processing.

use core::time::Duration;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use tokio::sync::{mpsc, watch};

use super::core::apply::apply;
use super::core::command::{Command, Envelope};
use super::core::deadline::{LifecycleConfig, next_deadline};
use super::core::decide::decide;
use super::core::event::{Cause, JournalEntry};
use super::core::state::{ChallengePhase, ChallengeState, Snapshot};
use super::core::types::{JournalSeq, MsgId, Timestamp, Uuid};

/// Receives every journal entry a challenge writes, in order.
pub trait JournalSink: Send + Sync + 'static {
    fn append(&self, uuid: Uuid, entry: &JournalEntry);
}

pub struct NoopJournalSink;

impl JournalSink for NoopJournalSink {
    fn append(&self, _uuid: Uuid, _entry: &JournalEntry) {}
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
    journal: Vec<JournalEntry>,
    config: LifecycleConfig,
    sink: Arc<dyn JournalSink>,
    next_seq: u64,
}

impl ActiveChallenge {
    #[must_use]
    pub fn new(uuid: Uuid, config: LifecycleConfig, sink: Arc<dyn JournalSink>) -> Self {
        ActiveChallenge {
            state: ChallengeState {
                uuid,
                ..ChallengeState::default()
            },
            journal: Vec::new(),
            config,
            sink,
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

            for event in decide(&self.state, &self.config, &cmd) {
                let entry = JournalEntry {
                    seq: JournalSeq(self.next_seq),
                    at,
                    caused_by: cause,
                    event,
                };
                self.next_seq += 1;
                self.sink.append(self.state.uuid, &entry);
                self.journal.push(entry.clone());
                apply(&mut self.state, entry);
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
}

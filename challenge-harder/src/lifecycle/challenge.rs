//! Live challenge state processing.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use tokio::sync::{mpsc, watch};

use super::core::apply::apply;
use super::core::command::{Command, Envelope};
use super::core::decide::decide;
use super::core::event::JournalEntry;
use super::core::state::{ChallengeState, Snapshot};
use super::core::types::{ChallengeStatus, JournalSeq, MsgId, Timestamp, Uuid};

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
    pub journal: Vec<JournalEntry>,
    next_seq: u64,
}

impl ActiveChallenge {
    #[must_use]
    pub fn new(uuid: Uuid) -> Self {
        ActiveChallenge {
            state: ChallengeState {
                uuid,
                ..ChallengeState::default()
            },
            journal: Vec::new(),
            next_seq: 0,
        }
    }

    /// Serially applies inbox commands until the challenge terminates,
    /// publishing a fresh state snapshot after each one.
    pub async fn run(
        &mut self,
        mut inbox: mpsc::UnboundedReceiver<Envelope>,
        snapshot: watch::Sender<Snapshot>,
    ) {
        let started = tokio::time::Instant::now();

        while let Some(envelope) = inbox.recv().await {
            let elapsed = started.elapsed().as_millis();
            let at = Timestamp::from_millis(u64::try_from(elapsed).unwrap_or(u64::MAX));

            for event in decide(&self.state, &envelope.cmd) {
                let entry = JournalEntry {
                    seq: JournalSeq(self.next_seq),
                    at,
                    caused_by: envelope.id,
                    event,
                };
                self.next_seq += 1;
                self.journal.push(entry.clone());
                apply(&mut self.state, entry);
            }

            snapshot.send_replace(Snapshot::of(&self.state, envelope.id));

            if self.state.status != ChallengeStatus::InProgress {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lifecycle::core::command::{Create, Finish, StageProgress, Update};
    use crate::lifecycle::core::types::{
        ChallengeMode, ChallengeType, ClientId, RecordingType, Stage, StageStatus, UserId,
    };

    const CLIENT: ClientId = ClientId(10);

    fn stage_update(stage: Stage, status: StageStatus) -> Command {
        Command::Update(Update {
            user_id: UserId(1),
            client_id: CLIENT,
            session_token: "tok".into(),
            mode: None,
            stage: Some(StageProgress { stage, status }),
            party: None,
        })
    }

    #[tokio::test(start_paused = true)]
    async fn live_run_and_journal_replay_produce_the_same_state() {
        let uuid = Uuid::from_u128(0xb1e47);
        let mut challenge = ActiveChallenge::new(uuid);
        let (sender, rx) = inbox();
        let (snapshot_tx, snapshot_rx) = watch::channel(Snapshot::of(&challenge.state, MsgId(0)));

        sender.send(Command::Create(Create {
            user_id: UserId(1),
            client_id: CLIENT,
            session_token: "tok".into(),
            plugin_version: "0.9.14".into(),
            runelite_version: "1.12.31.1".into(),
            challenge_type: ChallengeType::Colosseum,
            mode: ChallengeMode::NoMode,
            party: vec!["Skitter".into()],
            stage: Stage::ColosseumWave1,
            recording_type: RecordingType::Participant,
        }));
        sender.send(stage_update(Stage::ColosseumWave1, StageStatus::Started));
        sender.send(stage_update(Stage::ColosseumWave1, StageStatus::Completed));
        sender.send(stage_update(Stage::ColosseumWave2, StageStatus::Started));
        sender.send(stage_update(Stage::ColosseumWave2, StageStatus::Wiped));
        sender.send(Command::Finish(Finish {
            user_id: UserId(1),
            client_id: CLIENT,
            session_token: "tok".into(),
            times: None,
            soft: false,
        }));

        challenge.run(rx, snapshot_tx).await;

        assert_eq!(challenge.state.status, ChallengeStatus::Wiped);
        assert_eq!(challenge.state.stage, Stage::ColosseumWave2);
        assert!(challenge.state.clients.is_empty());

        let snapshot = *snapshot_rx.borrow();
        assert_eq!(snapshot.status, ChallengeStatus::Wiped);
        assert_eq!(snapshot.stage, Stage::ColosseumWave2);
        assert_eq!(snapshot.cursor, MsgId(6));

        let mut replayed = ChallengeState {
            uuid,
            ..ChallengeState::default()
        };
        for entry in challenge.journal.clone() {
            apply(&mut replayed, entry);
        }
        assert_eq!(replayed, challenge.state);
    }
}

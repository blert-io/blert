//! A coordinator owns the server's active challenges, routing commands and
//! ruling on creation.

use std::collections::HashMap;
use std::sync::Mutex;

use tokio::sync::watch;

use std::sync::Arc;

use super::challenge::{ActiveChallenge, CommandSender, JournalSink, NoopJournalSink, inbox};
use super::core::command::{Command, Create, Finish, Join, Update};
use super::core::deadline::LifecycleConfig;
use super::core::state::{ChallengePhase, Snapshot};
use super::core::types::{ChallengeType, MsgId, Uuid};

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CommandError {
    #[error("no active challenge with the given ID")]
    UnknownChallenge,
    #[error("the challenge shut down before applying the command")]
    Unavailable,
}

#[derive(Clone)]
struct ChallengeHandle {
    sender: CommandSender,
    snapshot: watch::Receiver<Snapshot>,
}

/// Which challenge a group of players is recording.
type PartyKey = String;

/// Standard RSN normalization, as in `//common/player.ts`.
fn normalize_rsn(name: &str) -> String {
    name.to_lowercase().replace(['-', ' '], "_")
}

fn party_key(challenge_type: ChallengeType, party: &[String]) -> PartyKey {
    // Matches `challengePartyKey` in `//common/db/redis.ts`.
    let mut sorted: Vec<&String> = party.iter().collect();
    sorted.sort_unstable();
    let names: Vec<String> = sorted.into_iter().map(|n| normalize_rsn(n)).collect();
    format!("{}-{}", challenge_type as i32, names.join("-"))
}

#[derive(Default)]
struct Registry {
    challenges: HashMap<Uuid, ChallengeHandle>,
    directory: HashMap<PartyKey, Uuid>,
}

pub struct Coordinator {
    registry: Mutex<Registry>,
    config: LifecycleConfig,
    journal_sink: Arc<dyn JournalSink>,
}

impl Default for Coordinator {
    fn default() -> Self {
        Coordinator {
            registry: Mutex::default(),
            config: LifecycleConfig::default(),
            journal_sink: Arc::new(NoopJournalSink),
        }
    }
}

impl Coordinator {
    #[must_use]
    pub fn new() -> Self {
        Coordinator::default()
    }

    #[must_use]
    pub fn with_journal_sink(sink: Arc<dyn JournalSink>) -> Self {
        Coordinator {
            journal_sink: sink,
            ..Coordinator::default()
        }
    }

    /// Returns the current state of an active challenge, if it exists.
    #[must_use]
    pub fn snapshot(&self, uuid: Uuid) -> Option<Snapshot> {
        self.registry
            .lock()
            .expect("coordinator lock poisoned")
            .challenges
            .get(&uuid)
            .map(|h| *h.snapshot.borrow())
    }

    /// Creates a new challenge for a party or joins an existing one, returning
    /// the challenge's state once the request has been applied.
    /// `None` means the challenge shut down before the request could be processed.
    pub async fn create_or_join_challenge(&self, create: Create) -> Option<Snapshot> {
        let (id, handle, joined) = {
            let key = party_key(create.challenge_type, &create.party);
            let mut registry = self.registry.lock().expect("coordinator lock poisoned");

            // TODO(frolv): Move this to a lua script
            let incumbent = registry
                .directory
                .get(&key)
                .and_then(|uuid| registry.challenges.get(uuid))
                .filter(|h| {
                    h.snapshot.has_changed().is_ok()
                        && h.snapshot.borrow().phase == ChallengePhase::Active
                })
                .cloned();

            if let Some(handle) = incumbent {
                let uuid = handle.snapshot.borrow().uuid;
                tracing::debug!(
                    %uuid,
                    user_id = %create.user_id,
                    client_id = %create.client_id,
                    "challenge_joined",
                );
                let id = handle.sender.send(Command::Join(Join {
                    user_id: create.user_id,
                    client_id: create.client_id,
                    session_token: create.session_token,
                    plugin_version: create.plugin_version,
                    runelite_version: create.runelite_version,
                    recording_type: create.recording_type,
                }));
                (id, handle, true)
            } else {
                let uuid = Uuid::new_v4();
                tracing::debug!(
                    %uuid,
                    challenge_type = ?create.challenge_type,
                    party = ?create.party,
                    stage = ?create.stage,
                    user_id = %create.user_id,
                    client_id = %create.client_id,
                    "challenge_created",
                );
                let mut challenge =
                    ActiveChallenge::new(uuid, self.config.clone(), self.journal_sink.clone());
                let (sender, rx) = inbox();
                let (snapshot_tx, snapshot_rx) =
                    watch::channel(Snapshot::of(&challenge.state, MsgId(0)));

                tokio::spawn(async move {
                    challenge.run(rx, snapshot_tx).await;
                    challenge
                });

                let handle = ChallengeHandle {
                    sender,
                    snapshot: snapshot_rx,
                };
                registry.challenges.insert(uuid, handle.clone());
                registry.directory.insert(key, uuid);

                let id = handle.sender.send(Command::Create(create));
                (id, handle, false)
            }
        };

        let snapshot = applied(handle, id).await;
        if snapshot.is_none() && joined {
            // In theory, a new challenge's start could race the existing one's
            // termination and be incorrectly handled as a join. Given the
            // minimum time between two challenges in game, though, there isn't
            // a realistic path for this to happen. Just log if it ever occurs.
            tracing::error!(msg_id = %id, "challenge_join_incumbent_terminated");
        }
        snapshot
    }

    /// Updates the state of an active challenge, returning its new state.
    pub async fn update(&self, uuid: Uuid, update: Update) -> Result<Snapshot, CommandError> {
        tracing::debug!(
            %uuid,
            stage = ?update.stage,
            mode = ?update.mode,
            user_id = %update.user_id,
            client_id = %update.client_id,
            "challenge_update",
        );
        self.send_command(uuid, Command::Update(update)).await
    }

    /// Marks a challenge as having been completed by a client.
    pub async fn finish(&self, uuid: Uuid, finish: Finish) -> Result<Snapshot, CommandError> {
        tracing::debug!(
            %uuid,
            user_id = %finish.user_id,
            client_id = %finish.client_id,
            soft = finish.soft,
            times = ?finish.times,
            "challenge_finish",
        );
        let result = self.send_command(uuid, Command::Finish(finish)).await;
        if let Ok(p) = &result
            && let ChallengePhase::Terminated { status } = p.phase
        {
            tracing::debug!(%uuid, ?status, "challenge_terminated");
        }
        result
    }

    /// Sends a command to an active challenge, waiting for it to be applied.
    async fn send_command(&self, uuid: Uuid, cmd: Command) -> Result<Snapshot, CommandError> {
        let handle = self
            .registry
            .lock()
            .expect("coordinator lock poisoned")
            .challenges
            .get(&uuid)
            .cloned()
            .ok_or(CommandError::UnknownChallenge)?;

        let id = handle.sender.send(cmd);
        applied(handle, id).await.ok_or(CommandError::Unavailable)
    }
}

/// Waits until the challenge has processed the message at `id`, returning its
/// state at that point.
async fn applied(mut handle: ChallengeHandle, id: MsgId) -> Option<Snapshot> {
    if let Ok(p) = handle.snapshot.wait_for(|p| p.cursor >= id).await {
        return Some(*p);
    }

    // The channel closes when the challenge exits; read its final state.
    let p = *handle.snapshot.borrow();
    (p.cursor >= id).then_some(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lifecycle::core::command::StageProgress;
    use crate::lifecycle::core::types::{
        ChallengeMode, ClientId, RecordingType, Stage, StageStatus, UserId,
    };

    fn create_request() -> Create {
        Create {
            user_id: UserId(1),
            client_id: ClientId(10),
            session_token: "tok".into(),
            plugin_version: "0.9.14".into(),
            runelite_version: "1.12.31.1".into(),
            challenge_type: ChallengeType::Tob,
            mode: ChallengeMode::TobRegular,
            party: vec!["WWWWWWWWWWQQ".into()],
            stage: Stage::TobMaiden,
            recording_type: RecordingType::Participant,
        }
    }

    #[test]
    fn party_key_sorts_raw_names_then_normalizes() {
        let key = party_key(
            ChallengeType::Tob,
            &[
                "WWWWWWWWWWQQ".into(),
                "715".into(),
                "1Ogp".into(),
                "Caps lock13".into(),
            ],
        );
        assert_eq!(key, "1-1ogp-715-caps_lock13-wwwwwwwwwwqq");
    }
}

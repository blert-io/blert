//! A coordinator owns the server's active challenges, routing commands and
//! ruling on creation.

use std::collections::HashMap;
use std::sync::Mutex;

use tokio::sync::watch;

use super::challenge::{ActiveChallenge, CommandSender, inbox};
use super::core::command::{Command, Create, Finish, Update};
use super::core::state::Snapshot;
use super::core::types::{ChallengeStatus, ChallengeType, MsgId, Uuid};

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

#[derive(Default)]
pub struct Coordinator {
    registry: Mutex<Registry>,
}

impl Coordinator {
    #[must_use]
    pub fn new() -> Self {
        Coordinator::default()
    }

    /// Creates a new challenge for a party or joins an existing one, returning
    /// the challenge's state once the request has been applied.
    /// `None` means the challenge shut down before the request could be processed.
    pub async fn create_or_join_challenge(&self, create: Create) -> Option<Snapshot> {
        let (id, handle) = {
            let key = party_key(create.challenge_type, &create.party);
            let mut registry = self.registry.lock().expect("coordinator lock poisoned");

            if let Some(incumbent) = registry.directory.get(&key) {
                // TODO(frolv): Move this to a lua script
                let live = registry
                    .challenges
                    .get(incumbent)
                    .is_some_and(|h| h.snapshot.borrow().status == ChallengeStatus::InProgress);
                if live {
                    todo!("joining a party's live challenge");
                }
            }

            let uuid = Uuid::new_v4();
            tracing::info!(
                %uuid,
                challenge_type = ?create.challenge_type,
                party = ?create.party,
                stage = ?create.stage,
                user_id = create.user_id.0,
                client_id = create.client_id.0,
                "challenge_created",
            );
            let mut challenge = ActiveChallenge::new(uuid);
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
            (id, handle)
        };

        applied(handle, id).await
    }

    /// Updates the state of an active challenge, returning its new state.
    pub async fn update(&self, uuid: Uuid, update: Update) -> Result<Snapshot, CommandError> {
        tracing::info!(
            %uuid,
            stage = ?update.stage,
            mode = ?update.mode,
            user_id = update.user_id.0,
            client_id = update.client_id.0,
            "challenge_update",
        );
        self.send_command(uuid, Command::Update(update)).await
    }

    /// Marks a challenge as having been completed by a client.
    pub async fn finish(&self, uuid: Uuid, finish: Finish) -> Result<Snapshot, CommandError> {
        tracing::info!(
            %uuid,
            user_id = finish.user_id.0,
            client_id = finish.client_id.0,
            soft = finish.soft,
            times = ?finish.times,
            "challenge_finish",
        );
        let result = self.send_command(uuid, Command::Finish(finish)).await;
        if let Ok(p) = &result {
            tracing::info!(%uuid, status = ?p.status, "challenge_terminated");
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
    use crate::lifecycle::core::types::{ChallengeMode, ClientId, RecordingType, Stage, UserId};

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

    #[tokio::test]
    async fn terminated_challenge_is_superseded() {
        let coordinator = Coordinator::new();

        let first = coordinator
            .create_or_join_challenge(create_request())
            .await
            .expect("first challenge should start");
        coordinator
            .finish(
                first.uuid,
                Finish {
                    user_id: UserId(1),
                    client_id: ClientId(10),
                    session_token: "tok".into(),
                    times: None,
                    soft: true,
                },
            )
            .await
            .expect("finish should apply");

        let second = coordinator
            .create_or_join_challenge(create_request())
            .await
            .expect("second challenge should start");
        assert_ne!(first.uuid, second.uuid);
    }
}

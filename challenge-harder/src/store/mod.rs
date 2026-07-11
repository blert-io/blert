//! Redis storage layer.

use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use futures_util::StreamExt;
use redis::aio::ConnectionManager;
use redis::streams::{StreamReadOptions, StreamReadReply};
use serde::Serialize;
use tokio::sync::mpsc;

use crate::lifecycle::challenge::{
    ChallengeClaim, ChallengeServerUpdate, ChallengeSignal, ChallengeStore, Claim, Rejoin, Start,
    StoreError,
};
use crate::lifecycle::core::command::{Command, Create, Envelope, Join};
use crate::lifecycle::core::event::JournalEntry;
use crate::lifecycle::core::state::{ChallengePhase, ChallengeState, Snapshot};
use crate::lifecycle::core::types::{
    ChallengeMode, ChallengeStatus, ChallengeType, ClientId, Epoch, MsgId, Stage, StageExt, Uuid,
};
use crate::players::normalize_rsn;

mod scripts;
use scripts::{
    ANNOUNCE_SCRIPT, APPEND_SCRIPT, CLAIM_SCRIPT, CLIENT_SEND_SCRIPT, DELETE_SCRIPT,
    PROJECT_SCRIPT, REJOIN_SCRIPT, RELEASE_SCRIPT, RENEW_SCRIPT, SEND_SCRIPT, START_SCRIPT,
};

#[cfg(test)]
mod tests;

/// Private channel carrying challenge state update signals.
const SIGNAL_CHANNEL: &str = "2c2s:challenge-signal";

/// Delay before reestablishing a failed or dropped store connection.
const RECONNECT_DELAY: Duration = Duration::from_secs(1);

/// Longest an inbox read blocks before being re-issued.
const INBOX_BLOCK_TIMEOUT: Duration = Duration::from_secs(5);

/// How long an inbox read may go unanswered before its connection is deemed
/// dead. Must exceed the block timeout, which holds reads unanswered by design.
const INBOX_RESPONSE_TIMEOUT: Duration = INBOX_BLOCK_TIMEOUT.saturating_mul(2);

/// Channel for public challenge lifecycle broadcasts.
const CHALLENGE_UPDATES_CHANNEL: &str = "challenge-updates";

fn journal_key(uuid: Uuid) -> String {
    format!("2c2s:journal:{uuid}")
}

/// Prefix of every challenge inbox stream key.
const INBOX_KEY_PREFIX: &str = "2c2s:inbox:";

/// Stream of commands sent to a challenge.
fn inbox_key(uuid: Uuid) -> String {
    format!("{INBOX_KEY_PREFIX}{uuid}")
}

/// Prefix of every challenge lease hash key.
const LEASE_KEY_PREFIX: &str = "2c2s:lease:";

/// Fence and ownership record of a challenge's lease.
fn lease_key(uuid: Uuid) -> String {
    format!("{LEASE_KEY_PREFIX}{uuid}")
}

/// Prefix of every challenge's projected state key.
/// Matches `challengesKey` in `//common/db/redis.ts`.
const CHALLENGE_KEY_PREFIX: &str = "challenge:";

/// The challenge's projected state.
fn challenge_key(uuid: Uuid) -> String {
    format!("{CHALLENGE_KEY_PREFIX}{uuid}")
}

/// Which challenge a party is recording.
fn directory_key(party: &str) -> String {
    format!("2c2s:directory:{party}")
}

/// Which challenge a client is recording.
fn client_key(client: ClientId) -> String {
    format!("2c2s:client:{client}")
}

/// Which challenge an OSRS player is in.
/// Matches `activePlayerKey` in `//common/db/redis.ts`.
fn player_key(name: &str) -> String {
    format!("player:{}", normalize_rsn(name))
}

/// Unique identity for a party running a particular challenge type.
/// Matches `challengePartyKey` in `//common/db/redis.ts`.
fn party_key(challenge_type: ChallengeType, party: &[String]) -> String {
    let mut names: Vec<String> = party.iter().map(|name| normalize_rsn(name)).collect();
    names.sort_unstable();
    format!("{}-{}", challenge_type as i32, names.join("-"))
}

/// Set of the keys of a challenge's stage event streams.
/// Matches `challengeStreamsSetKey` in `//common/db/redis.ts`.
fn streams_set_key(uuid: Uuid) -> String {
    format!("challenge-streams:{uuid}")
}

/// How long a deleted challenge's journal and inbox are retained for
/// inspection before expiring.
const DELETED_STREAM_RETENTION: Duration = Duration::from_hours(24);

/// How long a deleted challenge's state hash remains readable, covering
/// response waiters that race the deletion.
const DELETED_STATE_RETENTION: Duration = Duration::from_mins(1);

/// Existence index of every challenge between creation and finalization,
/// as a sorted set scored by lease deadline as a Unix millisecond timestamp.
/// A future score is owned, a past score is claimable.
const LEASES_KEY: &str = "2c2s:leases";

/// How long a lease grant lasts before the challenge becomes claimable.
const LEASE_TTL: Duration = Duration::from_secs(30);

/// The current unix time, in milliseconds.
fn unix_millis() -> u64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("please share your time travel secrets with support@blert.io");
    u64::try_from(now.as_millis()).expect("timestamp fits in u64")
}

/// The lease deadline for a grant issued now, in unix milliseconds.
fn lease_deadline() -> u64 {
    unix_millis() + u64::try_from(LEASE_TTL.as_millis()).expect("deadline fits in u64")
}

/// Formats a set of stages as a comma wrapped string for Lua matching.
fn stage_set(stages: &[Stage]) -> String {
    if stages.is_empty() {
        return String::new();
    }
    let mut set = String::from(",");
    for stage in stages {
        set.push_str(&(*stage as i32).to_string());
        set.push(',');
    }
    set
}

/// A `challenge-updates` message, matching `ChallengeServerUpdate` in
/// `//common/db/redis.ts`.
#[derive(Serialize)]
#[serde(tag = "action")]
enum UpdateMessage {
    #[serde(rename = "FINISH")]
    Finish { id: Uuid },
}

/// Cloneable handle to the Redis storage layer.
#[derive(Clone)]
pub struct Store {
    /// Name under which this instance claims challenges.
    identity: String,
    client: redis::Client,
    connection: ConnectionManager,
}

impl Store {
    /// Connects to the Redis instance at `uri`. `identity` uniquely represents
    /// this instance and must be stable across restarts.
    pub async fn connect(uri: &str, identity: String) -> redis::RedisResult<Self> {
        let client = redis::Client::open(uri)?;
        let connection = client.get_connection_manager().await?;
        Ok(Store {
            identity,
            client,
            connection,
        })
    }

    /// A write handle to challenge `uuid`'s state under `epoch`.
    fn redis_claim(&self, uuid: Uuid, epoch: Epoch) -> RedisClaim {
        RedisClaim {
            uuid,
            journal_key: journal_key(uuid),
            lease_key: lease_key(uuid),
            challenge_key: challenge_key(uuid),
            epoch,
            client: self.client.clone(),
            connection: self.connection.clone(),
        }
    }
}

/// Parses a challenge's projected state hash back into a snapshot.
fn parse_snapshot(uuid: Uuid, hash: &HashMap<String, String>) -> Result<Snapshot, String> {
    fn field<'a>(hash: &'a HashMap<String, String>, name: &str) -> Result<&'a str, String> {
        hash.get(name)
            .map(String::as_str)
            .ok_or_else(|| format!("missing field {name}"))
    }

    fn int(hash: &HashMap<String, String>, name: &str) -> Result<i32, String> {
        field(hash, name)?
            .parse()
            .map_err(|e| format!("invalid {name}: {e}"))
    }

    let attempt = field(hash, "stageAttempt")?;
    let party = field(hash, "party")?;
    let tag = field(hash, "phase")?;
    let phase = ChallengePhase::from_tag(tag).ok_or_else(|| format!("invalid phase: {tag}"))?;
    let status: ChallengeStatus =
        serde_json::from_str(field(hash, "status")?).map_err(|e| format!("invalid status: {e}"))?;

    Ok(Snapshot {
        uuid,
        challenge_type: ChallengeType::try_from(int(hash, "type")?)
            .map_err(|e| format!("invalid type: {e}"))?,
        mode: ChallengeMode::try_from(int(hash, "mode")?)
            .map_err(|e| format!("invalid mode: {e}"))?,
        stage: Stage::try_from(int(hash, "stage")?).map_err(|e| format!("invalid stage: {e}"))?,
        stage_attempt: if attempt.is_empty() {
            None
        } else {
            Some(
                attempt
                    .parse()
                    .map_err(|e| format!("invalid stageAttempt: {e}"))?,
            )
        },
        party: if party.is_empty() {
            Vec::new()
        } else {
            party.split(',').map(String::from).collect()
        },
        phase,
        status,
        cursor: field(hash, "cursor")?
            .parse()
            .map_err(|e| format!("invalid cursor: {e}"))?,
    })
}

#[async_trait]
impl ChallengeStore for Store {
    async fn claim_unowned(
        &self,
        batch_size: usize,
        exclude: &[Uuid],
    ) -> Result<Vec<Claim>, StoreError> {
        let mut connection = self.connection.clone();

        let mut invocation = CLAIM_SCRIPT.prepare_invoke();
        invocation
            .key(LEASES_KEY)
            .arg(&self.identity)
            .arg(unix_millis())
            .arg(lease_deadline())
            .arg(batch_size);
        for uuid in exclude {
            invocation.arg(uuid.to_string());
        }

        let claimed: Vec<(String, u64)> = invocation
            .invoke_async(&mut connection)
            .await
            .map_err(|e| StoreError::Unavailable(e.to_string()))?;

        claimed
            .into_iter()
            .map(|(uuid, epoch)| {
                let uuid: Uuid = uuid.parse().map_err(|_| {
                    StoreError::Unavailable(format!("invalid claimed uuid: {uuid}"))
                })?;
                Ok(Claim::new(
                    uuid,
                    Box::new(self.redis_claim(uuid, Epoch(epoch))),
                ))
            })
            .collect()
    }

    async fn start(&self, create: Create) -> Result<Start, StoreError> {
        let uuid = Uuid::new_v4();
        let party = party_key(create.challenge_type, &create.party);
        let mut connection = self.connection.clone();

        let mut invocation = START_SCRIPT.prepare_invoke();
        invocation
            .key(directory_key(&party))
            .key(LEASES_KEY)
            .key(lease_key(uuid))
            .key(client_key(create.client_id))
            .key(inbox_key(uuid));
        for key in create.party.iter().map(|name| player_key(name)) {
            invocation.key(key);
        }

        let later_stages = stage_set(&create.stage.later_stages());

        let join_payload =
            serde_json::to_string(&Command::Join(Join::from(&create))).expect("command serializes");
        let create_payload =
            serde_json::to_string(&Command::Create(create)).expect("command serializes");

        invocation
            .arg(uuid.to_string())
            .arg(&self.identity)
            .arg(lease_deadline())
            .arg(create_payload)
            .arg(join_payload)
            .arg(later_stages);
        let outcome: Vec<String> = invocation
            .invoke_async(&mut connection)
            .await
            .map_err(|e| StoreError::Unavailable(e.to_string()))?;

        let invalid = || StoreError::Unavailable(format!("invalid start outcome: {outcome:?}"));
        match outcome.as_slice() {
            [action, id] if action == "CREATE" => Ok(Start::Created {
                claim: Claim::new(uuid, Box::new(self.redis_claim(uuid, Epoch::INITIAL))),
                id: id.parse().map_err(|_| invalid())?,
            }),
            [action, incumbent, id] if action == "JOIN" => Ok(Start::Joined {
                uuid: incumbent.parse().map_err(|_| invalid())?,
                id: id.parse().map_err(|_| invalid())?,
            }),
            _ => Err(invalid()),
        }
    }

    async fn rejoin(&self, uuid: Uuid, join: &Join) -> Result<Rejoin, StoreError> {
        let payload =
            serde_json::to_string(&Command::Join(join.clone())).expect("command serializes");
        let mut connection = self.connection.clone();

        let mut invocation = REJOIN_SCRIPT.prepare_invoke();
        invocation
            .key(LEASES_KEY)
            .key(challenge_key(uuid))
            .key(client_key(join.client_id))
            .key(inbox_key(uuid))
            .arg(uuid.to_string())
            .arg(payload);
        let outcome: Vec<String> = invocation
            .invoke_async(&mut connection)
            .await
            .map_err(|e| StoreError::Unavailable(e.to_string()))?;

        let invalid = || StoreError::Unavailable(format!("invalid rejoin outcome: {outcome:?}"));
        match outcome.as_slice() {
            [tag, id] if tag == "OK" => Ok(Rejoin::Queued(id.parse().map_err(|_| invalid())?)),
            [tag] if tag == "UNKNOWN" => Ok(Rejoin::UnknownChallenge),
            [tag] if tag == "ELSEWHERE" => Ok(Rejoin::AlreadyInChallenge),
            _ => Err(invalid()),
        }
    }

    async fn send(&self, uuid: Uuid, cmd: &Command) -> Result<Option<MsgId>, StoreError> {
        let payload = serde_json::to_string(cmd).expect("command serializes");
        let mut connection = self.connection.clone();

        let mut invocation = SEND_SCRIPT.prepare_invoke();
        invocation
            .key(LEASES_KEY)
            .key(inbox_key(uuid))
            .arg(uuid.to_string())
            .arg(payload);
        let id: Option<String> = invocation
            .invoke_async(&mut connection)
            .await
            .map_err(|e| StoreError::Unavailable(e.to_string()))?;
        id.map(|id| {
            id.parse()
                .map_err(|error| StoreError::Unavailable(format!("invalid entry id: {error}")))
        })
        .transpose()
    }

    async fn send_to_current_challenge(
        &self,
        client: ClientId,
        cmd: &Command,
    ) -> Result<Option<(Uuid, MsgId)>, StoreError> {
        let payload = serde_json::to_string(cmd).expect("command serializes");
        let mut connection = self.connection.clone();

        let mut invocation = CLIENT_SEND_SCRIPT.prepare_invoke();
        invocation.key(client_key(client)).arg(payload);
        let outcome: Option<Vec<String>> = invocation
            .invoke_async(&mut connection)
            .await
            .map_err(|e| StoreError::Unavailable(e.to_string()))?;

        let Some(outcome) = outcome else {
            return Ok(None);
        };
        let invalid = || StoreError::Unavailable(format!("invalid send outcome: {outcome:?}"));
        match outcome.as_slice() {
            [uuid, id] => Ok(Some((
                uuid.parse().map_err(|_| invalid())?,
                id.parse().map_err(|_| invalid())?,
            ))),
            _ => Err(invalid()),
        }
    }

    async fn read(&self, uuid: Uuid) -> Result<Option<Snapshot>, StoreError> {
        let mut connection = self.connection.clone();
        let hash: HashMap<String, String> =
            redis::AsyncCommands::hgetall(&mut connection, challenge_key(uuid))
                .await
                .map_err(|e| StoreError::Unavailable(e.to_string()))?;
        if hash.is_empty() {
            return Ok(None);
        }
        parse_snapshot(uuid, &hash)
            .map(Some)
            .map_err(StoreError::Unavailable)
    }

    fn subscribe(&self, sink: mpsc::Sender<ChallengeSignal>) {
        let client = self.client.clone();

        tokio::spawn(async move {
            while !sink.is_closed() {
                let mut pubsub = match client.get_async_pubsub().await {
                    Ok(pubsub) => pubsub,
                    Err(error) => {
                        tracing::warn!(%error, "signal_subscribe_failed");
                        tokio::time::sleep(RECONNECT_DELAY).await;
                        continue;
                    }
                };

                if let Err(error) = pubsub.subscribe(SIGNAL_CHANNEL).await {
                    tracing::warn!(%error, "signal_subscribe_failed");
                    tokio::time::sleep(RECONNECT_DELAY).await;
                    continue;
                }

                let mut messages = pubsub.on_message();
                while let Some(message) = messages.next().await {
                    let Ok(payload) = message.get_payload::<String>() else {
                        continue;
                    };
                    match serde_json::from_str::<ChallengeSignal>(&payload) {
                        Ok(signal) => {
                            if sink.send(signal).await.is_err() {
                                return;
                            }
                        }
                        Err(error) => tracing::warn!(%error, "signal_parse_failed"),
                    }
                }

                // The connection dropped; missed signals are recovered by
                // subscribers' direct reads.
                tracing::warn!("signal_stream_ended");
                tokio::time::sleep(RECONNECT_DELAY).await;
            }
        });
    }
}

/// An exclusive handle to a challenge's Redis state.
struct RedisClaim {
    uuid: Uuid,
    journal_key: String,
    lease_key: String,
    challenge_key: String,
    epoch: Epoch,
    client: redis::Client,
    connection: ConnectionManager,
}

#[async_trait]
impl ChallengeClaim for RedisClaim {
    async fn load(&self) -> Result<Vec<JournalEntry>, StoreError> {
        let mut connection = self.connection.clone();
        let batches: Vec<(String, Vec<(String, String)>)> = redis::cmd("XRANGE")
            .arg(&self.journal_key)
            .arg("-")
            .arg("+")
            .query_async(&mut connection)
            .await
            .map_err(|e| StoreError::Unavailable(e.to_string()))?;

        let mut entries = Vec::new();
        for (id, fields) in batches {
            let batch = fields
                .iter()
                .find(|(name, _)| name == "batch")
                .map(|(_, value)| value)
                .ok_or_else(|| StoreError::Corrupt(format!("journal entry {id} has no batch")))?;
            let batch: Vec<JournalEntry> = serde_json::from_str(batch).map_err(|error| {
                StoreError::Corrupt(format!("invalid journal batch {id}: {error}"))
            })?;
            entries.extend(batch);
        }
        Ok(entries)
    }

    fn follow(&self, from: MsgId, sink: mpsc::Sender<Envelope>) {
        tokio::spawn(follow_inbox(self.client.clone(), self.uuid, from, sink));
    }

    async fn append(&self, batch: &[JournalEntry]) -> Result<(), StoreError> {
        let payload = serde_json::to_string(batch).expect("journal entries serialize");
        let mut connection = self.connection.clone();

        let mut invocation = APPEND_SCRIPT.prepare_invoke();
        invocation
            .key(&self.lease_key)
            .key(&self.journal_key)
            .arg(self.epoch.0)
            .arg(payload);

        let accepted: i64 = invocation
            .invoke_async(&mut connection)
            .await
            .map_err(|e| StoreError::Unavailable(e.to_string()))?;
        if accepted == 1 {
            Ok(())
        } else {
            Err(StoreError::Fenced)
        }
    }

    async fn project(&self, snapshot: &Snapshot) -> Result<(), StoreError> {
        let signal = serde_json::to_string(&ChallengeSignal::Updated {
            uuid: snapshot.uuid,
            cursor: snapshot.cursor,
        })
        .expect("signal serializes");
        // The hash contract encodes a null stageAttempt as an empty string.
        let attempt = snapshot
            .stage_attempt
            .map_or_else(String::new, |attempt| attempt.to_string());
        let mut connection = self.connection.clone();

        let mut invocation = PROJECT_SCRIPT.prepare_invoke();
        invocation
            .key(&self.challenge_key)
            .key(&self.lease_key)
            .arg(self.epoch.0)
            .arg(signal)
            .arg("type")
            .arg(snapshot.challenge_type as i32)
            .arg("mode")
            .arg(snapshot.mode as i32)
            .arg("status")
            .arg(snapshot.status as u8)
            .arg("stage")
            .arg(snapshot.stage as i32)
            .arg("stageAttempt")
            .arg(attempt)
            .arg("party")
            .arg(snapshot.party.join(","))
            .arg("phase")
            .arg(snapshot.phase.tag())
            .arg("cursor")
            .arg(snapshot.cursor.to_string());

        let accepted: i64 = invocation
            .invoke_async(&mut connection)
            .await
            .map_err(|e| StoreError::Unavailable(e.to_string()))?;
        if accepted == 1 {
            Ok(())
        } else {
            Err(StoreError::Fenced)
        }
    }

    async fn announce(&self, update: &ChallengeServerUpdate) -> Result<(), StoreError> {
        let message = match update {
            ChallengeServerUpdate::Finish => UpdateMessage::Finish { id: self.uuid },
        };
        let payload = serde_json::to_string(&message).expect("update serializes");
        let mut connection = self.connection.clone();

        let mut invocation = ANNOUNCE_SCRIPT.prepare_invoke();
        invocation
            .key(&self.lease_key)
            .arg(self.epoch.0)
            .arg(payload);

        let accepted: i64 = invocation
            .invoke_async(&mut connection)
            .await
            .map_err(|e| StoreError::Unavailable(e.to_string()))?;
        if accepted == 1 {
            Ok(())
        } else {
            Err(StoreError::Fenced)
        }
    }

    async fn renew(&self) -> Result<(), StoreError> {
        let mut connection = self.connection.clone();

        let mut invocation = RENEW_SCRIPT.prepare_invoke();
        invocation
            .key(&self.lease_key)
            .key(LEASES_KEY)
            .arg(self.epoch.0)
            .arg(self.uuid.to_string())
            .arg(lease_deadline());

        let renewed: i64 = invocation
            .invoke_async(&mut connection)
            .await
            .map_err(|e| StoreError::Unavailable(e.to_string()))?;
        if renewed == 1 {
            Ok(())
        } else {
            Err(StoreError::Fenced)
        }
    }

    async fn release(&self) -> Result<(), StoreError> {
        let mut connection = self.connection.clone();

        let mut invocation = RELEASE_SCRIPT.prepare_invoke();
        invocation
            .key(&self.lease_key)
            .key(LEASES_KEY)
            .arg(self.epoch.0)
            .arg(self.uuid.to_string());

        let released: i64 = invocation
            .invoke_async(&mut connection)
            .await
            .map_err(|e| StoreError::Unavailable(e.to_string()))?;
        if released == 1 {
            Ok(())
        } else {
            Err(StoreError::Fenced)
        }
    }

    async fn delete(&self, state: &ChallengeState) -> Result<(), StoreError> {
        let signal = serde_json::to_string(&ChallengeSignal::Deleted { uuid: self.uuid })
            .expect("signal serializes");
        let mut connection = self.connection.clone();

        let mut invocation = DELETE_SCRIPT.prepare_invoke();
        invocation
            .key(&self.lease_key)
            .key(LEASES_KEY)
            .key(&self.challenge_key)
            .key(&self.journal_key)
            .key(inbox_key(self.uuid))
            .key(streams_set_key(self.uuid))
            .key(directory_key(&party_key(
                state.challenge_type,
                &state.party,
            )));
        for client in &state.recorded_by {
            invocation.key(client_key(*client));
        }
        for name in &state.party {
            invocation.key(player_key(name));
        }
        invocation
            .arg(self.epoch.0)
            .arg(self.uuid.to_string())
            .arg(signal)
            .arg(DELETED_STREAM_RETENTION.as_secs())
            .arg(DELETED_STATE_RETENTION.as_secs());

        let deleted: i64 = invocation
            .invoke_async(&mut connection)
            .await
            .map_err(|e| StoreError::Unavailable(e.to_string()))?;
        if deleted == 1 {
            Ok(())
        } else {
            Err(StoreError::Fenced)
        }
    }
}

/// Feeds a challenge's inbox entries into `sink` until it closes.
async fn follow_inbox(
    client: redis::Client,
    uuid: Uuid,
    from: MsgId,
    sink: mpsc::Sender<Envelope>,
) {
    let key = inbox_key(uuid);
    let options = StreamReadOptions::default()
        .block(usize::try_from(INBOX_BLOCK_TIMEOUT.as_millis()).expect("timeout fits in usize"));
    let mut position = from;
    loop {
        let config =
            redis::AsyncConnectionConfig::new().set_response_timeout(Some(INBOX_RESPONSE_TIMEOUT));
        let mut connection = match client
            .get_multiplexed_async_connection_with_config(&config)
            .await
        {
            Ok(connection) => connection,
            Err(error) => {
                tracing::warn!(%uuid, %error, "inbox_connect_failed");
                tokio::time::sleep(RECONNECT_DELAY).await;
                continue;
            }
        };

        loop {
            let streams = [&key];
            let positions = [position.to_string()];
            let read = redis::AsyncCommands::xread_options(
                &mut connection,
                &streams,
                &positions,
                &options,
            );
            let reply: redis::RedisResult<Option<StreamReadReply>> = tokio::select! {
                () = sink.closed() => return,
                reply = read => reply,
            };

            let keys = match reply {
                Ok(reply) => reply.map(|reply| reply.keys).unwrap_or_default(),
                Err(error) => {
                    tracing::warn!(%uuid, %error, "inbox_read_failed");
                    tokio::time::sleep(RECONNECT_DELAY).await;
                    break;
                }
            };

            for entry in keys.into_iter().flat_map(|key| key.ids) {
                let id: MsgId = entry
                    .id
                    .parse()
                    .expect("message ids are parseable from redis");
                position = id;
                let payload = entry.get::<String>("cmd");
                if let Some(Ok(cmd)) =
                    payload.map(|payload| serde_json::from_str::<Command>(&payload))
                {
                    if sink.send(Envelope { id, cmd }).await.is_err() {
                        return;
                    }
                } else {
                    tracing::warn!(%uuid, %id, "invalid_inbox_entry");
                }
            }
        }
    }
}

use std::collections::HashMap;

use blert::{ChallengeMode, ClientId, Rsn, Stage, proto};
use redis::{FromRedisValue, Pipeline, Value};
use serde::Deserialize;
use serde_repr::Deserialize_repr;
use tokio::sync::mpsc;

/// Status of a recorded challenge.
// Matches `ChallengeStatus` in `//common/challenge.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum ChallengeStatus {
    InProgress = 0,
    Completed = 1,
    Reset = 2,
    Wiped = 3,
    Abandoned = 4,
}

impl TryFrom<i32> for ChallengeStatus {
    type Error = String;

    fn try_from(value: i32) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::InProgress),
            1 => Ok(Self::Completed),
            2 => Ok(Self::Reset),
            3 => Ok(Self::Wiped),
            4 => Ok(Self::Abandoned),
            _ => Err(format!("invalid challenge status: {value}")),
        }
    }
}

/// Stage status as reported by each client.
// Matches `StageStatus` in `//common/challenge.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize_repr)]
#[repr(i32)]
pub enum StageStatus {
    Entered = 0,
    Started = 1,
    Completed = 2,
    Wiped = 3,
}

/// Type of client's recording.
// Matches `RecordingType` in `//common/user.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize_repr)]
#[repr(i32)]
pub enum RecordingType {
    Spectator = 0,
    Participant = 1,
}

fn challenge_key(uuid: &str) -> String {
    format!("challenge:{uuid}")
}

fn challenge_clients_key(uuid: &str) -> String {
    format!("challenge:{uuid}:clients")
}

fn stage_stream_key(uuid: &str, stage: Stage, attempt: Option<u32>) -> String {
    let stage = stage as i32;
    match attempt {
        Some(a) => format!("challenge-events:{uuid}:{stage}:{a}"),
        None => format!("challenge-events:{uuid}:{stage}"),
    }
}

const CHALLENGE_UPDATES_PUBSUB_KEY: &str = "challenge-updates";

/// Subset of challenge hash fields needed by the live-server.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ChallengeState {
    pub status: ChallengeStatus,
    pub challenge_type: proto::Challenge,
    pub mode: ChallengeMode,
    pub stage: Stage,
    pub stage_attempt: Option<u32>,
    pub party: Vec<Rsn>,
}

/// Fields requested in the `HMGET` for `ChallengeState`.
const CHALLENGE_FIELDS: &[&str] = &["status", "type", "mode", "stage", "stageAttempt", "party"];

impl ChallengeState {
    fn from_hmget(values: &[Option<String>]) -> Result<Self, RedisQueryError> {
        if values.len() != CHALLENGE_FIELDS.len() {
            return Err(RedisQueryError::Parse(format!(
                "expected {} values, got {}",
                CHALLENGE_FIELDS.len(),
                values.len(),
            )));
        }

        let status: i32 = values[0]
            .as_deref()
            .ok_or_else(|| RedisQueryError::MissingField("status"))?
            .parse()
            .map_err(|_| RedisQueryError::Parse("invalid status".into()))?;
        let status = ChallengeStatus::try_from(status).map_err(RedisQueryError::Parse)?;

        let challenge_type: i32 = values[1]
            .as_deref()
            .ok_or_else(|| RedisQueryError::MissingField("type"))?
            .parse()
            .map_err(|_| RedisQueryError::Parse("invalid type".into()))?;
        let challenge_type = proto::Challenge::try_from(challenge_type)
            .map_err(|_| RedisQueryError::Parse(format!("unknown type: {challenge_type}")))?;

        let mode: i32 = values[2]
            .as_deref()
            .ok_or_else(|| RedisQueryError::MissingField("mode"))?
            .parse()
            .map_err(|_| RedisQueryError::Parse("invalid mode".into()))?;
        let mode = ChallengeMode::try_from(mode)
            .map_err(|_| RedisQueryError::Parse(format!("unknown mode: {mode}")))?;

        let stage: i32 = values[3]
            .as_deref()
            .ok_or_else(|| RedisQueryError::MissingField("stage"))?
            .parse()
            .map_err(|_| RedisQueryError::Parse("invalid stage".into()))?;
        let stage = Stage::try_from(stage)
            .map_err(|_| RedisQueryError::Parse(format!("unknown stage: {stage}")))?;

        let stage_attempt: Option<u32> = values[4]
            .as_deref()
            .map(|s| {
                s.parse()
                    .map_err(|_| RedisQueryError::Parse("invalid stageAttempt".into()))
            })
            .transpose()?;

        let party = values[5]
            .as_deref()
            .ok_or_else(|| RedisQueryError::MissingField("party"))?
            .split(',')
            .map(|name| {
                Rsn::try_from(name)
                    .map_err(|_| RedisQueryError::Parse(format!("invalid party member: {name}")))
            })
            .collect::<Result<Vec<_>, _>>()?;

        Ok(Self {
            status,
            challenge_type,
            mode,
            stage,
            stage_attempt,
            party,
        })
    }
}

/// A connected client recording a challenge.
// Matches `ChallengeClient` in `//common/challenge-server/redis-client.ts`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ChallengeClient {
    pub user_id: u64,
    pub client_id: ClientId,
    #[serde(rename = "type")]
    pub recording_type: RecordingType,
    pub active: bool,
    pub stage: Stage,
    pub stage_attempt: Option<u32>,
    pub stage_status: StageStatus,
    pub last_completed: LastCompleted,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastCompleted {
    pub stage: Stage,
    pub attempt: Option<u32>,
}

/// A single event batch from a stage event stream.
#[derive(Debug, Clone)]
pub struct StageStreamEntry {
    /// Redis stream ID, used as cursor for subsequent reads.
    pub id: String,
    /// Client that produced these events.
    pub client_id: ClientId,
    /// Raw protobuf bytes (serialized `ChallengeEvents`).
    pub events: Vec<u8>,
}

pub const STREAM_START_CURSOR: &str = "0-0";

/// Update published on the `challenge-updates` pubsub channel.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "action", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ChallengeServerUpdate {
    Finish {
        id: String,
    },
    StageEnd {
        id: String,
        stage: Stage,
        attempt: Option<u32>,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum RedisQueryError {
    #[error("redis error: {0}")]
    Redis(#[from] redis::RedisError),
    #[error("redis parse error: {0}")]
    RedisParse(#[from] redis::ParsingError),
    #[error("pool error: {0}")]
    Pool(#[from] deadpool_redis::PoolError),
    #[error("missing field: {0}")]
    MissingField(&'static str),
    #[error("parse error: {0}")]
    Parse(String),
}

/// A Redis query for challenge data that can be executed as part of a pipeline.
#[derive(Debug, Clone)]
pub enum RedisQuery {
    /// Returns the state of an active challenge.
    ChallengeState { uuid: String },
    /// Returns the clients connected to a challenge.
    ChallengeClients { uuid: String },
    /// Returns the events for a given stage of a challenge.
    StageStream {
        uuid: String,
        stage: Stage,
        attempt: Option<u32>,
        cursor: String,
    },
}

/// The parsed result of a `RedisQuery`.
#[derive(Debug)]
pub enum RedisResponse {
    ChallengeState(Option<ChallengeState>),
    ChallengeClients(HashMap<ClientId, ChallengeClient>),
    StageStream(Vec<StageStreamEntry>),
    /// The query's reply could not be parsed.
    Malformed(RedisQueryError),
}

impl RedisQuery {
    /// Appends the command(s) for this query to a Redis pipeline.
    fn add_to_pipeline(&self, pipe: &mut Pipeline) {
        match self {
            RedisQuery::ChallengeState { uuid } => {
                let key = challenge_key(uuid);
                pipe.cmd("HMGET").arg(&key).arg(CHALLENGE_FIELDS);
            }
            RedisQuery::ChallengeClients { uuid } => {
                let key = challenge_clients_key(uuid);
                pipe.cmd("HGETALL").arg(&key);
            }
            RedisQuery::StageStream {
                uuid,
                stage,
                attempt,
                cursor,
            } => {
                let key = stage_stream_key(uuid, *stage, *attempt);
                // Use "(" prefix for exclusive range start.
                let from = format!("({cursor}");
                pipe.cmd("XRANGE").arg(&key).arg(&from).arg("+");
            }
        }
    }

    /// Parses a raw Redis `Value` into the corresponding `RedisResponse`.
    fn parse_response(&self, value: Value) -> Result<RedisResponse, RedisQueryError> {
        match self {
            RedisQuery::ChallengeState { .. } => {
                let values: Vec<Option<String>> = FromRedisValue::from_redis_value(value)?;
                // If all values are None, the key doesn't exist.
                if values.iter().all(Option::is_none) {
                    return Ok(RedisResponse::ChallengeState(None));
                }
                let fields = ChallengeState::from_hmget(&values)?;
                Ok(RedisResponse::ChallengeState(Some(fields)))
            }
            RedisQuery::ChallengeClients { .. } => {
                let pairs: Vec<(String, String)> = FromRedisValue::from_redis_value(value)?;
                let mut clients = HashMap::new();
                for (id_str, json) in pairs {
                    let client_id = id_str.parse().map(ClientId).map_err(|_| {
                        RedisQueryError::Parse(format!("invalid client id: {id_str}"))
                    })?;
                    let client: ChallengeClient = serde_json::from_str(&json)
                        .map_err(|e| RedisQueryError::Parse(format!("invalid client JSON: {e}")))?;
                    clients.insert(client_id, client);
                }
                Ok(RedisResponse::ChallengeClients(clients))
            }
            RedisQuery::StageStream { .. } => {
                let entries = parse_stage_stream_response(value)?;
                Ok(RedisResponse::StageStream(entries))
            }
        }
    }
}

/// Parses an `XRANGE` response into `StageStreamEntry` values, filtering out
/// `STAGE_END` entries (type 1) and keeping only `STAGE_EVENTS` (type 0).
fn parse_stage_stream_response(value: Value) -> Result<Vec<StageStreamEntry>, RedisQueryError> {
    // XRANGE returns an array of [id, [field, value, field, value, ...]]
    let entries: Vec<Value> = FromRedisValue::from_redis_value(value)?;
    let mut result = Vec::new();

    'entry: for entry in entries {
        let (id, fields): (String, Vec<Value>) = FromRedisValue::from_redis_value(entry)?;

        let mut iter = fields.into_iter();
        let mut client_id: Option<ClientId> = None;
        let mut events: Option<Vec<u8>> = None;

        while let (Some(k), Some(v)) = (iter.next(), iter.next()) {
            let key: String = FromRedisValue::from_redis_value(k)?;
            match key.as_str() {
                "type" => {
                    let type_val: i32 = FromRedisValue::from_redis_value(v)?;
                    if type_val != 0 {
                        continue 'entry;
                    }
                }
                "clientId" => {
                    let id: Option<u32> = FromRedisValue::from_redis_value(v)
                        .map_err(|_| RedisQueryError::Parse("invalid client id".into()))?;
                    client_id = id.map(ClientId);
                }
                "events" => {
                    events = FromRedisValue::from_redis_value(v)
                        .map_err(|_| RedisQueryError::Parse("invalid events".into()))?;
                }
                _ => {}
            }
        }

        if let (Some(client_id), Some(events)) = (client_id, events) {
            result.push(StageStreamEntry {
                id,
                client_id,
                events,
            });
        }
    }

    Ok(result)
}

/// Gets a Redis connection from a pool, retrying once if it fails to
/// immediately correct a broken pipe.
pub async fn get_conn(
    pool: &deadpool_redis::Pool,
) -> Result<deadpool_redis::Connection, deadpool_redis::PoolError> {
    match pool.get().await {
        Ok(conn) => Ok(conn),
        Err(_) => pool.get().await,
    }
}

/// Execute queries using a pooled connection. Retries once if the
/// connection cannot be obtained (via [`get_conn`]).
pub async fn pool_execute(
    pool: &deadpool_redis::Pool,
    queries: &[RedisQuery],
) -> Result<Vec<RedisResponse>, RedisQueryError> {
    let mut conn = get_conn(pool).await?;
    execute(&mut conn, queries).await
}

/// Pings Redis to check connectivity.
pub async fn ping(conn: &mut impl redis::aio::ConnectionLike) -> bool {
    redis::cmd("PING").query_async::<String>(conn).await.is_ok()
}

/// Execute a batch of queries in a single pipelined Redis round-trip.
pub async fn execute(
    conn: &mut impl redis::aio::ConnectionLike,
    queries: &[RedisQuery],
) -> Result<Vec<RedisResponse>, RedisQueryError> {
    if queries.is_empty() {
        return Ok(Vec::new());
    }

    let mut pipe = redis::pipe();
    for query in queries {
        query.add_to_pipeline(&mut pipe);
    }

    let values: Vec<Value> = pipe.query_async(conn).await?;
    Ok(parse_responses(queries, values))
}

/// Individually parses replies for a batch of queries.
fn parse_responses(queries: &[RedisQuery], values: Vec<Value>) -> Vec<RedisResponse> {
    queries
        .iter()
        .zip(values)
        .map(|(query, value)| {
            query
                .parse_response(value)
                .unwrap_or_else(RedisResponse::Malformed)
        })
        .collect()
}

/// Subscribes to the `challenge-updates` pubsub channel and spawns a task
/// that forwards parsed updates to the returned receiver.
pub async fn subscribe_challenge_updates(
    client: &redis::Client,
) -> Result<mpsc::UnboundedReceiver<ChallengeServerUpdate>, RedisQueryError> {
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.subscribe(CHALLENGE_UPDATES_PUBSUB_KEY).await?;

    let (tx, rx) = mpsc::unbounded_channel();

    tokio::spawn(async move {
        use tokio_stream::StreamExt as _;
        let mut stream = pubsub.into_on_message();
        while let Some(msg) = stream.next().await {
            let payload: String = match msg.get_payload() {
                Ok(p) => p,
                Err(e) => {
                    tracing::warn!("invalid pubsub payload: {e}");
                    continue;
                }
            };
            match serde_json::from_str::<ChallengeServerUpdate>(&payload) {
                Ok(update) => {
                    if tx.send(update).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    tracing::warn!("invalid challenge update JSON: {e}");
                }
            }
        }
        tracing::info!("challenge updates subscription ended");
    });

    Ok(rx)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_challenge_key() {
        assert_eq!(challenge_key("abc-123"), "challenge:abc-123");
    }

    #[test]
    fn test_challenge_clients_key() {
        assert_eq!(
            challenge_clients_key("abc-123"),
            "challenge:abc-123:clients",
        );
    }

    #[test]
    fn test_stage_stream_key() {
        assert_eq!(
            stage_stream_key("abc-123", Stage::TobMaiden, None),
            "challenge-events:abc-123:10",
        );
        assert_eq!(
            stage_stream_key("abc-123", Stage::TobMaiden, Some(2)),
            "challenge-events:abc-123:10:2",
        );
    }

    #[test]
    fn test_challenge_fields_from_hmget() {
        let values = vec![
            Some("0".to_string()),  // status: IN_PROGRESS
            Some("1".to_string()),  // type: TOB
            Some("11".to_string()), // mode: TOB_REGULAR
            Some("10".to_string()), // stage: TOB_MAIDEN
            None,                   // stageAttempt: null
            Some("player1,player2".to_string()),
        ];
        let fields = ChallengeState::from_hmget(&values).unwrap();
        assert_eq!(fields.status, ChallengeStatus::InProgress);
        assert_eq!(fields.challenge_type, proto::Challenge::Tob);
        assert_eq!(fields.mode, ChallengeMode::TobRegular);
        assert_eq!(fields.stage, Stage::TobMaiden);
        assert_eq!(fields.stage_attempt, None);
        assert_eq!(fields.party, vec!["player1", "player2"]);
    }

    #[test]
    fn test_challenge_fields_with_attempt() {
        let values = vec![
            Some("0".to_string()),
            Some("1".to_string()),
            Some("11".to_string()),
            Some("10".to_string()),
            Some("3".to_string()), // stageAttempt: 3
            Some("player1".to_string()),
        ];
        let fields = ChallengeState::from_hmget(&values).unwrap();
        assert_eq!(fields.status, ChallengeStatus::InProgress);
        assert_eq!(fields.challenge_type, proto::Challenge::Tob);
        assert_eq!(fields.mode, ChallengeMode::TobRegular);
        assert_eq!(fields.stage, Stage::TobMaiden);
        assert_eq!(fields.stage_attempt, Some(3));
        assert_eq!(fields.party, vec!["player1"]);
    }

    #[test]
    fn test_challenge_fields_missing_status() {
        let values = vec![
            None,
            Some("1".into()),
            Some("0".into()),
            Some("10".into()),
            None,
            Some("p".into()),
        ];
        assert!(ChallengeState::from_hmget(&values).is_err());
    }

    #[test]
    fn test_challenge_fields_all_none() {
        let values: Vec<Option<String>> = vec![None, None, None, None, None, None];
        assert!(ChallengeState::from_hmget(&values).is_err());
    }

    #[test]
    fn test_challenge_fields_unknown_stage() {
        let values = vec![
            Some("0".into()),
            Some("1".into()),
            Some("11".into()),
            Some("9".into()),
            None,
            Some("1Ogp".into()),
        ];
        assert!(matches!(
            ChallengeState::from_hmget(&values),
            Err(RedisQueryError::Parse(message)) if message == "unknown stage: 9"
        ));
    }

    #[test]
    fn test_challenge_fields_invalid_party_member() {
        let values = vec![
            Some("0".into()),
            Some("1".into()),
            Some("12".into()),
            Some("12".into()),
            None,
            Some("1Ogp,WWWWWWWWWWQQQ".into()),
        ];
        assert!(matches!(
            ChallengeState::from_hmget(&values),
            Err(RedisQueryError::Parse(message))
                if message == "invalid party member: WWWWWWWWWWQQQ"
        ));
    }

    #[test]
    fn test_challenge_client_deserialize() {
        let json = r#"{
            "userId": 123,
            "clientId": 42,
            "type": 1,
            "active": true,
            "stage": 10,
            "stageAttempt": null,
            "stageStatus": 1,
            "lastCompleted": { "stage": 0, "attempt": null }
        }"#;
        let client: ChallengeClient = serde_json::from_str(json).unwrap();
        assert_eq!(client.user_id, 123);
        assert_eq!(client.client_id, ClientId(42));
        assert_eq!(client.recording_type, RecordingType::Participant);
        assert!(client.active);
        assert_eq!(client.stage, Stage::TobMaiden);
        assert_eq!(client.stage_attempt, None);
        assert_eq!(client.stage_status, StageStatus::Started);
        assert_eq!(client.last_completed.stage, Stage::UnknownStage);
        assert_eq!(client.last_completed.attempt, None);
    }

    #[test]
    fn test_challenge_client_with_attempt() {
        let json = r#"{
            "userId": 1,
            "clientId": 5,
            "type": 0,
            "active": false,
            "stage": 11,
            "stageAttempt": 2,
            "stageStatus": 2,
            "lastCompleted": { "stage": 10, "attempt": 1 }
        }"#;
        let client: ChallengeClient = serde_json::from_str(json).unwrap();
        assert_eq!(client.recording_type, RecordingType::Spectator);
        assert!(!client.active);
        assert_eq!(client.stage_attempt, Some(2));
        assert_eq!(client.last_completed.stage, Stage::TobMaiden);
        assert_eq!(client.last_completed.attempt, Some(1));
    }

    // --- parse_response tests ---

    fn bulk(s: &str) -> Value {
        Value::BulkString(s.as_bytes().to_vec())
    }

    #[test]
    fn test_parse_challenge_state() {
        let query = RedisQuery::ChallengeState {
            uuid: "test".into(),
        };
        let value = Value::Array(vec![
            bulk("1"),   // status: Completed
            bulk("2"),   // type: COL
            bulk("0"),   // mode
            bulk("103"), // stage
            Value::Nil,  // stageAttempt
            bulk("715"), // party
        ]);
        let resp = query.parse_response(value).unwrap();
        match resp {
            RedisResponse::ChallengeState(Some(state)) => {
                assert_eq!(state.status, ChallengeStatus::Completed);
                assert_eq!(state.challenge_type, proto::Challenge::Cox);
                assert_eq!(state.mode, ChallengeMode::NoMode);
                assert_eq!(state.stage, Stage::ColosseumWave4);
                assert_eq!(state.stage_attempt, None);
                assert_eq!(state.party, vec!["715"]);
            }
            other => panic!("expected ChallengeState(Some), got {other:?}"),
        }
    }

    #[test]
    fn test_parse_challenge_state_nonexistent() {
        let query = RedisQuery::ChallengeState {
            uuid: "missing".into(),
        };
        let value = Value::Array(vec![
            Value::Nil,
            Value::Nil,
            Value::Nil,
            Value::Nil,
            Value::Nil,
            Value::Nil,
        ]);
        let resp = query.parse_response(value).unwrap();
        match resp {
            RedisResponse::ChallengeState(None) => {}
            other => panic!("expected ChallengeState(None), got {other:?}"),
        }
    }

    #[test]
    fn test_parse_challenge_clients() {
        let query = RedisQuery::ChallengeClients {
            uuid: "test".into(),
        };
        let client_json = r#"{"userId":10,"clientId":42,"type":1,"active":true,"stage":10,"stageAttempt":null,"stageStatus":1,"lastCompleted":{"stage":0,"attempt":null}}"#;
        let value = Value::Array(vec![bulk("42"), bulk(client_json)]);
        let resp = query.parse_response(value).unwrap();
        match resp {
            RedisResponse::ChallengeClients(clients) => {
                assert_eq!(clients.len(), 1);
                let client = clients.get(&ClientId(42)).unwrap();
                assert_eq!(client.user_id, 10);
                assert_eq!(client.recording_type, RecordingType::Participant);
                assert!(client.active);
            }
            other => panic!("expected ChallengeClients, got {other:?}"),
        }
    }

    #[test]
    fn test_parse_challenge_clients_empty() {
        let query = RedisQuery::ChallengeClients {
            uuid: "test".into(),
        };
        let value = Value::Array(vec![]);
        let resp = query.parse_response(value).unwrap();
        match resp {
            RedisResponse::ChallengeClients(clients) => assert!(clients.is_empty()),
            other => panic!("expected ChallengeClients, got {other:?}"),
        }
    }

    fn stream_entry(id: &str, fields: &[(&str, &[u8])]) -> Value {
        let mut field_values = Vec::new();
        for (k, v) in fields {
            field_values.push(bulk(k));
            field_values.push(Value::BulkString(v.to_vec()));
        }
        Value::Array(vec![bulk(id), Value::Array(field_values)])
    }

    #[test]
    fn test_parse_stage_stream() {
        let query = RedisQuery::StageStream {
            uuid: "test".into(),
            stage: Stage::TobMaiden,
            attempt: None,
            cursor: STREAM_START_CURSOR.into(),
        };
        let event_bytes = vec![0x08, 0x01, 0x10, 0x02];
        let value = Value::Array(vec![stream_entry(
            "1234-0",
            &[
                ("type", b"0"),
                ("clientId", b"42"),
                ("events", &event_bytes),
            ],
        )]);
        let resp = query.parse_response(value).unwrap();
        match resp {
            RedisResponse::StageStream(entries) => {
                assert_eq!(entries.len(), 1);
                assert_eq!(entries[0].id, "1234-0");
                assert_eq!(entries[0].client_id, ClientId(42));
                assert_eq!(entries[0].events, event_bytes);
            }
            other => panic!("expected StageStream, got {other:?}"),
        }
    }

    #[test]
    fn test_parse_stage_stream_filters_stage_end() {
        let query = RedisQuery::StageStream {
            uuid: "test".into(),
            stage: Stage::TobMaiden,
            attempt: None,
            cursor: STREAM_START_CURSOR.into(),
        };
        let value = Value::Array(vec![
            // STAGE_EVENTS entry (type=0) — should be kept.
            stream_entry(
                "100-0",
                &[("type", b"0"), ("clientId", b"1"), ("events", b"\x08\x01")],
            ),
            // STAGE_END entry (type=1) — should be filtered out.
            stream_entry("200-0", &[("type", b"1"), ("clientId", b"1")]),
            // Another STAGE_EVENTS entry.
            stream_entry(
                "300-0",
                &[("type", b"0"), ("clientId", b"2"), ("events", b"\x08\x02")],
            ),
        ]);
        let resp = query.parse_response(value).unwrap();
        match resp {
            RedisResponse::StageStream(entries) => {
                assert_eq!(entries.len(), 2);
                assert_eq!(entries[0].id, "100-0");
                assert_eq!(entries[0].client_id, ClientId(1));
                assert_eq!(entries[1].id, "300-0");
                assert_eq!(entries[1].client_id, ClientId(2));
            }
            other => panic!("expected StageStream, got {other:?}"),
        }
    }

    #[test]
    fn test_parse_stage_stream_empty() {
        let query = RedisQuery::StageStream {
            uuid: "test".into(),
            stage: Stage::TobMaiden,
            attempt: Some(1),
            cursor: STREAM_START_CURSOR.into(),
        };
        let value = Value::Array(vec![]);
        let resp = query.parse_response(value).unwrap();
        match resp {
            RedisResponse::StageStream(entries) => assert!(entries.is_empty()),
            other => panic!("expected StageStream, got {other:?}"),
        }
    }

    #[test]
    fn test_parse_responses_validates_each_separately() {
        let queries = [
            RedisQuery::ChallengeState {
                uuid: "first".into(),
            },
            RedisQuery::ChallengeClients {
                uuid: "second".into(),
            },
            RedisQuery::StageStream {
                uuid: "third".into(),
                stage: Stage::TobSotetseg,
                attempt: None,
                cursor: STREAM_START_CURSOR.into(),
            },
        ];
        let values = vec![
            Value::Array(vec![
                bulk("0"),  // status: IN_PROGRESS
                bulk("1"),  // type: TOB
                bulk("12"), // mode: TOB_HARD
                bulk("11"), // stage: TOB_BLOAT
                Value::Nil, // stageAttempt
                bulk("1Ogp,WWWWWWWWWWQQ"),
            ]),
            Value::Array(vec![bulk("7"), bulk("{\"userId\":")]),
            Value::Array(vec![stream_entry(
                "500-0",
                &[("type", b"0"), ("clientId", b"9"), ("events", b"\x08\x03")],
            )]),
        ];

        let responses = parse_responses(&queries, values);

        assert_eq!(responses.len(), 3);
        match &responses[0] {
            RedisResponse::ChallengeState(Some(state)) => {
                assert_eq!(state.status, ChallengeStatus::InProgress);
                assert_eq!(state.challenge_type, proto::Challenge::Tob);
                assert_eq!(state.mode, ChallengeMode::TobHard);
                assert_eq!(state.stage, Stage::TobBloat);
                assert_eq!(state.stage_attempt, None);
                assert_eq!(state.party, vec!["1Ogp", "WWWWWWWWWWQQ"]);
            }
            other => panic!("expected ChallengeState(Some), got {other:?}"),
        }
        match &responses[1] {
            RedisResponse::Malformed(RedisQueryError::Parse(message)) => {
                assert!(message.starts_with("invalid client JSON"));
            }
            other => panic!("expected Malformed, got {other:?}"),
        }
        match &responses[2] {
            RedisResponse::StageStream(entries) => {
                assert_eq!(entries.len(), 1);
                assert_eq!(entries[0].id, "500-0");
                assert_eq!(entries[0].client_id, ClientId(9));
                assert_eq!(entries[0].events, b"\x08\x03");
            }
            other => panic!("expected StageStream, got {other:?}"),
        }
    }
}

//! Parser for captured socket server command traffic.

use std::collections::BTreeMap;
use std::fmt;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;

use crate::lifecycle::core::types::{ChallengeType, ClientId, UserId};

/// The kind of control command a capture record holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureOp {
    Start,
    Join,
    Update,
    Finish,
    Status,
    ServerUpdate,
}

impl fmt::Display for CaptureOp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            CaptureOp::Start => "start",
            CaptureOp::Join => "join",
            CaptureOp::Update => "update",
            CaptureOp::Finish => "finish",
            CaptureOp::Status => "status",
            CaptureOp::ServerUpdate => "server-update",
        })
    }
}

/// The original challenge-server's response to a captured request.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CaptureHttp {
    pub ok: bool,
    pub status_code: u16,
    pub response: Value,
}

/// A captured control command.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CaptureRecord {
    /// Capture timestamp in epoch milliseconds.
    pub ts: u64,
    pub op: CaptureOp,
    pub host: String,
    pub challenge_uuid: Option<Uuid>,
    pub client_id: Option<ClientId>,
    pub user_id: Option<UserId>,
    /// Opaque request body or event payload.
    pub request: Value,
    // Response to HTTP-based commands.
    pub http: Option<CaptureHttp>,
}

/// Failure to read a capture file.
#[derive(Debug, Error)]
pub enum ParseError {
    #[error("failed to read {}", path.display())]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("{}:{line} is not a capture record", path.display())]
    Parse {
        path: PathBuf,
        line: usize,
        #[source]
        source: serde_json::Error,
    },
}

/// A full capture window.
#[derive(Debug)]
pub struct Capture {
    pub path: PathBuf,
    pub records: Vec<CaptureRecord>,
}

impl Capture {
    /// Reads an NDJSON capture file from `path`.
    pub fn load(path: &Path) -> Result<Capture, ParseError> {
        let file = File::open(path).map_err(|source| ParseError::Io {
            path: path.to_owned(),
            source,
        })?;
        Capture::parse(path, BufReader::new(file))
    }

    fn parse(path: &Path, reader: impl BufRead) -> Result<Capture, ParseError> {
        let mut records = Vec::new();
        for (index, line) in reader.lines().enumerate() {
            let line = line.map_err(|source| ParseError::Io {
                path: path.to_owned(),
                source,
            })?;
            if line.is_empty() {
                continue;
            }
            let record = serde_json::from_str(&line).map_err(|source| ParseError::Parse {
                path: path.to_owned(),
                line: index + 1,
                source,
            })?;
            records.push(record);
        }
        Ok(Capture {
            path: path.to_owned(),
            records,
        })
    }

    /// The capture file's name for display.
    #[must_use]
    pub fn name(&self) -> String {
        self.path.file_name().map_or_else(
            || self.path.display().to_string(),
            |name| name.to_string_lossy().into_owned(),
        )
    }
}

/// Aggregate counts over capture records.
#[derive(Debug, PartialEq)]
pub struct Census {
    pub records: usize,
    pub ops: BTreeMap<CaptureOp, usize>,
    /// Number of distinct challenges recorded.
    pub challenges: usize,
    pub by_type: BTreeMap<ChallengeType, usize>,
    /// Records captured per instance.
    pub hosts: BTreeMap<String, usize>,
    /// Distinct `FINISH` broadcasts on the server-update channel.
    pub finish_announces: usize,
    /// Distinct `STAGE_END` broadcasts on the server-update channel.
    pub stage_end_announces: usize,
    /// Largest timestamp spread across a broadcast message's cross-host copies.
    pub announce_spread_ms: Option<u64>,
    /// Extent from first to last record in stream order, in milliseconds.
    pub span_ms: u64,
}

/// Identity of a `server-update` broadcast.
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
struct AnnouncementKey {
    action: Option<String>,
    id: Option<String>,
    stage: Option<i64>,
    attempt: Option<i64>,
}

impl AnnouncementKey {
    fn of(request: &Value) -> AnnouncementKey {
        AnnouncementKey {
            action: request
                .get("action")
                .and_then(Value::as_str)
                .map(str::to_owned),
            id: request.get("id").and_then(Value::as_str).map(str::to_owned),
            stage: request.get("stage").and_then(Value::as_i64),
            attempt: request.get("attempt").and_then(Value::as_i64),
        }
    }
}

/// Splits one announcement payload's records into distinct broadcasts,
/// returning their count and the widest timestamp spread among them.
fn broadcasts(copies: &mut [(String, u64)]) -> (usize, Option<u64>) {
    copies.sort_unstable_by_key(|&(_, ts)| ts);

    let mut distinct = 0;
    let mut spread = None;
    let mut cluster: Vec<&str> = Vec::new();
    let mut start_ts = 0;
    let mut prev_ts = 0;

    for (host, ts) in copies.iter() {
        if cluster.is_empty() || cluster.contains(&host.as_str()) {
            if cluster.len() > 1 {
                spread = spread.max(Some(prev_ts - start_ts));
            }
            cluster.clear();
            distinct += 1;
            start_ts = *ts;
        }
        cluster.push(host.as_str());
        prev_ts = *ts;
    }
    if cluster.len() > 1 {
        spread = spread.max(Some(prev_ts - start_ts));
    }

    (distinct, spread)
}

impl Census {
    #[must_use]
    pub fn of(records: &[CaptureRecord]) -> Census {
        let mut ops = BTreeMap::new();
        let mut hosts = BTreeMap::new();
        let mut challenge_types: BTreeMap<Uuid, Option<ChallengeType>> = BTreeMap::new();
        let mut announcements: BTreeMap<AnnouncementKey, Vec<(String, u64)>> = BTreeMap::new();

        for record in records {
            *ops.entry(record.op).or_insert(0) += 1;
            *hosts.entry(record.host.clone()).or_insert(0) += 1;

            if record.op == CaptureOp::ServerUpdate {
                announcements
                    .entry(AnnouncementKey::of(&record.request))
                    .or_default()
                    .push((record.host.clone(), record.ts));
            }

            let Some(uuid) = record.challenge_uuid else {
                continue;
            };
            let entry = challenge_types.entry(uuid).or_default();
            if record.op == CaptureOp::Start && entry.is_none() {
                *entry = record
                    .request
                    .get("type")
                    .and_then(Value::as_i64)
                    .and_then(|t| i32::try_from(t).ok())
                    .and_then(|t| ChallengeType::try_from(t).ok());
            }
        }

        let mut by_type = BTreeMap::new();
        for challenge_type in challenge_types.values().flatten() {
            *by_type.entry(*challenge_type).or_insert(0) += 1;
        }

        let mut finish_announces = 0;
        let mut stage_end_announces = 0;
        let mut announce_spread_ms = None;
        for (key, copies) in &mut announcements {
            let (distinct, spread) = broadcasts(copies);
            match key.action.as_deref() {
                Some("FINISH") => finish_announces += distinct,
                Some("STAGE_END") => stage_end_announces += distinct,
                _ => {}
            }
            announce_spread_ms = announce_spread_ms.max(spread);
        }

        let span_ms = match (records.first(), records.last()) {
            (Some(first), Some(last)) => last.ts.saturating_sub(first.ts),
            _ => 0,
        };

        Census {
            records: records.len(),
            ops,
            challenges: challenge_types.len(),
            by_type,
            hosts,
            finish_announces,
            stage_end_announces,
            announce_spread_ms,
            span_ms,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const TOB_UUID: &str = "11111111-1111-1111-1111-111111111111";

    fn tob_capture() -> &'static str {
        concat!(
            r#"{"ts":1000,"op":"start","host":"sock-a","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":10,"userId":20,"request":{"type":1,"party":["Skitter"]},"http":{"ok":true,"statusCode":200,"response":{"uuid":"11111111-1111-1111-1111-111111111111"}}}"#,
            "\n",
            r#"{"ts":1500,"op":"update","host":"sock-a","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":10,"userId":20,"request":{"update":{"stage":12}},"http":{"ok":true,"statusCode":200,"response":null}}"#,
            "\n",
            r#"{"ts":1400,"op":"status","host":"sock-a","challengeUuid":null,"clientId":11,"userId":21,"request":{"status":1},"http":null}"#,
            "\n",
            r#"{"ts":2000,"op":"join","host":"sock-a","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":11,"userId":21,"request":{"recordingType":1},"http":{"ok":true,"statusCode":200,"response":{"uuid":"11111111-1111-1111-1111-111111111111"}}}"#,
            "\n",
            r#"{"ts":2500,"op":"finish","host":"sock-a","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":10,"userId":20,"request":{"soft":true},"http":{"ok":true,"statusCode":200,"response":null}}"#,
            "\n",
            r#"{"ts":2800,"op":"server-update","host":"sock-a","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":null,"userId":null,"request":{"id":"11111111-1111-1111-1111-111111111111","action":"STAGE_END"},"http":null}"#,
            "\n",
            r#"{"ts":3000,"op":"server-update","host":"sock-a","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":null,"userId":null,"request":{"id":"11111111-1111-1111-1111-111111111111","action":"FINISH"},"http":null}"#,
            "\n",
        )
    }

    fn parse(input: &str) -> Result<Capture, ParseError> {
        Capture::parse(Path::new("test.jsonl"), input.as_bytes())
    }

    #[test]
    fn parses_every_op_kind() {
        let uuid: Uuid = TOB_UUID.parse().unwrap();
        let capture = parse(tob_capture()).expect("capture parses");
        assert_eq!(
            capture.records,
            vec![
                CaptureRecord {
                    ts: 1000,
                    op: CaptureOp::Start,
                    host: "sock-a".into(),
                    challenge_uuid: Some(uuid),
                    client_id: Some(ClientId(10)),
                    user_id: Some(UserId(20)),
                    request: json!({"type": 1, "party": ["Skitter"]}),
                    http: Some(CaptureHttp {
                        ok: true,
                        status_code: 200,
                        response: json!({"uuid": TOB_UUID}),
                    }),
                },
                CaptureRecord {
                    ts: 1500,
                    op: CaptureOp::Update,
                    host: "sock-a".into(),
                    challenge_uuid: Some(uuid),
                    client_id: Some(ClientId(10)),
                    user_id: Some(UserId(20)),
                    request: json!({"update": {"stage": 12}}),
                    http: Some(CaptureHttp {
                        ok: true,
                        status_code: 200,
                        response: Value::Null,
                    }),
                },
                CaptureRecord {
                    ts: 1400,
                    op: CaptureOp::Status,
                    host: "sock-a".into(),
                    challenge_uuid: None,
                    client_id: Some(ClientId(11)),
                    user_id: Some(UserId(21)),
                    request: json!({"status": 1}),
                    http: None,
                },
                CaptureRecord {
                    ts: 2000,
                    op: CaptureOp::Join,
                    host: "sock-a".into(),
                    challenge_uuid: Some(uuid),
                    client_id: Some(ClientId(11)),
                    user_id: Some(UserId(21)),
                    request: json!({"recordingType": 1}),
                    http: Some(CaptureHttp {
                        ok: true,
                        status_code: 200,
                        response: json!({"uuid": TOB_UUID}),
                    }),
                },
                CaptureRecord {
                    ts: 2500,
                    op: CaptureOp::Finish,
                    host: "sock-a".into(),
                    challenge_uuid: Some(uuid),
                    client_id: Some(ClientId(10)),
                    user_id: Some(UserId(20)),
                    request: json!({"soft": true}),
                    http: Some(CaptureHttp {
                        ok: true,
                        status_code: 200,
                        response: Value::Null,
                    }),
                },
                CaptureRecord {
                    ts: 2800,
                    op: CaptureOp::ServerUpdate,
                    host: "sock-a".into(),
                    challenge_uuid: Some(uuid),
                    client_id: None,
                    user_id: None,
                    request: json!({"id": TOB_UUID, "action": "STAGE_END"}),
                    http: None,
                },
                CaptureRecord {
                    ts: 3000,
                    op: CaptureOp::ServerUpdate,
                    host: "sock-a".into(),
                    challenge_uuid: Some(uuid),
                    client_id: None,
                    user_id: None,
                    request: json!({"id": TOB_UUID, "action": "FINISH"}),
                    http: None,
                },
            ],
        );
    }

    #[test]
    fn unknown_envelope_field_is_rejected() {
        let input = concat!(
            r#"{"ts":1,"op":"status","host":"sock-a","challengeUuid":null,"clientId":1,"userId":1,"request":{},"http":null}"#,
            "\n",
            r#"{"ts":2,"op":"status","host":"sock-a","challengeUuid":null,"clientId":1,"userId":1,"request":{},"http":null,"extra":true}"#,
            "\n",
        );
        match parse(input) {
            Err(ParseError::Parse { line, .. }) => assert_eq!(line, 2),
            other => panic!("expected a parse error, got {other:?}"),
        }
    }

    #[test]
    fn census_of_a_complete_challenge() {
        let capture = parse(tob_capture()).unwrap();
        assert_eq!(
            Census::of(&capture.records),
            Census {
                records: 7,
                ops: [
                    (CaptureOp::Start, 1),
                    (CaptureOp::Join, 1),
                    (CaptureOp::Update, 1),
                    (CaptureOp::Finish, 1),
                    (CaptureOp::Status, 1),
                    (CaptureOp::ServerUpdate, 2),
                ]
                .into_iter()
                .collect(),
                challenges: 1,
                by_type: [(ChallengeType::Tob, 1)].into_iter().collect(),
                hosts: [("sock-a".to_owned(), 7)].into_iter().collect(),
                finish_announces: 1,
                stage_end_announces: 1,
                announce_spread_ms: None,
                span_ms: 2000,
            },
        );
    }

    #[test]
    fn census_of_a_multi_host_capture() {
        // A single-client challenge whose announcements are captured by two
        // hosts. The stage 10 records write their payload fields in different
        // orders, the stage 11 payload recurs and is heard twice by both hosts,
        // and every cross-host copy pair carries a small timestamp spread.
        let capture = parse(concat!(
            r#"{"ts":1000,"op":"start","host":"sock-a","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":10,"userId":20,"request":{"type":1,"party":["Skitter"]},"http":{"ok":true,"statusCode":200,"response":{"uuid":"11111111-1111-1111-1111-111111111111"}}}"#,
            "\n",
            r#"{"ts":5000,"op":"server-update","host":"sock-a","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":null,"userId":null,"request":{"id":"11111111-1111-1111-1111-111111111111","action":"STAGE_END","stage":10,"attempt":null},"http":null}"#,
            "\n",
            r#"{"ts":5004,"op":"server-update","host":"sock-b","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":null,"userId":null,"request":{"stage":10,"attempt":null,"action":"STAGE_END","id":"11111111-1111-1111-1111-111111111111"},"http":null}"#,
            "\n",
            r#"{"ts":12000,"op":"server-update","host":"sock-a","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":null,"userId":null,"request":{"id":"11111111-1111-1111-1111-111111111111","action":"STAGE_END","stage":11,"attempt":1},"http":null}"#,
            "\n",
            r#"{"ts":12002,"op":"server-update","host":"sock-b","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":null,"userId":null,"request":{"id":"11111111-1111-1111-1111-111111111111","action":"STAGE_END","stage":11,"attempt":1},"http":null}"#,
            "\n",
            r#"{"ts":47000,"op":"server-update","host":"sock-a","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":null,"userId":null,"request":{"id":"11111111-1111-1111-1111-111111111111","action":"STAGE_END","stage":11,"attempt":1},"http":null}"#,
            "\n",
            r#"{"ts":47007,"op":"server-update","host":"sock-b","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":null,"userId":null,"request":{"id":"11111111-1111-1111-1111-111111111111","action":"STAGE_END","stage":11,"attempt":1},"http":null}"#,
            "\n",
            r#"{"ts":120000,"op":"server-update","host":"sock-a","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":null,"userId":null,"request":{"id":"11111111-1111-1111-1111-111111111111","action":"FINISH"},"http":null}"#,
            "\n",
            r#"{"ts":120008,"op":"server-update","host":"sock-b","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":null,"userId":null,"request":{"action":"FINISH","id":"11111111-1111-1111-1111-111111111111"},"http":null}"#,
            "\n",
        ))
        .unwrap();
        assert_eq!(
            Census::of(&capture.records),
            Census {
                records: 9,
                ops: [(CaptureOp::Start, 1), (CaptureOp::ServerUpdate, 8)]
                    .into_iter()
                    .collect(),
                challenges: 1,
                by_type: [(ChallengeType::Tob, 1)].into_iter().collect(),
                hosts: [("sock-a".to_owned(), 5), ("sock-b".to_owned(), 4)]
                    .into_iter()
                    .collect(),
                finish_announces: 1,
                stage_end_announces: 3,
                announce_spread_ms: Some(8),
                span_ms: 119_008,
            },
        );
    }

    #[test]
    fn distant_copies_count_once_and_widen_the_spread() {
        let capture = parse(concat!(
            r#"{"ts":1000,"op":"server-update","host":"sock-a","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":null,"userId":null,"request":{"id":"11111111-1111-1111-1111-111111111111","action":"FINISH"},"http":null}"#,
            "\n",
            r#"{"ts":36000,"op":"server-update","host":"sock-b","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":null,"userId":null,"request":{"id":"11111111-1111-1111-1111-111111111111","action":"FINISH"},"http":null}"#,
            "\n",
        ))
        .unwrap();
        let census = Census::of(&capture.records);
        assert_eq!(census.finish_announces, 1);
        assert_eq!(census.announce_spread_ms, Some(35_000));
    }
}

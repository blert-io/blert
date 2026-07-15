//! Run output artifact schemas.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;

use super::capture::CaptureOp;
use super::remap::Mapping;
use super::replay::{Announcement, Event};
use crate::lifecycle::core::types::ClientId;

/// Failure to read a run directory.
#[derive(Debug, Error)]
pub enum ArtifactError {
    #[error("failed to read {}", path.display())]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("{}:{line} is not a run artifact", path.display())]
    Parse {
        path: PathBuf,
        line: usize,
        #[source]
        source: serde_json::Error,
    },
}

/// One line of `commands.jsonl`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CommandLine {
    Sent(SentLine),
    Unmapped(UnmappedLine),
}

/// A command sent to the server under test, with its outcome.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SentLine {
    pub index: usize,
    pub op: CaptureOp,
    pub client: ClientId,
    pub challenge: Option<Uuid>,
    pub scheduled_ms: f64,
    pub sent_ms: f64,
    pub latency_ms: f64,
    pub status: u16,
    pub response: Value,
    pub mapping: Option<MappingLine>,
}

/// A command skipped because its challenge was never mapped.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct UnmappedLine {
    pub index: usize,
    pub op: CaptureOp,
    pub client: ClientId,
    pub challenge: Uuid,
    pub unmapped: bool, // discriminator; always `true`
}

/// A challenge remap outcome.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MappingLine {
    New,
    Match,
    Mismatch(Uuid),
}

impl From<Mapping> for MappingLine {
    fn from(mapping: Mapping) -> MappingLine {
        match mapping {
            Mapping::New => MappingLine::New,
            Mapping::Match => MappingLine::Match,
            Mapping::Mismatch { existing } => MappingLine::Mismatch(existing),
        }
    }
}

impl From<&Event> for CommandLine {
    fn from(event: &Event) -> CommandLine {
        match event {
            Event::CommandSent {
                index,
                op,
                client,
                captured,
                scheduled,
                sent,
                latency,
                status,
                response,
                mapping,
            } => CommandLine::Sent(SentLine {
                index: *index,
                op: *op,
                client: *client,
                challenge: *captured,
                scheduled_ms: scheduled.as_secs_f64() * 1000.0,
                sent_ms: sent.as_secs_f64() * 1000.0,
                latency_ms: latency.as_secs_f64() * 1000.0,
                status: *status,
                response: response.clone(),
                mapping: mapping.map(MappingLine::from),
            }),
            Event::CommandUnmapped {
                index,
                op,
                client,
                captured,
            } => CommandLine::Unmapped(UnmappedLine {
                index: *index,
                op: *op,
                client: *client,
                challenge: *captured,
                unmapped: true,
            }),
        }
    }
}

/// One line of `pubsub.jsonl`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AnnouncementLine {
    pub offset_ms: f64,
    pub payload: Value,
}

impl From<&Announcement> for AnnouncementLine {
    fn from(announcement: &Announcement) -> AnnouncementLine {
        AnnouncementLine {
            offset_ms: announcement.offset.as_secs_f64() * 1000.0,
            payload: announcement.payload.clone(),
        }
    }
}

/// Schema for `summary.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RunSummary {
    pub capture_file: String,
    pub records: usize,
    pub challenges: usize,
    pub commands: usize,
    pub incomplete: Vec<Uuid>,
    pub time_scale: u32,
    pub server_exit: String,
    pub graceful_shutdown: bool,
}

/// A replay run's parsed output artifacts as read from the run directory.
#[derive(Debug)]
pub struct RunDir {
    pub commands: Vec<CommandLine>,
    pub announcements: Vec<AnnouncementLine>,
    pub remap: BTreeMap<Uuid, Uuid>,
    pub summary: RunSummary,
}

impl RunDir {
    pub fn load(dir: &Path) -> Result<RunDir, ArtifactError> {
        Ok(RunDir {
            commands: read_lines(&dir.join("commands.jsonl"))?,
            announcements: read_lines(&dir.join("pubsub.jsonl"))?,
            remap: read_json(&dir.join("remap.json"))?,
            summary: read_json(&dir.join("summary.json"))?,
        })
    }
}

fn read_lines<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<Vec<T>, ArtifactError> {
    let file = File::open(path).map_err(|source| ArtifactError::Io {
        path: path.to_owned(),
        source,
    })?;

    let mut lines = Vec::new();
    for (index, line) in BufReader::new(file).lines().enumerate() {
        let line = line.map_err(|source| ArtifactError::Io {
            path: path.to_owned(),
            source,
        })?;
        if line.is_empty() {
            continue;
        }
        lines.push(
            serde_json::from_str(&line).map_err(|source| ArtifactError::Parse {
                path: path.to_owned(),
                line: index + 1,
                source,
            })?,
        );
    }
    Ok(lines)
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, ArtifactError> {
    let file = File::open(path).map_err(|source| ArtifactError::Io {
        path: path.to_owned(),
        source,
    })?;
    serde_json::from_reader(BufReader::new(file)).map_err(|source| ArtifactError::Parse {
        path: path.to_owned(),
        line: 0,
        source,
    })
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use serde_json::json;

    use super::*;

    const CAPTURED: &str = "11111111-1111-1111-1111-111111111111";
    const REPLAYED: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

    #[test]
    fn sent_line_round_trips_through_the_wire_format() {
        let event = Event::CommandSent {
            index: 3,
            op: CaptureOp::Start,
            client: ClientId(10),
            captured: Some(CAPTURED.parse().unwrap()),
            scheduled: Duration::from_millis(1500),
            sent: Duration::from_millis(1502),
            latency: Duration::from_millis(2),
            status: 200,
            response: json!({ "uuid": REPLAYED }),
            mapping: Some(Mapping::New),
        };
        let line = CommandLine::from(&event);
        let wire = serde_json::to_string(&line).unwrap();
        assert_eq!(
            wire,
            format!(
                concat!(
                    r#"{{"index":3,"op":"start","client":10,"challenge":"{CAPTURED}","#,
                    r#""scheduledMs":1500.0,"sentMs":1502.0,"latencyMs":2.0,"#,
                    r#""status":200,"response":{{"uuid":"{REPLAYED}"}},"mapping":"new"}}"#,
                ),
                CAPTURED = CAPTURED,
                REPLAYED = REPLAYED,
            ),
        );
        assert_eq!(serde_json::from_str::<CommandLine>(&wire).unwrap(), line);
    }

    #[test]
    fn unmapped_line_round_trips_through_the_wire_format() {
        let event = Event::CommandUnmapped {
            index: 7,
            op: CaptureOp::Finish,
            client: ClientId(11),
            captured: CAPTURED.parse().unwrap(),
        };
        let line = CommandLine::from(&event);
        let wire = serde_json::to_string(&line).unwrap();
        assert_eq!(
            wire,
            format!(
                r#"{{"index":7,"op":"finish","client":11,"challenge":"{CAPTURED}","unmapped":true}}"#,
            ),
        );
        assert_eq!(serde_json::from_str::<CommandLine>(&wire).unwrap(), line);
    }

    #[test]
    fn mismatch_mapping_carries_the_existing_uuid() {
        let mapping = MappingLine::from(Mapping::Mismatch {
            existing: REPLAYED.parse().unwrap(),
        });
        let wire = serde_json::to_string(&mapping).unwrap();
        assert_eq!(wire, format!(r#"{{"mismatch":"{REPLAYED}"}}"#));
        assert_eq!(serde_json::from_str::<MappingLine>(&wire).unwrap(), mapping);
    }

    #[test]
    fn announcement_line_round_trips_through_the_wire_format() {
        let line = AnnouncementLine::from(&Announcement {
            offset: Duration::from_millis(2500),
            payload: json!({ "id": REPLAYED, "action": "FINISH" }),
        });
        let wire = serde_json::to_string(&line).unwrap();
        assert_eq!(
            wire,
            format!(r#"{{"offsetMs":2500.0,"payload":{{"action":"FINISH","id":"{REPLAYED}"}}}}"#),
        );
        assert_eq!(
            serde_json::from_str::<AnnouncementLine>(&wire).unwrap(),
            line,
        );
    }
}

//! Debug merging of captured stage streams.

use std::any::Any;
use std::fs;
use std::io::{self, Write};
use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use bytes::Bytes;
use prost::Message;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::lifecycle::core::types::{
    ChallengeMode, ChallengeType, ClientId, ClientStageStream, Stage, StageStatus, StageUpdate,
    UserId, Uuid,
};
use crate::proto::ChallengeEvents;

use super::Tick;
use super::report::{ClientOutcome, MergeStatus};

/// A stage's captured client streams.
#[derive(Debug)]
pub struct MergeCapture {
    pub uuid: Uuid,
    pub challenge_type: ChallengeType,
    pub mode: ChallengeMode,
    pub party: Vec<String>,
    pub stage: Stage,
    pub attempt: Option<u32>,
    /// Every client's records, in the order they were captured.
    pub records: Vec<ClientStageStream>,
}

#[derive(Debug, Error)]
pub enum CaptureError {
    #[error("failed to read capture: {0}")]
    Read(#[source] std::io::Error),
    #[error("failed to parse capture: {0}")]
    Parse(#[source] serde_json::Error),
    #[error("record {index} has unknown type {tag}")]
    UnknownRecordType { index: usize, tag: u8 },
    #[error("record {index} of type {tag} is missing `{field}`")]
    MissingField {
        index: usize,
        tag: u8,
        field: &'static str,
    },
}

impl MergeCapture {
    /// Reads a capture file.
    pub fn load(path: &Path) -> Result<MergeCapture, CaptureError> {
        let contents = fs::read(path).map_err(CaptureError::Read)?;
        Self::decode(&contents)
    }

    pub fn decode(contents: &[u8]) -> Result<MergeCapture, CaptureError> {
        let file: File<'_> = serde_json::from_slice(contents).map_err(CaptureError::Parse)?;

        let records = file
            .raw_events
            .into_iter()
            .enumerate()
            .map(|(index, record)| record.into_stream(index))
            .collect::<Result<_, _>>()?;

        Ok(MergeCapture {
            uuid: file.challenge_info.uuid,
            challenge_type: file.challenge_info.challenge_type,
            mode: file.challenge_info.mode,
            party: file.challenge_info.party,
            stage: file.stage,
            attempt: file.attempt,
            records,
        })
    }

    /// Serializes the capture as a JSON byte array.
    pub fn encode(&self, capture_reasons: Vec<String>, clients: &[ClientOutcome]) -> Vec<u8> {
        let (merged_clients, unmerged_clients) = clients
            .iter()
            .partition(|client| matches!(client.status, MergeStatus::Merged { .. }));
        let file = File {
            challenge_info: ChallengeInfo {
                uuid: self.uuid,
                challenge_type: self.challenge_type,
                mode: self.mode,
                party: self.party.clone(),
            },
            stage: self.stage,
            attempt: self.attempt,
            capture_reasons,
            merged_clients,
            unmerged_clients,
            raw_events: self.records.iter().map(RawRecord::from).collect(),
        };
        serde_json::to_vec(&file).expect("captures are serializable")
    }
}

/// The saved capture file format.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct File<'a> {
    challenge_info: ChallengeInfo,
    stage: Stage,
    attempt: Option<u32>,
    #[serde(skip_deserializing)]
    capture_reasons: Vec<String>,
    #[serde(skip_deserializing)]
    merged_clients: Vec<&'a ClientOutcome>,
    #[serde(skip_deserializing)]
    unmerged_clients: Vec<&'a ClientOutcome>,
    raw_events: Vec<RawRecord>,
}

#[derive(Serialize, Deserialize)]
struct ChallengeInfo {
    uuid: Uuid,
    #[serde(rename = "type")]
    challenge_type: ChallengeType,
    mode: ChallengeMode,
    party: Vec<String>,
}

/// A stream record in its JSON form, with field presence determined by `tag`.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRecord {
    #[serde(rename = "type")]
    tag: u8,
    client_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    events: Option<Buffer>,
    #[serde(skip_serializing_if = "Option::is_none")]
    update: Option<StageUpdate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    user_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    plugin_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rune_lite_version: Option<String>,
}

/// The serialized form of an event batch.
#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum Buffer {
    /// A nodejs buffer as serialized by `JSON.stringify`.
    Js { data: Vec<u8> },
    /// A bare byte array.
    Raw(Vec<u8>),
}

impl Buffer {
    fn into_bytes(self) -> Bytes {
        match self {
            Buffer::Js { data } | Buffer::Raw(data) => Bytes::from(data),
        }
    }
}

impl RawRecord {
    fn into_stream(self, index: usize) -> Result<ClientStageStream, CaptureError> {
        let tag = self.tag;
        let missing = |field| CaptureError::MissingField { index, tag, field };
        let client_id = ClientId(self.client_id);

        match tag {
            ClientStageStream::EVENTS_TAG => Ok(ClientStageStream::Events {
                client_id,
                events: self.events.ok_or(missing("events"))?.into_bytes(),
            }),
            ClientStageStream::STAGE_END_TAG => Ok(ClientStageStream::End {
                client_id,
                update: self.update.ok_or(missing("update"))?,
            }),
            ClientStageStream::METADATA_TAG => Ok(ClientStageStream::Metadata {
                client_id,
                user_id: UserId(self.user_id.ok_or(missing("userId"))?),
                plugin_version: self.plugin_version.ok_or(missing("pluginVersion"))?,
                runelite_version: self.rune_lite_version.ok_or(missing("runeLiteVersion"))?,
            }),
            tag => Err(CaptureError::UnknownRecordType { index, tag }),
        }
    }
}

impl From<&ClientStageStream> for RawRecord {
    fn from(record: &ClientStageStream) -> Self {
        let empty = RawRecord {
            tag: 0,
            client_id: record.client_id().0,
            events: None,
            update: None,
            user_id: None,
            plugin_version: None,
            rune_lite_version: None,
        };
        match record {
            ClientStageStream::Events { events, .. } => RawRecord {
                tag: ClientStageStream::EVENTS_TAG,
                events: Some(Buffer::Raw(events.to_vec())),
                ..empty
            },
            ClientStageStream::End { update, .. } => RawRecord {
                tag: ClientStageStream::STAGE_END_TAG,
                update: Some(*update),
                ..empty
            },
            ClientStageStream::Metadata {
                user_id,
                plugin_version,
                runelite_version,
                ..
            } => RawRecord {
                tag: ClientStageStream::METADATA_TAG,
                user_id: Some(user_id.0),
                plugin_version: Some(plugin_version.clone()),
                rune_lite_version: Some(runelite_version.clone()),
                ..empty
            },
        }
    }
}

/// Merges capture files, saving their results to disk.
///
/// With an output directory, every capture produces two files named after it,
/// `<name>.events` holding the merged events as proto `ChallengeEvents` and
/// `<name>.json` holding a [`Report`].
/// Without one, only a single capture is accepted. Its report is written to
/// stdout and its events are discarded.
/// A capture that fails to load or merge is reported rather than stopping the
/// run, returning an exit error at the end.
pub fn run(captures: &[PathBuf], out: Option<&Path>, trace: bool) -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "warn".into()),
        )
        .with_writer(io::stderr)
        .init();

    if out.is_none() {
        if captures.len() > 1 {
            eprintln!("an output directory is required to merge more than one capture");
            return ExitCode::FAILURE;
        }
        if trace {
            eprintln!("an output directory is required to write a merge trace");
            return ExitCode::FAILURE;
        }
    }

    let mut failed = 0;
    for path in captures {
        let (report, events, tracer) = merge_capture(path, trace);
        if report.error.is_some() {
            failed += 1;
        }

        let written = if let Some(dir) = out {
            write_outputs(dir, &report, events.as_deref(), tracer.as_ref())
        } else {
            let mut stdout = io::stdout().lock();
            serde_json::to_writer_pretty(&mut stdout, &report)
                .map_err(io::Error::other)
                .and_then(|()| stdout.write_all(b"\n"))
        };
        if let Err(e) = written {
            eprintln!("failed to write output for {}: {e}", path.display());
            return ExitCode::FAILURE;
        }
    }

    eprintln!("merged {} captures, {failed} failed", captures.len());
    if failed == 0 {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    /// The capture file's name.
    file: String,
    /// Absent if the capture failed to load.
    capture: Option<Identity>,
    /// Absent if the merge produced nothing.
    merge: Option<Summary>,
    /// Every client's outcome, in client ID order.
    clients: Vec<ClientOutcome>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Identity {
    uuid: Uuid,
    #[serde(rename = "type")]
    challenge_type: ChallengeType,
    mode: ChallengeMode,
    party: Vec<String>,
    stage: Stage,
    attempt: Option<u32>,
}

/// The merged timeline's container metadata.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Summary {
    status: StageStatus,
    last_tick: Tick,
    missing_tick_count: u32,
    precise_server_tick_count: bool,
    accurate_until: Tick,
    queryable_until: Tick,
}

/// Loads and merges one capture, returning its report and, if the merge
/// succeeds, the serialized events.
fn merge_capture(path: &Path, trace: bool) -> (Report, Option<Vec<u8>>, Option<super::Tracer>) {
    let file = path.file_name().map_or_else(
        || path.display().to_string(),
        |name| name.to_string_lossy().into_owned(),
    );
    let mut report = Report {
        file,
        capture: None,
        merge: None,
        clients: Vec::new(),
        error: None,
    };

    let capture = match MergeCapture::load(path) {
        Ok(capture) => capture,
        Err(e) => {
            report.error = Some(e.to_string());
            return (report, None, None);
        }
    };
    let challenge = super::ChallengeInfo {
        uuid: capture.uuid,
        challenge_type: capture.challenge_type,
        mode: capture.mode,
        party: &capture.party,
    };
    report.capture = Some(Identity {
        uuid: challenge.uuid,
        challenge_type: challenge.challenge_type,
        mode: challenge.mode,
        party: capture.party.clone(),
        stage: capture.stage,
        attempt: capture.attempt,
    });

    let mut tracer = trace.then(super::Tracer::new);
    let merged = panic::catch_unwind(AssertUnwindSafe(|| {
        super::merge(&challenge, capture.stage, &capture.records, tracer.as_mut())
    }));
    let (merged, merge_report) = match merged {
        Ok((merged, merge_report)) => (merged, merge_report),
        Err(payload) => {
            report.error = Some(format!(
                "merge panicked: {}",
                panic_message(payload.as_ref())
            ));
            return (report, None, tracer);
        }
    };

    report.clients = merge_report.clients;
    report.clients.sort_unstable_by_key(|outcome| outcome.id);

    let Some(merged) = merged else {
        report.error = Some("no client data".into());
        return (report, None, tracer);
    };

    report.merge = Some(Summary {
        status: merged.status(),
        last_tick: merged.last_tick(),
        missing_tick_count: merged.missing_tick_count(),
        precise_server_tick_count: merged.has_precise_server_tick_count(),
        accurate_until: merged.accurate_until(),
        queryable_until: merged.queryable_until(),
    });
    let events = ChallengeEvents {
        events: merged.into_events(),
        ..Default::default()
    };
    (report, Some(events.encode_to_vec()), tracer)
}

fn panic_message(payload: &(dyn Any + Send)) -> &str {
    payload
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
        .unwrap_or("unknown panic")
}

fn write_outputs(
    dir: &Path,
    report: &Report,
    events: Option<&[u8]>,
    tracer: Option<&super::Tracer>,
) -> io::Result<()> {
    let name = report
        .file
        .strip_suffix("_events.json")
        .unwrap_or(&report.file);
    fs::create_dir_all(dir)?;
    if let Some(events) = events {
        fs::write(dir.join(format!("{name}.events")), events)?;
    }
    if let Some(tracer) = tracer {
        let json = serde_json::to_vec_pretty(tracer.output()).map_err(io::Error::other)?;
        fs::write(dir.join(format!("{name}.trace.json")), json)?;
    }
    let json = serde_json::to_vec_pretty(report).map_err(io::Error::other)?;
    fs::write(dir.join(format!("{name}.json")), json)
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::lifecycle::core::types::ServerTicks;

    #[test]
    fn captures_round_trip_through_serialization() {
        let capture = MergeCapture {
            uuid: Uuid::try_parse("d6a81e14-5f9a-4314-91d2-16eaee45b1d0").unwrap(),
            challenge_type: ChallengeType::Tob,
            mode: ChallengeMode::TobRegular,
            party: vec!["715".to_string(), "Sacolyn".to_string()],
            stage: Stage::TobBloat,
            attempt: None,
            records: vec![
                ClientStageStream::Metadata {
                    client_id: ClientId(1),
                    user_id: UserId(0),
                    plugin_version: "0.9.20".to_string(),
                    runelite_version: "1.11.0".to_string(),
                },
                ClientStageStream::Events {
                    client_id: ClientId(1),
                    events: Bytes::from_static(&[8, 11, 16, 3]),
                },
                ClientStageStream::End {
                    client_id: ClientId(1),
                    update: StageUpdate {
                        stage: Stage::TobBloat,
                        status: StageStatus::Completed,
                        accurate: true,
                        recorded_ticks: 145,
                        server_ticks: Some(ServerTicks {
                            count: 145,
                            precise: true,
                        }),
                    },
                },
            ],
        };

        let encoded = capture.encode(vec!["baseline".to_string()], &[]);
        let json: serde_json::Value = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(json["captureReasons"], serde_json::json!(["baseline"]));
        assert_eq!(json["mergedClients"], serde_json::json!([]));
        assert_eq!(json["unmergedClients"], serde_json::json!([]));
        assert_eq!(
            json["rawEvents"][1]["events"],
            serde_json::json!([8, 11, 16, 3])
        );
        assert_eq!(json["rawEvents"][1].get("update"), None);

        let dir = tempfile::tempdir().unwrap();
        let path = dir
            .path()
            .join("d6a81e14-5f9a-4314-91d2-16eaee45b1d0:11_events.json");
        fs::write(&path, encoded).unwrap();

        let loaded = MergeCapture::load(&path).unwrap();
        assert_eq!(loaded.uuid, capture.uuid);
        assert_eq!(loaded.challenge_type, ChallengeType::Tob);
        assert_eq!(loaded.mode, ChallengeMode::TobRegular);
        assert_eq!(loaded.party, capture.party);
        assert_eq!(loaded.stage, Stage::TobBloat);
        assert_eq!(loaded.attempt, None);
        assert_eq!(loaded.records, capture.records);
    }
}

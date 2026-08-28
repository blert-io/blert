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
    ChallengeMode, ChallengeType, ClientId, ClientStageStream, ServerTicks, Stage, StageStatus,
    StageUpdate, UserId, Uuid,
};
use crate::proto::ChallengeEvents;

use super::{Classification, MergeStatus};

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
        let file: File = serde_json::from_slice(&contents).map_err(CaptureError::Parse)?;

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
}

/// The saved capture file format.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct File {
    challenge_info: ChallengeInfo,
    stage: Stage,
    attempt: Option<u32>,
    raw_events: Vec<RawRecord>,
}

#[derive(Deserialize)]
struct ChallengeInfo {
    uuid: Uuid,
    #[serde(rename = "type")]
    challenge_type: ChallengeType,
    mode: ChallengeMode,
    party: Vec<String>,
}

/// A stream record in its JSON form, with field presence determined by `tag`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRecord {
    #[serde(rename = "type")]
    tag: u8,
    client_id: i64,
    events: Option<Buffer>,
    update: Option<StageUpdate>,
    user_id: Option<i64>,
    plugin_version: Option<String>,
    rune_lite_version: Option<String>,
}

/// The serialized form of an event batch.
#[derive(Deserialize)]
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
    last_tick: u32,
    missing_tick_count: u32,
    precise_server_tick_count: bool,
    accurate_until: u32,
    queryable_until: u32,
}

/// A client's merge outcome.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClientOutcome {
    id: ClientId,
    primary_player: Option<String>,
    stage_status: StageStatus,
    accurate: bool,
    recorded_ticks: u32,
    server_ticks: Option<ServerTicks>,
    consistency_issues: Vec<ConsistencyIssue>,
    status: &'static str,
    classification: Option<&'static str>,
    error: Option<String>,
}

impl From<super::ClientOutcome> for ClientOutcome {
    fn from(outcome: super::ClientOutcome) -> ClientOutcome {
        let (status, classification, error) = match outcome.status {
            MergeStatus::Merged(classification) => {
                ("MERGED", Some(classification_name(classification)), None)
            }
            MergeStatus::Unmerged(classification) => {
                ("UNMERGED", Some(classification_name(classification)), None)
            }
            MergeStatus::Skipped(error) => ("SKIPPED", None, Some(error.to_string())),
        };
        ClientOutcome {
            id: outcome.client_id,
            primary_player: outcome.primary_player,
            stage_status: outcome.stage_status,
            accurate: outcome.accurate,
            recorded_ticks: outcome.recorded_ticks,
            server_ticks: outcome.server_ticks,
            consistency_issues: outcome
                .consistency_issues
                .into_iter()
                .map(ConsistencyIssue::from)
                .collect(),
            status,
            classification,
            error,
        }
    }
}

fn classification_name(classification: Classification) -> &'static str {
    match classification {
        Classification::Reference => "REFERENCE",
        Classification::Matching => "MATCHING",
        Classification::Mismatched => "MISMATCHED",
    }
}

/// A consistency issue detected in a client's recording.
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ConsistencyIssue {
    #[serde(rename_all = "camelCase")]
    LargeJump {
        player: String,
        tick: u32,
        last_tick: u32,
        start_x: i32,
        start_y: i32,
        end_x: i32,
        end_y: i32,
    },
    #[serde(rename_all = "camelCase")]
    InvalidEventSequence { kind: i32, tick: u32 },
    #[serde(rename_all = "camelCase")]
    InvalidTickGap {
        kind: i32,
        tick: u32,
        observed: u32,
        min: u32,
    },
}

impl From<super::client_consistency::ConsistencyIssue> for ConsistencyIssue {
    fn from(issue: super::client_consistency::ConsistencyIssue) -> ConsistencyIssue {
        use super::client_consistency::ConsistencyIssue as Issue;
        match issue {
            Issue::LargeJump {
                player,
                tick,
                last_tick,
                start,
                end,
            } => ConsistencyIssue::LargeJump {
                player,
                tick,
                last_tick,
                start_x: start.x,
                start_y: start.y,
                end_x: end.x,
                end_y: end.y,
            },
            Issue::InvalidEventSequence { kind, tick } => ConsistencyIssue::InvalidEventSequence {
                kind: kind as i32,
                tick,
            },
            Issue::InvalidTickGap {
                kind,
                tick,
                observed,
                min,
            } => ConsistencyIssue::InvalidTickGap {
                kind: kind as i32,
                tick,
                observed,
                min,
            },
        }
    }
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
        super::merge(&challenge, capture.stage, capture.records, tracer.as_mut())
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

    report.clients = merge_report
        .clients
        .into_iter()
        .map(ClientOutcome::from)
        .collect();
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
        let json = serde_json::to_vec_pretty(tracer).map_err(io::Error::other)?;
        fs::write(dir.join(format!("{name}.trace.json")), json)?;
    }
    let json = serde_json::to_vec_pretty(report).map_err(io::Error::other)?;
    fs::write(dir.join(format!("{name}.json")), json)
}

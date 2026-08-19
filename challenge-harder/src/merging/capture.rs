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
pub fn run(captures: &[PathBuf], out: Option<&Path>) -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "warn".into()),
        )
        .with_writer(io::stderr)
        .init();

    if out.is_none() && captures.len() > 1 {
        eprintln!("an output directory is required to merge more than one capture");
        return ExitCode::FAILURE;
    }

    let mut failed = 0;
    for path in captures {
        let (report, events) = merge_capture(path);
        if report.error.is_some() {
            failed += 1;
        }

        let written = if let Some(dir) = out {
            write_outputs(dir, &report, events.as_deref())
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
    clients: Vec<ClientOutcome>,
}

/// A client's merge outcome.
// TODO(frolv): fill this out
#[derive(Serialize)]
struct ClientOutcome {}

/// Loads and merges one capture, returning its report and, if the merge
/// succeeds, the serialized events.
fn merge_capture(path: &Path) -> (Report, Option<Vec<u8>>) {
    let file = path.file_name().map_or_else(
        || path.display().to_string(),
        |name| name.to_string_lossy().into_owned(),
    );
    let mut report = Report {
        file,
        capture: None,
        merge: None,
        error: None,
    };

    let capture = match MergeCapture::load(path) {
        Ok(capture) => capture,
        Err(e) => {
            report.error = Some(e.to_string());
            return (report, None);
        }
    };
    report.capture = Some(Identity {
        uuid: capture.uuid,
        challenge_type: capture.challenge_type,
        mode: capture.mode,
        party: capture.party,
        stage: capture.stage,
        attempt: capture.attempt,
    });

    let merged = panic::catch_unwind(AssertUnwindSafe(|| {
        super::merge(capture.uuid, capture.stage, capture.records)
    }));
    let merged = match merged {
        Ok(Some(merged)) => merged,
        Ok(None) => {
            report.error = Some("no client data".into());
            return (report, None);
        }
        Err(payload) => {
            report.error = Some(format!(
                "merge panicked: {}",
                panic_message(payload.as_ref())
            ));
            return (report, None);
        }
    };

    report.merge = Some(Summary {
        status: merged.status(),
        last_tick: merged.last_tick(),
        missing_tick_count: merged.missing_tick_count(),
        precise_server_tick_count: merged.has_precise_server_tick_count(),
        accurate_until: merged.accurate_until(),
        queryable_until: merged.queryable_until(),
        clients: Vec::new(),
    });
    let events = ChallengeEvents {
        events: merged.into_events(),
        ..Default::default()
    };
    (report, Some(events.encode_to_vec()))
}

fn panic_message(payload: &(dyn Any + Send)) -> &str {
    payload
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
        .unwrap_or("unknown panic")
}

fn write_outputs(dir: &Path, report: &Report, events: Option<&[u8]>) -> io::Result<()> {
    let name = report
        .file
        .strip_suffix("_events.json")
        .unwrap_or(&report.file);
    fs::create_dir_all(dir)?;
    if let Some(events) = events {
        fs::write(dir.join(format!("{name}.events")), events)?;
    }
    let json = serde_json::to_vec_pretty(report).map_err(io::Error::other)?;
    fs::write(dir.join(format!("{name}.json")), json)
}

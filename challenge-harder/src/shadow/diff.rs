//! Tools for diffing a replay run against its original capture.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;

use super::artifact::{CommandLine, MappingLine, RunDir};
use super::capture::{Capture, CaptureOp};

/// Error reported if the replay run does not correspond to the capture it is
/// diffed against.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum DiffError {
    #[error("command {index} has no capture record")]
    UnknownRecord { index: usize },
    #[error("command {index} is a {found} but the capture records a {expected}")]
    OpMismatch {
        index: usize,
        expected: CaptureOp,
        found: CaptureOp,
    },
}

/// A single disagreement between the capture and the replay.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Divergence {
    /// Stable identity derived from the divergence's content.
    pub id: String,
    /// The captured challenge involved, where known.
    pub challenge: Option<Uuid>,
    /// Capture record index for command-level divergences.
    pub index: Option<usize>,
    #[serde(flatten)]
    pub kind: Kind,
}

/// Class of disagreement within a divergence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum Kind {
    /// The server under test answered with a different status code.
    StatusMismatch {
        op: CaptureOp,
        recorded: u16,
        replayed: u16,
    },
    /// The response body differs beyond challenge UUID remap.
    BodyMismatch {
        op: CaptureOp,
        paths: Vec<String>,
        recorded: Value,
        replayed: Value,
    },
    /// The command was never sent since its challenge had no mapping.
    Unmapped { op: CaptureOp },
    /// A response's UUID disagreed with the challenge's established mapping.
    UuidMismatch { existing: Uuid },
    /// Multiple captured challenges mapped onto one replayed challenge.
    UuidCollision { captured: Vec<Uuid>, replayed: Uuid },
    /// The capture announced the challenge's `FINISH` but the replay did not.
    MissingFinish,
    /// The replay announced a `FINISH` the capture never did.
    ExtraFinish { replayed: Uuid },
    /// The replay announced an unknown pubsub payload.
    UnexpectedAnnouncement { payload: Value },
    /// The challenge did not fully terminate.
    IncompleteChallenge { replayed: Uuid },
    /// The server under test did not exit cleanly.
    ForcedShutdown { exit: String, graceful: bool },
}

impl Kind {
    pub(super) fn slug(&self) -> &'static str {
        match self {
            Kind::StatusMismatch { .. } => "status-mismatch",
            Kind::BodyMismatch { .. } => "body-mismatch",
            Kind::Unmapped { .. } => "unmapped",
            Kind::UuidMismatch { .. } => "uuid-mismatch",
            Kind::UuidCollision { .. } => "uuid-collision",
            Kind::MissingFinish => "missing-finish",
            Kind::ExtraFinish { .. } => "extra-finish",
            Kind::UnexpectedAnnouncement { .. } => "unexpected-announcement",
            Kind::IncompleteChallenge { .. } => "incomplete-challenge",
            Kind::ForcedShutdown { .. } => "forced-shutdown",
        }
    }
}

/// The outcome of diffing a replay run against its capture.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub divergences: Vec<Divergence>,
    /// Distinct challenges in the capture.
    pub challenges: usize,
    /// Challenges with a replayed mapping.
    pub mapped: usize,
    /// Commands played by the replay.
    pub commands: usize,
    /// Commands compared against a recorded response.
    pub compared: usize,
    /// Commands with no recorded response to compare.
    pub skipped: usize,
    /// Announcements observed on the replay's pubsub channel.
    pub announcements: usize,
    /// Challenges whose `FINISH` announcement replayed.
    pub finished: usize,
}

/// Diffs a replay run's output against the capture that produced it.
pub fn diff(capture: &Capture, run: &RunDir) -> Result<Report, DiffError> {
    let reverse: BTreeMap<Uuid, Uuid> = run
        .remap
        .iter()
        .map(|(captured, replayed)| (*replayed, *captured))
        .collect();
    let challenges: BTreeSet<Uuid> = capture
        .records
        .iter()
        .filter_map(|record| record.challenge_uuid)
        .collect();

    let mut divergences = Vec::new();
    diff_challenge_decisions(run, &mut divergences);
    let (compared, skipped) = diff_commands(capture, run, &mut divergences)?;
    let finished = diff_announcements(capture, run, &reverse, &mut divergences);
    diff_run_health(run, &reverse, &mut divergences);

    Ok(Report {
        divergences,
        challenges: challenges.len(),
        mapped: run.remap.len(),
        commands: run.commands.len(),
        compared,
        skipped,
        announcements: run.announcements.len(),
        finished,
    })
}

fn diff_challenge_decisions(run: &RunDir, divergences: &mut Vec<Divergence>) {
    let mut by_replayed: BTreeMap<Uuid, Vec<Uuid>> = BTreeMap::new();
    for (captured, replayed) in &run.remap {
        by_replayed.entry(*replayed).or_default().push(*captured);
    }
    for (replayed, captured) in by_replayed {
        if captured.len() > 1 {
            divergences.push(divergence(
                Kind::UuidCollision { captured, replayed },
                None,
                None,
                Some(&replayed.to_string()),
            ));
        }
    }
}

/// Compares every replayed command against its capture record, returning the
/// compared and skipped counts.
fn diff_commands(
    capture: &Capture,
    run: &RunDir,
    divergences: &mut Vec<Divergence>,
) -> Result<(usize, usize), DiffError> {
    let mut compared = 0;
    let mut skipped = 0;

    for line in &run.commands {
        let sent = match line {
            CommandLine::Unmapped(unmapped) => {
                divergences.push(divergence(
                    Kind::Unmapped { op: unmapped.op },
                    Some(unmapped.challenge),
                    Some(unmapped.index),
                    None,
                ));
                continue;
            }
            CommandLine::Sent(sent) => sent,
        };

        let record = capture
            .records
            .get(sent.index)
            .ok_or(DiffError::UnknownRecord { index: sent.index })?;
        if record.op != sent.op {
            return Err(DiffError::OpMismatch {
                index: sent.index,
                expected: record.op,
                found: sent.op,
            });
        }

        if let Some(MappingLine::Mismatch(existing)) = sent.mapping {
            divergences.push(divergence(
                Kind::UuidMismatch { existing },
                sent.challenge,
                Some(sent.index),
                None,
            ));
        }

        let Some(http) = &record.http else {
            skipped += 1;
            continue;
        };
        compared += 1;

        if sent.status != http.status_code {
            divergences.push(divergence(
                Kind::StatusMismatch {
                    op: sent.op,
                    recorded: http.status_code,
                    replayed: sent.status,
                },
                sent.challenge,
                Some(sent.index),
                None,
            ));
            continue;
        }

        let mut normalized = remap_uuids(&http.response, &run.remap);
        // The old server inadvertently added party changes to its responses;
        // the rewrite deliberately does not.
        if let Value::Object(map) = &mut normalized {
            map.remove("partyChangedMidChallenge");
        }
        let mut paths = Vec::new();
        deep_diff(&normalized, &sent.response, "$", &mut paths);
        if !paths.is_empty() {
            divergences.push(divergence(
                Kind::BodyMismatch {
                    op: sent.op,
                    paths,
                    recorded: http.response.clone(),
                    replayed: sent.response.clone(),
                },
                sent.challenge,
                Some(sent.index),
                None,
            ));
        }
    }
    Ok((compared, skipped))
}

// TODO(frolv): Track `STAGE_END` after the stage processor lands.
fn diff_announcements(
    capture: &Capture,
    run: &RunDir,
    reverse: &BTreeMap<Uuid, Uuid>,
    divergences: &mut Vec<Divergence>,
) -> usize {
    let mut recorded_finish = BTreeSet::new();
    for record in &capture.records {
        if record.op == CaptureOp::ServerUpdate
            && record.request.get("action").and_then(Value::as_str) == Some("FINISH")
            && let Some(id) = announced_id(&record.request)
        {
            recorded_finish.insert(id);
        }
    }

    let mut replayed_finish = BTreeSet::new();
    for (index, announcement) in run.announcements.iter().enumerate() {
        match announcement.payload.get("action").and_then(Value::as_str) {
            Some("FINISH") => {
                if let Some(id) = announced_id(&announcement.payload) {
                    replayed_finish.insert(id);
                }
            }
            _ => {
                divergences.push(divergence(
                    Kind::UnexpectedAnnouncement {
                        payload: announcement.payload.clone(),
                    },
                    None,
                    None,
                    Some(&index.to_string()),
                ));
            }
        }
    }

    let mut finish_matched = 0;
    let mut covered = BTreeSet::new();
    for captured in &recorded_finish {
        match run.remap.get(captured) {
            Some(replayed) if replayed_finish.contains(replayed) => {
                finish_matched += 1;
                covered.insert(*replayed);
            }
            _ => {
                divergences.push(divergence(Kind::MissingFinish, Some(*captured), None, None));
            }
        }
    }
    for replayed in replayed_finish.difference(&covered) {
        let challenge = reverse.get(replayed).copied();
        divergences.push(divergence(
            Kind::ExtraFinish {
                replayed: *replayed,
            },
            challenge,
            None,
            Some(&replayed.to_string()),
        ));
    }
    finish_matched
}

/// Reports challenges that never terminated and unclean server exits.
fn diff_run_health(
    run: &RunDir,
    reverse: &BTreeMap<Uuid, Uuid>,
    divergences: &mut Vec<Divergence>,
) {
    for replayed in &run.summary.incomplete {
        let challenge = reverse.get(replayed).copied();
        divergences.push(divergence(
            Kind::IncompleteChallenge {
                replayed: *replayed,
            },
            challenge,
            None,
            Some(&replayed.to_string()),
        ));
    }
    if !run.summary.graceful_shutdown || run.summary.server_exit != "exit status: 0" {
        divergences.push(divergence(
            Kind::ForcedShutdown {
                exit: run.summary.server_exit.clone(),
                graceful: run.summary.graceful_shutdown,
            },
            None,
            None,
            None,
        ));
    }
}

fn divergence(
    kind: Kind,
    challenge: Option<Uuid>,
    index: Option<usize>,
    anchor: Option<&str>,
) -> Divergence {
    let mut parts = vec![kind.slug().to_owned()];
    if let Some(challenge) = challenge {
        parts.push(challenge.to_string());
    } else if let Some(anchor) = anchor {
        parts.push(anchor.to_owned());
    }
    if let Some(index) = index {
        parts.push(index.to_string());
    }
    Divergence {
        id: parts.join(":"),
        challenge,
        index,
        kind,
    }
}

fn announced_id(payload: &Value) -> Option<Uuid> {
    payload.get("id")?.as_str()?.parse().ok()
}

/// Replaces every captured UUID in `value` with its replayed counterpart.
fn remap_uuids(value: &Value, remap: &BTreeMap<Uuid, Uuid>) -> Value {
    match value {
        Value::String(s) => s
            .parse::<Uuid>()
            .ok()
            .and_then(|uuid| remap.get(&uuid))
            .map_or_else(
                || value.clone(),
                |replayed| Value::String(replayed.to_string()),
            ),
        Value::Array(items) => {
            Value::Array(items.iter().map(|item| remap_uuids(item, remap)).collect())
        }
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, item)| (key.clone(), remap_uuids(item, remap)))
                .collect(),
        ),
        _ => value.clone(),
    }
}

/// Records the JSON paths at which two values differ.
fn deep_diff(recorded: &Value, replayed: &Value, path: &str, paths: &mut Vec<String>) {
    match (recorded, replayed) {
        (Value::Object(a), Value::Object(b)) => {
            let keys: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
            for key in keys {
                match (a.get(key.as_str()), b.get(key.as_str())) {
                    (Some(x), Some(y)) => deep_diff(x, y, &format!("{path}.{key}"), paths),
                    _ => paths.push(format!("{path}.{key}")),
                }
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            if a.len() == b.len() {
                for (index, (x, y)) in a.iter().zip(b).enumerate() {
                    deep_diff(x, y, &format!("{path}[{index}]"), paths);
                }
            } else {
                paths.push(path.to_owned());
            }
        }
        _ => {
            if recorded != replayed {
                paths.push(path.to_owned());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::json;

    use super::super::artifact::{AnnouncementLine, RunSummary, SentLine, UnmappedLine};
    use super::super::capture::{CaptureHttp, CaptureRecord};
    use super::*;
    use crate::lifecycle::core::types::{ClientId, UserId};

    const CAP_A: &str = "11111111-1111-1111-1111-111111111111";
    const CAP_B: &str = "33333333-3333-3333-3333-333333333333";
    const REP_Y: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const REP_Z: &str = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    fn uuid(value: &str) -> Uuid {
        value.parse().unwrap()
    }

    fn record(
        op: CaptureOp,
        client: Option<i64>,
        challenge: Option<&str>,
        request: Value,
        http: Option<(u16, Value)>,
    ) -> CaptureRecord {
        CaptureRecord {
            ts: 0,
            op,
            host: "sock-a".into(),
            challenge_uuid: challenge.map(uuid),
            client_id: client.map(ClientId),
            user_id: client.map(UserId),
            request,
            http: http.map(|(status_code, response)| CaptureHttp {
                ok: status_code < 400,
                status_code,
                response,
            }),
        }
    }

    fn capture(records: Vec<CaptureRecord>) -> Capture {
        Capture {
            path: PathBuf::from("test.jsonl"),
            records,
        }
    }

    fn sent(
        index: usize,
        op: CaptureOp,
        challenge: Option<&str>,
        status: u16,
        response: Value,
        mapping: Option<MappingLine>,
    ) -> CommandLine {
        CommandLine::Sent(SentLine {
            index,
            op,
            client: ClientId(10),
            challenge: challenge.map(uuid),
            scheduled_ms: 0.0,
            sent_ms: 0.0,
            latency_ms: 0.0,
            status,
            response,
            mapping,
        })
    }

    fn finish_announcement(id: &str) -> AnnouncementLine {
        AnnouncementLine {
            offset_ms: 0.0,
            payload: json!({ "action": "FINISH", "id": id }),
        }
    }

    fn run_dir(
        commands: Vec<CommandLine>,
        remap: Vec<(&str, &str)>,
        announcements: Vec<AnnouncementLine>,
    ) -> RunDir {
        RunDir {
            commands,
            announcements,
            remap: remap
                .into_iter()
                .map(|(captured, replayed)| (uuid(captured), uuid(replayed)))
                .collect(),
            summary: RunSummary {
                capture_file: "test.jsonl".to_owned(),
                records: 0,
                challenges: 0,
                commands: 0,
                incomplete: Vec::new(),
                time_scale: 20,
                server_exit: "exit status: 0".to_owned(),
                graceful_shutdown: true,
            },
        }
    }

    #[test]
    fn a_clean_run_diffs_empty() {
        let capture = capture(vec![
            record(
                CaptureOp::Start,
                Some(10),
                Some(CAP_A),
                json!({ "type": 1 }),
                Some((200, json!({ "uuid": CAP_A }))),
            ),
            record(
                CaptureOp::Status,
                Some(10),
                Some(CAP_A),
                json!({ "status": 1 }),
                None,
            ),
            record(
                CaptureOp::Finish,
                Some(10),
                Some(CAP_A),
                json!({ "soft": true }),
                Some((200, Value::Null)),
            ),
            record(
                CaptureOp::ServerUpdate,
                None,
                Some(CAP_A),
                json!({ "id": CAP_A, "action": "STAGE_END", "stage": 12, "attempt": null }),
                None,
            ),
            record(
                CaptureOp::ServerUpdate,
                None,
                Some(CAP_A),
                json!({ "id": CAP_A, "action": "FINISH" }),
                None,
            ),
        ]);
        let run = run_dir(
            vec![
                sent(
                    0,
                    CaptureOp::Start,
                    Some(CAP_A),
                    200,
                    json!({ "uuid": REP_Y }),
                    Some(MappingLine::New),
                ),
                sent(1, CaptureOp::Status, None, 200, Value::Null, None),
                sent(2, CaptureOp::Finish, Some(CAP_A), 200, Value::Null, None),
            ],
            vec![(CAP_A, REP_Y)],
            vec![finish_announcement(REP_Y)],
        );

        // TODO(frolv): STAGE_END is ignored

        assert_eq!(
            diff(&capture, &run),
            Ok(Report {
                divergences: Vec::new(),
                challenges: 1,
                mapped: 1,
                commands: 3,
                compared: 2,
                skipped: 1,
                announcements: 1,
                finished: 1,
            }),
        );
    }

    #[test]
    fn status_and_body_disagreements_diverge() {
        let capture = capture(vec![
            record(
                CaptureOp::Start,
                Some(10),
                Some(CAP_A),
                json!({ "type": 1 }),
                Some((200, json!({ "uuid": CAP_A }))),
            ),
            record(
                CaptureOp::Update,
                Some(10),
                Some(CAP_A),
                json!({ "update": { "stage": 12 } }),
                Some((
                    200,
                    json!({ "stage": 12, "partyChangedMidChallenge": true }),
                )),
            ),
            record(
                CaptureOp::Update,
                Some(10),
                Some(CAP_A),
                json!({ "update": { "stage": 14 } }),
                Some((200, Value::Null)),
            ),
        ]);
        let run = run_dir(
            vec![
                sent(
                    0,
                    CaptureOp::Start,
                    Some(CAP_A),
                    200,
                    json!({ "uuid": REP_Y }),
                    Some(MappingLine::New),
                ),
                sent(
                    1,
                    CaptureOp::Update,
                    Some(CAP_A),
                    200,
                    json!({ "stage": 14 }),
                    Some(MappingLine::Match),
                ),
                sent(
                    2,
                    CaptureOp::Update,
                    Some(CAP_A),
                    500,
                    json!({ "error": "boom" }),
                    None,
                ),
            ],
            vec![(CAP_A, REP_Y)],
            Vec::new(),
        );

        assert_eq!(
            diff(&capture, &run),
            Ok(Report {
                divergences: vec![
                    Divergence {
                        id: format!("body-mismatch:{CAP_A}:1"),
                        challenge: Some(uuid(CAP_A)),
                        index: Some(1),
                        kind: Kind::BodyMismatch {
                            op: CaptureOp::Update,
                            paths: vec!["$.stage".to_owned()],
                            recorded: json!({ "stage": 12, "partyChangedMidChallenge": true }),
                            replayed: json!({ "stage": 14 }),
                        },
                    },
                    Divergence {
                        id: format!("status-mismatch:{CAP_A}:2"),
                        challenge: Some(uuid(CAP_A)),
                        index: Some(2),
                        kind: Kind::StatusMismatch {
                            op: CaptureOp::Update,
                            recorded: 200,
                            replayed: 500,
                        },
                    },
                ],
                challenges: 1,
                mapped: 1,
                commands: 3,
                compared: 3,
                skipped: 0,
                announcements: 0,
                finished: 0,
            }),
        );
    }

    #[test]
    fn uuid_disagreements_diverge() {
        let capture = capture(vec![
            record(
                CaptureOp::Start,
                Some(10),
                Some(CAP_A),
                json!({ "type": 1 }),
                Some((200, json!({ "uuid": CAP_A }))),
            ),
            record(
                CaptureOp::Start,
                Some(11),
                Some(CAP_B),
                json!({ "type": 1 }),
                Some((200, json!({ "uuid": CAP_B }))),
            ),
            record(
                CaptureOp::Update,
                Some(10),
                Some(CAP_A),
                json!({ "update": { "stage": 12 } }),
                Some((200, json!({ "uuid": CAP_A }))),
            ),
        ]);
        let run = run_dir(
            vec![
                sent(
                    0,
                    CaptureOp::Start,
                    Some(CAP_A),
                    200,
                    json!({ "uuid": REP_Y }),
                    Some(MappingLine::New),
                ),
                sent(
                    1,
                    CaptureOp::Start,
                    Some(CAP_B),
                    200,
                    json!({ "uuid": REP_Y }),
                    Some(MappingLine::New),
                ),
                sent(
                    2,
                    CaptureOp::Update,
                    Some(CAP_A),
                    200,
                    json!({ "uuid": REP_Z }),
                    Some(MappingLine::Mismatch(uuid(REP_Y))),
                ),
            ],
            vec![(CAP_A, REP_Y), (CAP_B, REP_Y)],
            Vec::new(),
        );

        let report = diff(&capture, &run).unwrap();
        assert_eq!(
            report.divergences,
            vec![
                Divergence {
                    id: format!("uuid-collision:{REP_Y}"),
                    challenge: None,
                    index: None,
                    kind: Kind::UuidCollision {
                        captured: vec![uuid(CAP_A), uuid(CAP_B)],
                        replayed: uuid(REP_Y),
                    },
                },
                Divergence {
                    id: format!("uuid-mismatch:{CAP_A}:2"),
                    challenge: Some(uuid(CAP_A)),
                    index: Some(2),
                    kind: Kind::UuidMismatch {
                        existing: uuid(REP_Y),
                    },
                },
                Divergence {
                    id: format!("body-mismatch:{CAP_A}:2"),
                    challenge: Some(uuid(CAP_A)),
                    index: Some(2),
                    kind: Kind::BodyMismatch {
                        op: CaptureOp::Update,
                        paths: vec!["$.uuid".to_owned()],
                        recorded: json!({ "uuid": CAP_A }),
                        replayed: json!({ "uuid": REP_Z }),
                    },
                },
            ],
        );
    }

    #[test]
    fn finish_pairing_and_run_health_diverge() {
        let capture = capture(vec![
            record(
                CaptureOp::Start,
                Some(10),
                Some(CAP_A),
                json!({ "type": 1 }),
                Some((200, json!({ "uuid": CAP_A }))),
            ),
            record(
                CaptureOp::Finish,
                Some(10),
                Some(CAP_A),
                json!({ "soft": true }),
                Some((200, Value::Null)),
            ),
            record(
                CaptureOp::ServerUpdate,
                None,
                Some(CAP_A),
                json!({ "id": CAP_A, "action": "FINISH" }),
                None,
            ),
        ]);
        let mut run = run_dir(
            vec![
                sent(
                    0,
                    CaptureOp::Start,
                    Some(CAP_A),
                    200,
                    json!({ "uuid": REP_Y }),
                    Some(MappingLine::New),
                ),
                sent(1, CaptureOp::Finish, Some(CAP_A), 200, Value::Null, None),
            ],
            vec![(CAP_A, REP_Y)],
            vec![finish_announcement(REP_Z)],
        );
        run.summary.incomplete = vec![uuid(REP_Y)];
        run.summary.graceful_shutdown = false;

        let report = diff(&capture, &run).unwrap();
        assert_eq!(
            report.divergences,
            vec![
                Divergence {
                    id: format!("missing-finish:{CAP_A}"),
                    challenge: Some(uuid(CAP_A)),
                    index: None,
                    kind: Kind::MissingFinish,
                },
                Divergence {
                    id: format!("extra-finish:{REP_Z}"),
                    challenge: None,
                    index: None,
                    kind: Kind::ExtraFinish {
                        replayed: uuid(REP_Z),
                    },
                },
                Divergence {
                    id: format!("incomplete-challenge:{CAP_A}"),
                    challenge: Some(uuid(CAP_A)),
                    index: None,
                    kind: Kind::IncompleteChallenge {
                        replayed: uuid(REP_Y),
                    },
                },
                Divergence {
                    id: "forced-shutdown".to_owned(),
                    challenge: None,
                    index: None,
                    kind: Kind::ForcedShutdown {
                        exit: "exit status: 0".to_owned(),
                        graceful: false,
                    },
                },
            ],
        );
        assert_eq!(report.finished, 0);
    }

    #[test]
    fn an_unmapped_command_diverges() {
        let capture = capture(vec![record(
            CaptureOp::Join,
            Some(11),
            Some(CAP_B),
            json!({ "recordingType": 0 }),
            Some((200, json!({ "uuid": CAP_B }))),
        )]);
        let run = run_dir(
            vec![CommandLine::Unmapped(UnmappedLine {
                index: 0,
                op: CaptureOp::Join,
                client: ClientId(11),
                challenge: uuid(CAP_B),
                unmapped: true,
            })],
            Vec::new(),
            Vec::new(),
        );

        let report = diff(&capture, &run).unwrap();
        assert_eq!(
            report.divergences,
            vec![Divergence {
                id: format!("unmapped:{CAP_B}:0"),
                challenge: Some(uuid(CAP_B)),
                index: Some(0),
                kind: Kind::Unmapped {
                    op: CaptureOp::Join,
                },
            }],
        );
    }

    #[test]
    fn a_run_from_another_capture_is_refused() {
        let capture = capture(vec![record(
            CaptureOp::Start,
            Some(10),
            Some(CAP_A),
            json!({ "type": 1 }),
            Some((200, json!({ "uuid": CAP_A }))),
        )]);

        let stale_index = run_dir(
            vec![sent(
                5,
                CaptureOp::Start,
                Some(CAP_A),
                200,
                Value::Null,
                None,
            )],
            Vec::new(),
            Vec::new(),
        );
        assert_eq!(
            diff(&capture, &stale_index),
            Err(DiffError::UnknownRecord { index: 5 }),
        );

        let wrong_op = run_dir(
            vec![sent(
                0,
                CaptureOp::Finish,
                Some(CAP_A),
                200,
                Value::Null,
                None,
            )],
            Vec::new(),
            Vec::new(),
        );
        assert_eq!(
            diff(&capture, &wrong_op),
            Err(DiffError::OpMismatch {
                index: 0,
                expected: CaptureOp::Start,
                found: CaptureOp::Finish,
            }),
        );
    }
}

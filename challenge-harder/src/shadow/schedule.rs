//! Replay plan derived from a capture window.

use core::time::Duration;

use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;

use super::capture::{CaptureOp, CaptureRecord};
use crate::lifecycle::core::types::ClientId;

/// One replayable request, in stream order.
#[derive(Debug, PartialEq)]
pub struct Planned {
    /// Position of the source record within its window.
    pub index: usize,
    /// Scaled offset from the window's first record.
    pub offset: Duration,
    pub client: ClientId,
    pub op: CaptureOp,
    /// Captured challenge whose mapping this request's response writes.
    pub creates: Option<Uuid>,
    /// Captured challenge whose mapping the request's path needs.
    pub requires: Option<Uuid>,
    /// The request body, replayed verbatim.
    pub body: Value,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ScheduleError {
    #[error("record {index} has no client")]
    MissingClient { index: usize },
    #[error("record {index} has no challenge")]
    MissingChallenge { index: usize },
}

/// Plans a capture's replayable requests.
pub fn schedule(records: &[CaptureRecord], scale: u32) -> Result<Vec<Planned>, ScheduleError> {
    let base = records.first().map_or(0, |record| record.ts);

    let mut plan = Vec::new();
    for (index, record) in records.iter().enumerate() {
        if record.op == CaptureOp::ServerUpdate {
            // Server updates are not input.
            continue;
        }

        let client = record
            .client_id
            .ok_or(ScheduleError::MissingClient { index })?;
        let challenge = || {
            record
                .challenge_uuid
                .ok_or(ScheduleError::MissingChallenge { index })
        };
        let (creates, requires) = match record.op {
            CaptureOp::Start => (Some(challenge()?), None),
            CaptureOp::Join | CaptureOp::Update | CaptureOp::Finish => (None, Some(challenge()?)),
            CaptureOp::Status => (None, None),
            CaptureOp::ServerUpdate => unreachable!("server updates are skipped above"),
        };

        plan.push(Planned {
            index,
            offset: Duration::from_millis(record.ts.saturating_sub(base)) / scale,
            client,
            op: record.op,
            creates,
            requires,
            body: record.request.clone(),
        });
    }
    Ok(plan)
}

/// Returns the server route to which a command is sent.
pub fn path(op: CaptureOp, challenge: Option<Uuid>) -> String {
    let resolved = || challenge.expect("op requires a resolved challenge");
    match op {
        CaptureOp::Start => "/challenges/new".to_owned(),
        CaptureOp::Update => format!("/challenges/{}", resolved()),
        CaptureOp::Finish => format!("/challenges/{}/finish", resolved()),
        CaptureOp::Join => format!("/challenges/{}/join", resolved()),
        CaptureOp::Status => "/client-status".to_owned(),
        CaptureOp::ServerUpdate => unreachable!("server updates are not replayed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lifecycle::core::types::UserId;

    const UUID_A: &str = "11111111-1111-1111-1111-111111111111";

    fn record(ts: u64, op: CaptureOp, client: Option<i64>, uuid: Option<&str>) -> CaptureRecord {
        CaptureRecord {
            ts,
            op,
            host: "sock-a".into(),
            challenge_uuid: uuid.map(|uuid| uuid.parse().unwrap()),
            client_id: client.map(ClientId),
            user_id: client.map(UserId),
            request: serde_json::Value::Null,
            http: None,
        }
    }

    fn window() -> Vec<CaptureRecord> {
        vec![
            record(1000, CaptureOp::Start, Some(1), Some(UUID_A)),
            record(1500, CaptureOp::Update, Some(1), Some(UUID_A)),
            record(1400, CaptureOp::Status, Some(2), None),
            record(2000, CaptureOp::ServerUpdate, None, Some(UUID_A)),
            record(2200, CaptureOp::Join, Some(2), Some(UUID_A)),
            record(2500, CaptureOp::Finish, Some(1), Some(UUID_A)),
        ]
    }

    #[test]
    fn plans_offsets_clients_and_references() {
        let uuid: Uuid = UUID_A.parse().unwrap();
        assert_eq!(
            schedule(&window(), 1),
            Ok(vec![
                Planned {
                    index: 0,
                    offset: Duration::ZERO,
                    client: ClientId(1),
                    op: CaptureOp::Start,
                    creates: Some(uuid),
                    requires: None,
                    body: Value::Null,
                },
                Planned {
                    index: 1,
                    offset: Duration::from_millis(500),
                    client: ClientId(1),
                    op: CaptureOp::Update,
                    creates: None,
                    requires: Some(uuid),
                    body: Value::Null,
                },
                Planned {
                    index: 2,
                    offset: Duration::from_millis(400),
                    client: ClientId(2),
                    op: CaptureOp::Status,
                    creates: None,
                    requires: None,
                    body: Value::Null,
                },
                Planned {
                    index: 4,
                    offset: Duration::from_millis(1200),
                    client: ClientId(2),
                    op: CaptureOp::Join,
                    creates: None,
                    requires: Some(uuid),
                    body: Value::Null,
                },
                Planned {
                    index: 5,
                    offset: Duration::from_millis(1500),
                    client: ClientId(1),
                    op: CaptureOp::Finish,
                    creates: None,
                    requires: Some(uuid),
                    body: Value::Null,
                },
            ]),
        );
    }

    #[test]
    fn scales_offsets() {
        let offsets: Vec<Duration> = schedule(&window(), 10)
            .unwrap()
            .into_iter()
            .map(|planned| planned.offset)
            .collect();
        assert_eq!(
            offsets,
            vec![
                Duration::ZERO,
                Duration::from_millis(50),
                Duration::from_millis(40),
                Duration::from_millis(120),
                Duration::from_millis(150),
            ],
        );
    }

    #[test]
    fn clamps_offsets_before_the_window_base() {
        let records = vec![
            record(1000, CaptureOp::Start, Some(1), Some(UUID_A)),
            record(900, CaptureOp::Status, Some(1), None),
        ];
        let plan = schedule(&records, 1).unwrap();
        assert_eq!(plan[1].offset, Duration::ZERO);
    }

    #[test]
    fn paths_for_each_op() {
        let uuid: Uuid = "22222222-2222-2222-2222-222222222222".parse().unwrap();
        assert_eq!(path(CaptureOp::Start, None), "/challenges/new");
        assert_eq!(
            path(CaptureOp::Update, Some(uuid)),
            "/challenges/22222222-2222-2222-2222-222222222222",
        );
        assert_eq!(
            path(CaptureOp::Finish, Some(uuid)),
            "/challenges/22222222-2222-2222-2222-222222222222/finish",
        );
        assert_eq!(
            path(CaptureOp::Join, Some(uuid)),
            "/challenges/22222222-2222-2222-2222-222222222222/join",
        );
        assert_eq!(path(CaptureOp::Status, None), "/client-status");
    }

    #[test]
    fn request_without_client_is_rejected() {
        let records = vec![record(1000, CaptureOp::Start, None, Some(UUID_A))];
        assert_eq!(
            schedule(&records, 1),
            Err(ScheduleError::MissingClient { index: 0 }),
        );
    }

    #[test]
    fn request_without_challenge_is_rejected() {
        let records = vec![
            record(1000, CaptureOp::Start, Some(1), Some(UUID_A)),
            record(1100, CaptureOp::Update, Some(1), None),
        ];
        assert_eq!(
            schedule(&records, 1),
            Err(ScheduleError::MissingChallenge { index: 1 }),
        );
    }
}

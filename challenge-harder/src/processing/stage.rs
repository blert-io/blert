//! Stage event processing.
//!
//! The run follows a three-phase pipeline:
//!
//! 1. `gather` reads the stage's recorded streams and stored challenge state.
//! 2. `interpret` runs the synchronous processing step to convert the raw
//!    streams into a canonical record of stage events.
//! 3. `persist` receives the results and writes them to the database and
//!    blob store.

use crate::lifecycle::challenge::StoreError;
use crate::lifecycle::core::types::{
    ChallengeType, ClientStageStream, ProcessingError, ProcessingPayload, Stage, Uuid,
};
use crate::store::Store;

use super::ChallengeInfo;
use super::challenge_processor::ChallengeProcessor;
use super::db;
use super::interpret::{InterpretError, InterpretOutput, interpret};
use super::mokhaiotl::MokhaiotlProcessor;

/// Processes a stage's events from its recorded streams.
pub async fn process(
    store: &Store,
    txn: &db::Transaction,
    challenge: &ChallengeInfo,
    uuid: Uuid,
    stage: Stage,
    attempt: Option<u32>,
) -> Result<(ProcessingPayload, Option<serde_json::Value>), ProcessingError> {
    let mut processor = match challenge.challenge_type {
        ChallengeType::Mokhaiotl => MokhaiotlProcessor,
        // TODO(frolv): port
        ChallengeType::Tob
        | ChallengeType::Cox
        | ChallengeType::Toa
        | ChallengeType::Colosseum
        | ChallengeType::Inferno
        | ChallengeType::UnknownChallenge => {
            tracing::info!(
                %uuid,
                challenge_type = ?challenge.challenge_type,
                ?stage,
                "stage_processing_skipped",
            );
            return Ok((ProcessingPayload::None, None));
        }
    };

    let stream = gather(store, uuid, stage, attempt).await?;
    let info = challenge.clone();

    let (result, mut processor) = tokio::task::spawn_blocking(move || {
        let result = interpret(uuid, info, stage, stream, &mut processor);
        (result, processor)
    })
    .await
    .map_err(|error| ProcessingError {
        retriable: true,
        message: format!("interpret task failed: {error}"),
    })?;

    let payload = persist(txn, challenge, stage, result, &mut processor).await?;
    Ok((payload, processor.custom_data()))
}

/// Reads a stage's recorded streams from the store.
// TODO(frolv): This should also collect other data required by the processing
// thread.
async fn gather(
    store: &Store,
    uuid: Uuid,
    stage: Stage,
    attempt: Option<u32>,
) -> Result<Vec<ClientStageStream>, ProcessingError> {
    store
        .read_stage_stream(uuid, stage, attempt)
        .await
        .map_err(|error| ProcessingError {
            retriable: matches!(error, StoreError::Unavailable(_)),
            message: error.to_string(),
        })
}

/// Writes a stage's processed results to the database and blob store.
/// Returns the payload to be sent back to the challenge.
async fn persist(
    txn: &db::Transaction,
    challenge: &ChallengeInfo,
    stage: Stage,
    result: Result<InterpretOutput, InterpretError>,
    processor: &mut dyn ChallengeProcessor,
) -> Result<ProcessingPayload, ProcessingError> {
    let payload = payload_from(&result);

    if let Ok(mut output) = result {
        processor
            .on_stage_finished(txn, &mut output.ctx, stage, &output.events)
            .await?;

        let total = (challenge.challenge_ticks + output.events.last_tick()).cast_signed();
        txn.execute(
            "UPDATE challenges SET challenge_ticks = $1 WHERE id = $2",
            &[&total, &txn.challenge_id()],
        )
        .await
        .map_err(db::Error::from)?;
    }

    Ok(payload)
}

fn payload_from(result: &Result<InterpretOutput, InterpretError>) -> ProcessingPayload {
    match result {
        Ok(output) => ProcessingPayload::Stage {
            status: output.events.status(),
            ticks: output.events.last_tick(),
        },
        // TODO(frolv): Handle errors.
        Err(InterpretError::NoData) => ProcessingPayload::None,
    }
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;
    use prost::Message;

    use super::*;
    use crate::lifecycle::core::types::{
        ChallengeMode, ChallengeStatus, ClientId, ServerTicks, StageStatus, StageUpdate,
    };
    use crate::proto::{ChallengeEvents, Event};

    fn test_uuid() -> Uuid {
        "a8cb035f-410a-45de-a4d3-2b0a5d8b464d".parse().unwrap()
    }

    fn events(client: i64, ticks: &[u32]) -> ClientStageStream {
        let message = ChallengeEvents {
            events: ticks
                .iter()
                .map(|&tick| Event {
                    tick,
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        };
        ClientStageStream::Events {
            client_id: ClientId(client),
            events: Bytes::from(message.encode_to_vec()),
        }
    }

    fn end(client: i64, status: StageStatus, ticks: u32) -> ClientStageStream {
        ClientStageStream::End {
            client_id: ClientId(client),
            update: StageUpdate {
                stage: Stage::MokhaiotlDelve1,
                status,
                accurate: true,
                recorded_ticks: ticks,
                server_ticks: Some(ServerTicks {
                    count: ticks,
                    precise: true,
                }),
            },
        }
    }

    fn run_interpret(records: Vec<ClientStageStream>) -> Result<InterpretOutput, InterpretError> {
        let info = ChallengeInfo {
            challenge_type: ChallengeType::Mokhaiotl,
            mode: ChallengeMode::NoMode,
            party: vec!["1Ogp".to_string()],
            party_changed: false,
            stage: Stage::MokhaiotlDelve1,
            status: ChallengeStatus::InProgress,
            challenge_ticks: 0,
            created_unix_ms: 0,
        };
        let mut processor = MokhaiotlProcessor;
        interpret(
            test_uuid(),
            info,
            Stage::MokhaiotlDelve1,
            records,
            &mut processor,
        )
    }

    #[test]
    fn interpret_reports_the_first_clients_timeline() {
        let result = run_interpret(vec![
            events(2, &[0, 1]),
            end(2, StageStatus::Wiped, 185),
            events(1, &[0, 1, 2]),
            end(1, StageStatus::Completed, 200),
        ])
        .unwrap();
        assert_eq!(result.events.status(), StageStatus::Completed);
        assert_eq!(result.events.last_tick(), 200);
    }

    #[test]
    fn client_without_a_report_processes_from_its_events() {
        let result = run_interpret(vec![events(1, &[0, 1, 4])]).unwrap();
        assert_eq!(result.events.status(), StageStatus::Started);
        assert_eq!(result.events.last_tick(), 4);
    }

    #[test]
    fn empty_stream_yields_no_payload() {
        assert_eq!(
            payload_from(&run_interpret(vec![])),
            ProcessingPayload::None,
        );
    }
}

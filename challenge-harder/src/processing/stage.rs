//! Stage event processing.
//!
//! The run follows a three-phase pipeline:
//!
//! 1. `gather` reads the stage's recorded streams and stored challenge state.
//! 2. `interpret` runs the synchronous processing step to convert the raw
//!    streams into a canonical record of stage events.
//! 3. `persist` receives the results and writes them to the database and
//!    blob store.

use crate::lifecycle::core::types::{
    ClientStageStream, ProcessingError, ProcessingPayload, StageStatus,
};
use crate::lifecycle::store::StoreError;
use crate::merging::capture::MergeCapture;
use crate::merging::{MergeReport, MergedEvents};
use crate::metrics::{self, MergeOutcome};
use crate::redis::Store;

use super::challenge::load_database_state;
use super::challenge_processor::ChallengeProcessor;
use super::interpret::{InterpretError, InterpretOutput, interpret};
use super::merging::{Capture, CaptureReason};
use super::persist::{
    save_merge_report, save_splits, update_challenge_row, update_player_stats, update_players,
    write_queryable_events,
};
use super::{ChallengeInfo, Pipeline, StoredState};
use super::{db, effects};

/// Processes a stage's events from its recorded streams.
pub async fn process(
    pipeline: &Pipeline,
    txn: &db::Transaction,
    challenge: &ChallengeInfo,
) -> Result<(ProcessingPayload, Option<serde_json::Value>), ProcessingError> {
    let (stream, stored) = gather(&pipeline.store, txn, challenge).await?;

    let Some(mut processor) =
        super::processor_for(pipeline.config, challenge, stored.custom_data.as_ref())?
    else {
        tracing::info!(
            uuid = %challenge.uuid,
            challenge_type = ?challenge.challenge_type,
            stage = ?challenge.stage,
            "stage_processing_skipped",
        );
        return Ok((ProcessingPayload::None, None));
    };

    let info = challenge.clone();

    let (result, mut processor, stream) = tokio::task::spawn_blocking(move || {
        let result = interpret(info, &stream, &mut *processor);
        (result, processor, stream)
    })
    .await
    .map_err(|error| ProcessingError {
        retriable: true,
        message: format!("interpret task failed: {error}"),
    })?;

    let payload = persist(
        pipeline,
        txn,
        &mut *processor,
        challenge,
        &stored,
        result,
        stream,
    )
    .await?;
    Ok((payload, processor.custom_data()))
}

/// Collects the recorded streams and stored challenge state a run requires.
async fn gather(
    store: &Store,
    txn: &db::Transaction,
    challenge: &ChallengeInfo,
) -> Result<(Vec<ClientStageStream>, StoredState), ProcessingError> {
    let stream = async {
        store
            .read_stage_stream(challenge.uuid, challenge.stage, challenge.stage_attempt)
            .await
            .map_err(|error| ProcessingError {
                retriable: matches!(error, StoreError::Unavailable(_)),
                message: error.to_string(),
            })
    };
    let stored = async {
        load_database_state(txn, challenge)
            .await
            .map_err(ProcessingError::from)
    };
    tokio::try_join!(stream, stored)
}

/// Writes a stage's processed results to the database and blob store.
/// Returns the payload to be sent back to the challenge.
async fn persist(
    pipeline: &Pipeline,
    txn: &db::Transaction,
    processor: &mut dyn ChallengeProcessor,
    challenge: &ChallengeInfo,
    stored: &StoredState,
    result: Result<InterpretOutput, InterpretError>,
    records: Vec<ClientStageStream>,
) -> Result<ProcessingPayload, ProcessingError> {
    let payload = payload_from(&result);
    let streams = MergeCapture {
        uuid: challenge.uuid,
        challenge_type: challenge.challenge_type,
        mode: challenge.mode,
        party: challenge.party.clone(),
        stage: challenge.stage,
        attempt: challenge.stage_attempt,
        records,
    };
    let mut output = match result {
        Ok(output) => output,
        Err(InterpretError::NoData) => {
            metrics::record_merge_outcome(MergeOutcome::NoData);
            return Ok(payload);
        }
        Err(InterpretError::BadData(report)) => {
            metrics::record_merge_outcome(MergeOutcome::BadData);
            let capture = match &pipeline.capturer {
                Some(capturer) => {
                    capturer
                        .capture(challenge, CaptureReason::BadData, &streams, &report.clients)
                        .await
                }
                None => None,
            };
            write_merge_report(txn, challenge, &report, None, capture.as_ref()).await?;
            metrics::record_merge_report(challenge.stage, &report);
            return Ok(payload);
        }
    };
    metrics::record_merge_outcome(MergeOutcome::Merged);
    metrics::record_merge_report(challenge.stage, &output.report);
    metrics::record_stage_completion(
        challenge.stage,
        output.events.status(),
        output.events.fully_accurate(),
        output.report.unmerged_count > 0,
        output.report.skipped_count > 0,
    );

    let challenge_ticks = processor
        .on_stage_finished(
            txn,
            &pipeline.price_resolver,
            stored,
            &mut output.ctx,
            challenge.stage,
            &output.events,
        )
        .await?;

    save_splits(
        txn,
        challenge,
        output.ctx.splits(
            output.events.accurate_until(),
            output.events.status() == StageStatus::Completed,
        ),
        &stored.players,
    )
    .await?;

    let capture = match &pipeline.capturer {
        Some(capturer) => {
            capturer
                .sample_capture(challenge, &output.report, &streams)
                .await
        }
        None => None,
    };
    tokio::try_join!(
        update_players(txn, challenge.stage, &output.ctx, &stored.players),
        update_player_stats(txn, output.ctx.players(), &stored.players),
        update_challenge_row(txn, challenge_ticks, output.ctx.deaths().len()),
        write_merge_report(
            txn,
            challenge,
            &output.report,
            Some(&output.events),
            capture.as_ref()
        )
    )?;

    effects::emit(
        txn,
        &effects::Event::StageFinished {
            uuid: challenge.uuid,
            stage: challenge.stage,
            attempt: challenge.stage_attempt,
        },
    )
    .await?;

    write_challenge_data(pipeline, txn, processor, challenge, stored, output).await?;
    Ok(payload)
}

async fn write_challenge_data(
    pipeline: &Pipeline,
    txn: &db::Transaction,
    processor: &mut dyn ChallengeProcessor,
    challenge: &ChallengeInfo,
    stored: &StoredState,
    output: InterpretOutput,
) -> Result<(), ProcessingError> {
    let queryable_events = write_queryable_events(txn, challenge, &output, &stored.players).await?;

    let queryable_until = output.events.queryable_until();
    let events = output.into_kept_events();
    let total_events = events.len();

    let challenge_data = processor.challenge_data();
    let save_challenge_data = async {
        if let Some(data) = challenge_data {
            pipeline
                .repository
                .save_challenge(challenge.uuid, &data)
                .await
        } else {
            Ok(())
        }
    };

    let save_stage_events = async {
        let result = pipeline
            .repository
            .save_stage_events(
                challenge.uuid,
                challenge.stage,
                challenge.stage_attempt,
                &challenge.party,
                events,
            )
            .await;
        metrics::record_stage_events_write(result.is_ok());
        result
    };
    tokio::try_join!(save_challenge_data, save_stage_events)?;

    tracing::info!(
        uuid = %challenge.uuid,
        stage = ?challenge.stage,
        total_events,
        queryable_events,
        %queryable_until,
        "challenge_stage_events_saved",
    );
    metrics::record_queryable_events(challenge.stage, queryable_events);

    Ok(())
}

async fn write_merge_report(
    txn: &db::Transaction,
    challenge: &ChallengeInfo,
    report: &MergeReport,
    events: Option<&MergedEvents>,
    capture: Option<&Capture>,
) -> Result<(), db::Error> {
    let result = save_merge_report(txn, challenge, report, events, capture).await;
    metrics::record_merge_result_write(result.is_ok());
    result
}

fn payload_from(result: &Result<InterpretOutput, InterpretError>) -> ProcessingPayload {
    match result {
        Ok(output) => ProcessingPayload::Stage {
            status: output.events.status(),
            ticks: output.events.duration().0,
        },
        Err(InterpretError::NoData | InterpretError::BadData(_)) => ProcessingPayload::None,
    }
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;
    use prost::Message;

    use super::super::mokhaiotl::MokhaiotlProcessor;
    use super::*;
    use crate::lifecycle::core::types::{
        ChallengeMode, ChallengeStatus, ChallengeType, ClientId, ServerTicks, Stage, StageStatus,
        StageUpdate, Uuid,
    };
    use crate::merging::Tick;
    use crate::proto::ChallengeEvents;

    fn test_uuid() -> Uuid {
        "a8cb035f-410a-45de-a4d3-2b0a5d8b464d".parse().unwrap()
    }

    #[test]
    fn no_data_yields_no_payload() {
        assert_eq!(
            payload_from(&Err(InterpretError::NoData)),
            ProcessingPayload::None,
        );
    }

    fn events(client: i64, ticks: &[u32]) -> ClientStageStream {
        let message = ChallengeEvents {
            events: ticks
                .iter()
                .map(|&tick| {
                    crate::merging::fixtures::mokhaiotl_larva_leak_event(
                        crate::merging::Tick(tick),
                        Stage::MokhaiotlDelve1,
                        40_000 + u64::from(tick),
                        5,
                    )
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

    fn run_interpret(records: &[ClientStageStream]) -> Result<InterpretOutput, InterpretError> {
        let info = ChallengeInfo {
            uuid: test_uuid(),
            session_uuid: "5e55b41c-6a3f-4a89-9e10-c1a7d2f3b804".parse().unwrap(),
            challenge_type: ChallengeType::Mokhaiotl,
            mode: ChallengeMode::NoMode,
            party: vec!["1Ogp".to_string()],
            party_changed: false,
            stage: Stage::MokhaiotlDelve1,
            stage_attempt: None,
            status: ChallengeStatus::InProgress,
            created_unix_ms: 0,
            reported_times: None,
            finished_unix_ms: None,
        };
        let mut processor =
            MokhaiotlProcessor::new(info.clone(), None).expect("empty custom data is valid");
        interpret(info, records, &mut processor)
    }

    #[test]
    fn interpret_reports_the_first_clients_timeline() {
        let result = run_interpret(&[
            events(2, &[0, 1]),
            end(2, StageStatus::Wiped, 185),
            events(1, &[0, 1, 2]),
            end(1, StageStatus::Completed, 200),
        ])
        .unwrap();
        assert_eq!(result.events.status(), StageStatus::Completed);
        assert_eq!(result.events.last_tick(), Tick(200));
    }

    #[test]
    fn client_without_a_report_processes_from_its_events() {
        let result = run_interpret(&[events(1, &[0, 1, 4])]).unwrap();
        assert_eq!(result.events.status(), StageStatus::Started);
        assert_eq!(result.events.last_tick(), Tick(4));
    }
}

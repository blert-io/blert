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
use crate::metrics;
use crate::price::PriceResolver;
use crate::redis::Store;
use crate::repository::DataRepository;

use super::challenge::load_database_state;
use super::challenge_processor::ChallengeProcessor;
use super::db;
use super::interpret::{InterpretError, InterpretOutput, interpret};
use super::persist::{
    save_splits, update_challenge_row, update_player_stats, update_players, write_queryable_events,
};
use super::{ChallengeInfo, ProcessorConfig, StoredState};

/// Processes a stage's events from its recorded streams.
pub async fn process(
    store: &Store,
    repository: &DataRepository,
    txn: &db::Transaction,
    price_resolver: &PriceResolver,
    config: ProcessorConfig,
    challenge: &ChallengeInfo,
) -> Result<(ProcessingPayload, Option<serde_json::Value>), ProcessingError> {
    let (stream, stored) = gather(store, txn, challenge).await?;

    let Some(mut processor) = super::processor_for(config, challenge, stored.custom_data.as_ref())?
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

    let (result, mut processor) = tokio::task::spawn_blocking(move || {
        let result = interpret(info, stream, &mut *processor);
        (result, processor)
    })
    .await
    .map_err(|error| ProcessingError {
        retriable: true,
        message: format!("interpret task failed: {error}"),
    })?;

    let payload = persist(
        txn,
        repository,
        price_resolver,
        challenge,
        &stored,
        result,
        &mut *processor,
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
    txn: &db::Transaction,
    repository: &DataRepository,
    price_resolver: &PriceResolver,
    challenge: &ChallengeInfo,
    stored: &StoredState,
    result: Result<InterpretOutput, InterpretError>,
    processor: &mut dyn ChallengeProcessor,
) -> Result<ProcessingPayload, ProcessingError> {
    let payload = payload_from(&result);
    let Ok(mut output) = result else {
        return Ok(payload);
    };

    let challenge_ticks = processor
        .on_stage_finished(
            txn,
            price_resolver,
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

    let ((), (), queryable_events, ()) = tokio::try_join!(
        update_players(txn, challenge.stage, &output.ctx, &stored.players),
        update_player_stats(txn, output.ctx.players(), &stored.players),
        write_queryable_events(txn, challenge, &output, &stored.players),
        update_challenge_row(txn, challenge_ticks, output.ctx.deaths().len())
    )?;

    let queryable_until = output.events.queryable_until();
    let events = output.into_kept_events();
    let total_events = events.len();

    let challenge_data = processor.challenge_data();
    let save_challenge_data = async {
        if let Some(data) = challenge_data {
            repository.save_challenge(challenge.uuid, &data).await
        } else {
            Ok(())
        }
    };

    let save_stage_events = async {
        let result = repository
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
        queryable_until,
        "challenge_stage_events_saved",
    );
    metrics::record_queryable_events(challenge.stage, queryable_events);

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

    use super::super::mokhaiotl::MokhaiotlProcessor;
    use super::*;
    use crate::lifecycle::core::types::{
        ChallengeMode, ChallengeStatus, ChallengeType, ClientId, ServerTicks, Stage, StageStatus,
        StageUpdate, Uuid,
    };
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
                        tick,
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

    fn run_interpret(records: Vec<ClientStageStream>) -> Result<InterpretOutput, InterpretError> {
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
}

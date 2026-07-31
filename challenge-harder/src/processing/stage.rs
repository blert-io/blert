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
    ChallengeType, ClientStageStream, PlayerId, PrimaryMeleeGear, ProcessingError,
    ProcessingPayload,
};
use crate::repository::DataRepository;
use crate::store::Store;

use super::challenge_processor::ChallengeProcessor;
use super::db;
use super::interpret::interpret;
use super::mokhaiotl::MokhaiotlProcessor;
use super::persist::persist;
use super::{ChallengeInfo, StoredPlayerInfo, StoredState};

/// Processes a stage's events from its recorded streams.
pub async fn process(
    store: &Store,
    repository: &DataRepository,
    txn: &db::Transaction,
    challenge: &ChallengeInfo,
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
                uuid = %challenge.uuid,
                challenge_type = ?challenge.challenge_type,
                stage = ?challenge.stage,
                "stage_processing_skipped",
            );
            return Ok((ProcessingPayload::None, None));
        }
    };

    let (stream, stored) = gather(store, txn, challenge).await?;
    let info = challenge.clone();

    let (result, mut processor) = tokio::task::spawn_blocking(move || {
        let result = interpret(info, stream, &mut processor);
        (result, processor)
    })
    .await
    .map_err(|error| ProcessingError {
        retriable: true,
        message: format!("interpret task failed: {error}"),
    })?;

    let payload = persist(txn, repository, challenge, &stored, result, &mut processor).await?;
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
        load_database_state(txn, challenge.scale())
            .await
            .map_err(ProcessingError::from)
    };
    tokio::try_join!(stream, stored)
}

pub(super) async fn load_database_state(
    txn: &db::Transaction,
    expected_scale: i16,
) -> Result<StoredState, db::Error> {
    let rows = txn
        .query(
            "SELECT player_id, primary_gear FROM challenge_players
             WHERE challenge_id = $1
             ORDER BY orb",
            &[&txn.challenge_id()],
        )
        .await?;
    if rows.len() != expected_scale.cast_unsigned() as usize {
        return Err(db::Error::InvalidData(format!(
            "challenge has {} players, expected {expected_scale}",
            rows.len(),
        )));
    }

    let players = rows
        .iter()
        .map(|row| {
            let gear: i16 = row.get(1);
            Ok(StoredPlayerInfo {
                id: PlayerId(row.get(0)),
                gear: PrimaryMeleeGear::try_from(gear)
                    .map_err(|value| db::Error::InvalidData(format!("primary gear {value}")))?,
            })
        })
        .collect::<Result<Vec<_>, db::Error>>()?;

    Ok(StoredState {
        players,
        custom_data: txn.custom_data().cloned(),
    })
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;
    use prost::Message;

    use super::super::interpret::{InterpretError, InterpretOutput};
    use super::*;
    use crate::lifecycle::core::types::{
        ChallengeMode, ChallengeStatus, ClientId, ServerTicks, Stage, StageStatus, StageUpdate,
        Uuid,
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
            uuid: test_uuid(),
            challenge_type: ChallengeType::Mokhaiotl,
            mode: ChallengeMode::NoMode,
            party: vec!["1Ogp".to_string()],
            party_changed: false,
            stage: Stage::MokhaiotlDelve1,
            stage_attempt: None,
            status: ChallengeStatus::InProgress,
            created_unix_ms: 0,
        };
        let mut processor = MokhaiotlProcessor;
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

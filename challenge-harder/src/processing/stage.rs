//! Stage event processing.
//!
//! The run follows a three-phase pipeline:
//!
//! 1. `gather` reads the stage's recorded streams and stored challenge state.
//! 2. `interpret` runs the synchronous processing step to convert the raw
//!    streams into a canonical record of stage events.
//! 3. `persist` receives the results and writes them to the database and
//!    blob store.

use std::collections::BTreeMap;

use super::ChallengeInfo;
use super::db;
use crate::lifecycle::challenge::StoreError;
use crate::lifecycle::core::types::{
    ClientId, ClientStageStream, ProcessingError, ProcessingPayload, Stage, StageStatus, Uuid,
};
use crate::store::Store;

/// A single client's events for a stage, structured from its stream records.
// TODO(frolv): move to merging
#[derive(Debug)]
pub struct ClientEvents {
    status: StageStatus,
    recorded_ticks: u32,
}

impl ClientEvents {
    /// Initializes challenge events for a client from its stage event stream.
    fn from_client_stream(
        uuid: Uuid,
        stage: Stage,
        client_id: ClientId,
        records: &[ClientStageStream],
    ) -> ClientEvents {
        let mut client = ClientEvents {
            status: StageStatus::Started,
            recorded_ticks: 0,
        };

        let mut saw_stage_end = false;
        for record in records {
            if let ClientStageStream::End { update, .. } = record {
                client.status = update.status;
                client.recorded_ticks = update.recorded_ticks;
                saw_stage_end = true;
            }
        }
        if !saw_stage_end {
            tracing::warn!(%uuid, %client_id, ?stage, "client_missing_stage_metadata");
        }

        client
    }

    /// The status reported by the client.
    pub fn status(&self) -> StageStatus {
        self.status
    }

    /// The highest recorded tick in the client's events.
    pub fn final_tick(&self) -> u32 {
        self.recorded_ticks
    }
}

/// Processes a stage's events from its recorded streams.
pub async fn process(
    store: &Store,
    txn: &db::Transaction,
    challenge: &ChallengeInfo,
    uuid: Uuid,
    stage: Stage,
    attempt: Option<u32>,
) -> Result<ProcessingPayload, ProcessingError> {
    let stream = gather(store, uuid, stage, attempt).await?;

    // TODO(frolv): Move processing into a synchronous background thread.
    let clients = build_client_events(uuid, stage, stream);
    let result = interpret(&clients);

    persist(txn, challenge, result).await
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

/// Partitions a stream's records into per-client event streams and metadata.
fn build_client_events(
    uuid: Uuid,
    stage: Stage,
    records: Vec<ClientStageStream>,
) -> Vec<ClientEvents> {
    let mut partitions: BTreeMap<ClientId, Vec<ClientStageStream>> = BTreeMap::new();
    for record in records {
        partitions
            .entry(record.client_id())
            .or_default()
            .push(record);
    }

    partitions
        .into_iter()
        .map(|(client_id, records)| {
            ClientEvents::from_client_stream(uuid, stage, client_id, &records)
        })
        .collect()
}

/// A failure to interpret a stage's recorded data.
#[derive(Debug)]
enum InterpretError {
    /// The stage has no recorded data to process.
    NoData,
}

#[derive(Debug)]
struct ProcessingOutput {
    status: StageStatus,
    ticks: u32,
}

/// Processes a stage's raw events into a canonical record.
fn interpret(clients: &[ClientEvents]) -> Result<ProcessingOutput, InterpretError> {
    match clients.first() {
        Some(first) => Ok(ProcessingOutput {
            status: first.status(),
            ticks: first.final_tick(),
        }),
        None => Err(InterpretError::NoData),
    }
}

/// Writes a stage's processed results to the database and blob store.
/// Returns the payload to be sent back to the challenge.
async fn persist(
    txn: &db::Transaction,
    challenge: &ChallengeInfo,
    result: Result<ProcessingOutput, InterpretError>,
) -> Result<ProcessingPayload, ProcessingError> {
    let payload = payload_from(&result);

    if let Ok(output) = result {
        let total = (challenge.challenge_ticks + output.ticks).cast_signed();
        txn.execute(
            "UPDATE challenges SET challenge_ticks = $1 WHERE id = $2",
            &[&total, &txn.challenge_id()],
        )
        .await
        .map_err(db::Error::from)?;
    }

    Ok(payload)
}

fn payload_from(result: &Result<ProcessingOutput, InterpretError>) -> ProcessingPayload {
    match result {
        Ok(output) => ProcessingPayload::Stage {
            status: output.status,
            ticks: output.ticks,
        },
        // TODO(frolv): Handle errors.
        Err(InterpretError::NoData) => ProcessingPayload::None,
    }
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;

    use super::*;
    use crate::lifecycle::core::types::{ServerTicks, StageUpdate, UserId};

    fn test_uuid() -> Uuid {
        "a8cb035f-410a-45de-a4d3-2b0a5d8b464d".parse().unwrap()
    }

    fn metadata(client: i64) -> ClientStageStream {
        ClientStageStream::Metadata {
            client_id: ClientId(client),
            user_id: UserId(client * 10),
            plugin_version: "0.9.14".into(),
            runelite_version: "1.12.33".into(),
        }
    }

    fn events(client: i64) -> ClientStageStream {
        ClientStageStream::Events {
            client_id: ClientId(client),
            events: Bytes::from_static(b"batch"),
        }
    }

    fn end(client: i64, status: StageStatus, ticks: u32) -> ClientStageStream {
        ClientStageStream::End {
            client_id: ClientId(client),
            update: StageUpdate {
                stage: Stage::TobMaiden,
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

    fn clients_of(records: Vec<ClientStageStream>) -> Vec<ClientEvents> {
        build_client_events(test_uuid(), Stage::TobMaiden, records)
    }

    #[test]
    fn clients_partition_in_id_order() {
        let clients = clients_of(vec![
            metadata(2),
            metadata(1),
            events(1),
            end(1, StageStatus::Completed, 200),
            events(2),
            end(2, StageStatus::Wiped, 185),
        ]);
        let reports: Vec<(StageStatus, u32)> = clients
            .iter()
            .map(|client| (client.status(), client.final_tick()))
            .collect();
        assert_eq!(
            reports,
            vec![(StageStatus::Completed, 200), (StageStatus::Wiped, 185)],
        );
    }

    #[test]
    fn later_report_supersedes_an_earlier_one() {
        let clients = clients_of(vec![
            end(1, StageStatus::Wiped, 100),
            end(1, StageStatus::Completed, 190),
        ]);
        assert_eq!(clients.len(), 1);
        assert_eq!(clients[0].status(), StageStatus::Completed);
        assert_eq!(clients[0].final_tick(), 190);
    }

    #[test]
    fn client_without_a_report_returns_status_started() {
        let clients = clients_of(vec![metadata(1), events(1)]);
        assert_eq!(clients.len(), 1);
        assert_eq!(clients[0].status(), StageStatus::Started);
        assert_eq!(clients[0].final_tick(), 0);
    }

    #[test]
    fn empty_stream_yields_no_payload() {
        assert_eq!(payload_from(&interpret(&[])), ProcessingPayload::None);
    }
}

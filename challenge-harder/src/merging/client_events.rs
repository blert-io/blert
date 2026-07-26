//! Per-client stage event streams.

use std::collections::BTreeMap;

use prost::Message;

use crate::lifecycle::core::types::{
    ClientId, ClientStageStream, ServerTicks, Stage, StageStatus, Uuid,
};
use crate::proto::{ChallengeEvents, Event};

/// A client's recording of a stage.
#[derive(Debug)]
pub(super) struct ClientEvents {
    pub client_id: ClientId,
    pub status: StageStatus,
    pub accurate: bool,
    pub recorded_ticks: u32,
    pub server_ticks: Option<ServerTicks>,
    /// Events recorded by the client, in tick order.
    pub events: Vec<Event>,
}

impl ClientEvents {
    /// Initializes events for a client from its raw stage stream.
    fn from_client_stream(
        uuid: Uuid,
        stage: Stage,
        client_id: ClientId,
        records: Vec<ClientStageStream>,
    ) -> ClientEvents {
        let mut client = ClientEvents {
            client_id,
            status: StageStatus::Started,
            accurate: false,
            recorded_ticks: 0,
            server_ticks: None,
            events: Vec::new(),
        };

        let mut saw_stage_end = false;
        for record in records {
            match record {
                ClientStageStream::Metadata { .. } => {
                    // TODO(frolv): meat data
                }
                ClientStageStream::Events { events, .. } => match ChallengeEvents::decode(events) {
                    Ok(message) => client.events.extend(message.events),
                    Err(error) => {
                        tracing::error!(
                            %uuid,
                            %client_id,
                            ?stage,
                            %error,
                            "client_events_deserialization_failed",
                        );
                    }
                },
                ClientStageStream::End { update, .. } => {
                    client.status = update.status;
                    client.accurate = update.accurate;
                    client.recorded_ticks = update.recorded_ticks;
                    client.server_ticks = update.server_ticks;
                    saw_stage_end = true;
                }
            }
        }
        if !saw_stage_end {
            tracing::warn!(%uuid, %client_id, ?stage, "client_missing_stage_metadata");
        }

        client.events.sort_by_key(|event| event.tick);

        if client.recorded_ticks == 0
            && let Some(event) = client.events.last()
        {
            client.recorded_ticks = event.tick;
        }

        let recorded_ticks = client.recorded_ticks;
        let before = client.events.len();
        let end = client
            .events
            .iter()
            .rposition(|event| event.tick <= recorded_ticks)
            .map_or(0, |index| index + 1);
        client.events.truncate(end);
        let dropped = before - client.events.len();
        if dropped > 0 {
            tracing::warn!(
                %uuid,
                %client_id,
                ?stage,
                recorded_ticks,
                dropped_event_count = dropped,
                "client_events_beyond_recorded_ticks",
            );
        }

        client
    }
}

/// Partitions a stage stream's records into per-client events, ordered by
/// client ID.
pub(super) fn from_stage_stream(
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
            ClientEvents::from_client_stream(uuid, stage, client_id, records)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;

    use super::*;
    use crate::lifecycle::core::types::{StageUpdate, UserId};

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

    fn clients_of(records: Vec<ClientStageStream>) -> Vec<ClientEvents> {
        from_stage_stream(test_uuid(), Stage::MokhaiotlDelve1, records)
    }

    #[test]
    fn clients_partition_in_id_order() {
        let clients = clients_of(vec![
            metadata(2),
            metadata(1),
            events(1, &[0, 1]),
            end(1, StageStatus::Completed, 200),
            events(2, &[0]),
            end(2, StageStatus::Wiped, 185),
        ]);
        let reports: Vec<(ClientId, StageStatus, u32, usize)> = clients
            .iter()
            .map(|client| {
                (
                    client.client_id,
                    client.status,
                    client.recorded_ticks,
                    client.events.len(),
                )
            })
            .collect();
        assert_eq!(
            reports,
            vec![
                (ClientId(1), StageStatus::Completed, 200, 2),
                (ClientId(2), StageStatus::Wiped, 185, 1),
            ],
        );
    }

    #[test]
    fn a_later_report_supersedes_an_earlier_one() {
        let clients = clients_of(vec![
            end(1, StageStatus::Wiped, 100),
            end(1, StageStatus::Completed, 190),
        ]);
        assert_eq!(clients.len(), 1);
        assert_eq!(clients[0].status, StageStatus::Completed);
        assert_eq!(clients[0].recorded_ticks, 190);
    }

    #[test]
    fn clients_without_a_report_are_untrusted_with_backfilled_ticks() {
        let clients = clients_of(vec![metadata(1), events(1, &[0, 1, 5])]);
        assert_eq!(clients.len(), 1);
        assert_eq!(clients[0].status, StageStatus::Started);
        assert_eq!(clients[0].recorded_ticks, 5);
        assert!(!clients[0].accurate);
        assert_eq!(clients[0].server_ticks, None);
        assert_eq!(clients[0].events.len(), 3);
    }

    #[test]
    fn events_beyond_the_recorded_tick_count_are_dropped() {
        let clients = clients_of(vec![
            events(1, &[0, 3, 9, 12]),
            end(1, StageStatus::Completed, 3),
        ]);
        assert_eq!(clients.len(), 1);
        let client = &clients[0];
        assert_eq!(client.status, StageStatus::Completed);
        assert!(client.accurate);
        assert_eq!(client.recorded_ticks, 3);
        assert_eq!(
            client.server_ticks,
            Some(ServerTicks {
                count: 3,
                precise: true,
            }),
        );
        let ticks: Vec<u32> = client.events.iter().map(|event| event.tick).collect();
        assert_eq!(ticks, vec![0, 3]);
    }

    #[test]
    fn events_sort_by_tick_keeping_batch_order_within_ticks() {
        let batch = |coords: &[(u32, i32)]| {
            let message = ChallengeEvents {
                events: coords
                    .iter()
                    .map(|&(tick, x_coord)| Event {
                        tick,
                        x_coord,
                        ..Default::default()
                    })
                    .collect(),
                ..Default::default()
            };
            ClientStageStream::Events {
                client_id: ClientId(1),
                events: Bytes::from(message.encode_to_vec()),
            }
        };
        let clients = clients_of(vec![
            batch(&[(4, 1), (5, 2)]),
            batch(&[(0, 3), (4, 4)]),
            end(1, StageStatus::Completed, 6),
        ]);
        let order: Vec<(u32, i32)> = clients[0]
            .events
            .iter()
            .map(|event| (event.tick, event.x_coord))
            .collect();
        assert_eq!(order, vec![(0, 3), (4, 1), (4, 4), (5, 2)]);
    }

    #[test]
    fn a_malformed_batch_loses_only_its_own_events() {
        let clients = clients_of(vec![
            events(1, &[0, 1]),
            ClientStageStream::Events {
                client_id: ClientId(1),
                events: Bytes::from_static(b"\xff\xff\xff\xff"),
            },
            events(1, &[2]),
            end(1, StageStatus::Completed, 3),
        ]);
        assert_eq!(clients.len(), 1);
        let ticks: Vec<u32> = clients[0].events.iter().map(|event| event.tick).collect();
        assert_eq!(ticks, vec![0, 1, 2]);
        assert_eq!(clients[0].status, StageStatus::Completed);
    }
}

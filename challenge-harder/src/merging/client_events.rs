//! Per-client stage event streams.

use std::collections::{BTreeMap, HashSet};

use prost::Message;

use crate::lifecycle::core::types::{
    ClientId, ClientStageStream, ServerTicks, Stage, StageStatus, UserId,
};
use crate::proto::event::player::DataSource;
use crate::proto::{ChallengeEvents, Coords, event};

use super::ChallengeInfo;
use super::event::TaggedEvent;
use super::timeline::Timeline;

/// Stage-scoped data extracted from a client's raw events.
///
/// This data does not fit a per-client, per-tick merge model and is handled
/// separately at the end of the client merge process.
#[derive(Debug)]
pub(super) enum StageData {
    None,
    Sotetseg { pivots: Vec<SotePivots> },
}

impl StageData {
    pub(super) fn new(stage: Stage) -> Self {
        match stage {
            Stage::TobSotetseg => Self::Sotetseg { pivots: Vec::new() },
            _ => Self::None,
        }
    }
}

/// A pivot report from a client.
#[derive(Debug)]
pub(super) struct SotePivots {
    pub maze: event::sote_maze::Maze,
    pub overworld: Vec<Coords>,
    pub underworld: Vec<Coords>,
}

#[derive(Debug)]
pub(super) enum Anomaly {
    /// The client did not send their `STAGE_END` message.
    MissingStageMetadata,
    /// The client sent additional events beyond their reported tick count.
    EventsBeyondReportedTicks,
    /// The client recorded players outside the challenge party.
    UnknownPlayer,
    /// The client's events contain unprocessable data. The client should be ignored.
    BadData,
}

#[derive(Debug)]
#[expect(dead_code)]
pub(super) struct Metadata {
    pub user_id: UserId,
    pub plugin_version: String,
    pub runelite_version: String,
}

/// A client's recording of a stage.
#[derive(Debug)]
pub(super) struct ClientEvents {
    pub client_id: ClientId,
    pub metadata: Option<Metadata>,
    pub primary_player: Option<String>,
    pub status: StageStatus,
    pub accurate: bool,
    pub recorded_ticks: u32,
    pub server_ticks: Option<ServerTicks>,
    pub timeline: Timeline,
    pub stage_data: StageData,
    pub anomalies: Vec<Anomaly>,
}

impl ClientEvents {
    /// Initializes events for a client from its raw stage stream.
    fn from_client_stream(
        challenge: &ChallengeInfo,
        stage: Stage,
        client_id: ClientId,
        records: Vec<ClientStageStream>,
    ) -> ClientEvents {
        let mut client = ClientEvents {
            client_id,
            metadata: None,
            primary_player: None,
            status: StageStatus::Started,
            accurate: false,
            recorded_ticks: 0,
            server_ticks: None,
            timeline: Timeline::new(),
            stage_data: StageData::new(stage),
            anomalies: Vec::new(),
        };

        let mut raw_events: Vec<TaggedEvent> = Vec::new();
        let mut saw_stage_end = false;

        for record in records {
            match record {
                ClientStageStream::Metadata {
                    user_id,
                    plugin_version,
                    runelite_version,
                    ..
                } => {
                    client.metadata = Some(Metadata {
                        user_id,
                        plugin_version,
                        runelite_version,
                    });
                }
                ClientStageStream::Events { events, .. } => match ChallengeEvents::decode(events) {
                    Ok(message) => raw_events.extend(
                        message
                            .events
                            .into_iter()
                            .map(|event| TaggedEvent::new(client_id, event)),
                    ),
                    Err(error) => {
                        tracing::error!(
                            uuid = %challenge.uuid,
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
            client.anomalies.push(Anomaly::MissingStageMetadata);
            tracing::warn!(uuid = %challenge.uuid, %client_id, ?stage, "client_missing_stage_metadata");
        }

        raw_events.sort_unstable_by_key(|event| event.tick);

        if client.recorded_ticks == 0
            && let Some(event) = raw_events.last()
        {
            client.recorded_ticks = event.tick;
        }

        let cut = raw_events.partition_point(|event| event.tick <= client.recorded_ticks);
        let dropped = raw_events.len() - cut;
        raw_events.truncate(cut);

        if dropped > 0 {
            client.anomalies.push(Anomaly::EventsBeyondReportedTicks);
            tracing::warn!(
                uuid = %challenge.uuid,
                %client_id,
                ?stage,
                client.recorded_ticks,
                dropped_event_count = dropped,
                "client_events_beyond_reported_ticks",
            );
        }

        preprocess_events(&mut client, challenge, &mut raw_events);

        match Timeline::build(challenge.party, client.recorded_ticks, raw_events) {
            Ok(timeline) => client.timeline = timeline,
            Err(e) => {
                tracing::error!(uuid = %challenge.uuid, %client_id, ?stage, ?e, "client_events_timeline_build_failed");
                client.anomalies.push(Anomaly::BadData);
            }
        }

        Self::validate(&mut client, challenge, stage);

        client
    }

    fn validate(client: &mut ClientEvents, challenge: &ChallengeInfo, stage: Stage) {
        let derived_accurate = client
            .server_ticks
            .is_some_and(|st| st.precise && client.recorded_ticks == st.count);
        if client.accurate && !derived_accurate {
            tracing::warn!(
                uuid = %challenge.uuid,
                %client.client_id,
                ?stage,
                %client.recorded_ticks,
                server_tick_count = client.server_ticks.map(|st| st.count),
                precise = client.server_ticks.map(|st| st.precise),
                "client_reported_accuracy_demoted",
            );
        }

        // TODO(frolv): consistency check

        client.accurate &= derived_accurate;
    }
}

/// Partitions a stage stream's records into per-client events, ordered by
/// client ID.
pub(super) fn from_stage_stream(
    challenge: &ChallengeInfo,
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
            ClientEvents::from_client_stream(challenge, stage, client_id, records)
        })
        .collect()
}

/// Records the client's primary player and extracts its stage data.
fn preprocess_events(
    client: &mut ClientEvents,
    challenge: &ChallengeInfo,
    events: &mut Vec<TaggedEvent>,
) {
    let mut primary_players = HashSet::new();
    let mut unknown_players: BTreeMap<String, u32> = BTreeMap::new();

    events.retain_mut(|event| {
        let kind = event.r#type();
        if let Some(player) = event.player.as_mut() {
            if let Some(index) = challenge.party.iter().position(|name| name == &player.name) {
                player.party_index = u32::try_from(index).expect("party index fits in a u32");
            } else {
                *unknown_players.entry(player.name.clone()).or_default() += 1;
                return false;
            }

            if kind == event::Type::PlayerUpdate && player.data_source() == DataSource::Primary {
                primary_players.insert(player.name.clone());
            }
        }

        // A maze path without tiles is a pivot report.
        if kind == event::Type::TobSoteMazePath
            && let Some(maze) = event.sote_maze.as_mut()
            && maze.overworld_tiles.is_empty()
        {
            if let StageData::Sotetseg { pivots } = &mut client.stage_data
                && !(maze.overworld_pivots.is_empty() && maze.underworld_pivots.is_empty())
            {
                pivots.push(SotePivots {
                    maze: maze.maze(),
                    overworld: std::mem::take(&mut maze.overworld_pivots),
                    underworld: std::mem::take(&mut maze.underworld_pivots),
                });
            }
            return false;
        }

        true
    });

    if !unknown_players.is_empty() {
        tracing::error!(
            uuid = %challenge.uuid,
            client_id = %client.client_id,
            players = %serde_json::to_string(&unknown_players).expect("string map serializes"),
            "client_events_unknown_players",
        );
        client.anomalies.push(Anomaly::UnknownPlayer);
    }

    if primary_players.len() > 1 {
        tracing::error!(
            uuid = %challenge.uuid,
            client_id = %client.client_id,
            primary_players_count = primary_players.len(),
            "client_multiple_primary_players",
        );
        client.anomalies.push(Anomaly::BadData);
        return;
    }

    client.primary_player = primary_players.into_iter().next();
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;

    use super::*;
    use crate::lifecycle::core::types::{ChallengeMode, StageUpdate, UserId};
    use crate::merging::fixtures;

    fn test_challenge(stage: Stage) -> ChallengeInfo<'static> {
        static PARTY: std::sync::LazyLock<Vec<String>> =
            std::sync::LazyLock::new(|| vec!["1Ogp".to_string()]);
        fixtures::challenge_info(stage, ChallengeMode::TobRegular, &PARTY)
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
                .enumerate()
                .map(|(i, &tick)| {
                    let wave = u32::try_from(i).expect("small fixture") + 1;
                    fixtures::nylo_wave_event(event::Type::TobNyloWaveSpawn, tick, wave, 0, 12)
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
                stage: Stage::TobNylocas,
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
        let challenge = test_challenge(Stage::TobNylocas);
        from_stage_stream(&challenge, Stage::TobNylocas, records)
    }

    #[test]
    fn clients_partition_in_id_order() {
        let clients = clients_of(vec![
            metadata(2),
            metadata(1),
            events(1, &[4, 8]),
            end(1, StageStatus::Completed, 200),
            events(2, &[0]),
            end(2, StageStatus::Wiped, 185),
        ]);
        let challenge = test_challenge(Stage::TobNylocas);
        let ctx = fixtures::merge_context(&challenge, Stage::TobNylocas).build();
        let reports: Vec<(ClientId, StageStatus, u32, usize)> = clients
            .into_iter()
            .map(|client| {
                (
                    client.client_id,
                    client.status,
                    client.recorded_ticks,
                    client.timeline.finalize(&ctx).len(),
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
        let mut clients = clients_of(vec![metadata(1), events(1, &[4, 8, 12])]);
        assert_eq!(clients.len(), 1);
        let client = clients.remove(0);
        assert_eq!(client.status, StageStatus::Started);
        assert_eq!(client.recorded_ticks, 12);
        assert!(!client.accurate);
        assert_eq!(client.server_ticks, None);
        let challenge = test_challenge(Stage::TobNylocas);
        let ctx = fixtures::merge_context(&challenge, Stage::TobNylocas).build();
        assert_eq!(client.timeline.finalize(&ctx).len(), 3);
    }

    #[test]
    fn events_beyond_the_recorded_tick_count_are_dropped() {
        let mut clients = clients_of(vec![
            events(1, &[4, 8, 12, 16]),
            end(1, StageStatus::Completed, 8),
        ]);
        assert_eq!(clients.len(), 1);
        let client = clients.remove(0);
        assert_eq!(client.status, StageStatus::Completed);
        assert!(client.accurate);
        assert_eq!(client.recorded_ticks, 8);
        assert_eq!(
            client.server_ticks,
            Some(ServerTicks {
                count: 8,
                precise: true,
            }),
        );
        let challenge = test_challenge(Stage::TobNylocas);
        let ctx = fixtures::merge_context(&challenge, Stage::TobNylocas).build();
        let ticks: Vec<u32> = client
            .timeline
            .finalize(&ctx)
            .iter()
            .map(|event| event.tick)
            .collect();
        assert_eq!(ticks, vec![4, 8]);
    }

    #[test]
    fn events_sort_by_tick_across_batches() {
        let batch = |waves: &[(u32, u32)]| {
            let message = ChallengeEvents {
                events: waves
                    .iter()
                    .map(|&(tick, wave)| {
                        fixtures::nylo_wave_event(event::Type::TobNyloWaveSpawn, tick, wave, 0, 12)
                    })
                    .collect(),
                ..Default::default()
            };
            ClientStageStream::Events {
                client_id: ClientId(1),
                events: Bytes::from(message.encode_to_vec()),
            }
        };
        let mut clients = clients_of(vec![
            batch(&[(8, 2), (16, 4)]),
            batch(&[(4, 1), (12, 3)]),
            end(1, StageStatus::Completed, 16),
        ]);
        let challenge = test_challenge(Stage::TobNylocas);
        let ctx = fixtures::merge_context(&challenge, Stage::TobNylocas).build();
        let order: Vec<(u32, u32)> = clients
            .remove(0)
            .timeline
            .finalize(&ctx)
            .iter()
            .map(|event| (event.tick, event.nylo_wave.unwrap().wave))
            .collect();
        assert_eq!(order, vec![(4, 1), (8, 2), (12, 3), (16, 4)]);
    }

    #[test]
    fn a_malformed_batch_loses_only_its_own_events() {
        let mut clients = clients_of(vec![
            events(1, &[0, 1]),
            ClientStageStream::Events {
                client_id: ClientId(1),
                events: Bytes::from_static(b"\xff\xff\xff\xff"),
            },
            events(1, &[8]),
            end(1, StageStatus::Completed, 8),
        ]);
        assert_eq!(clients.len(), 1);
        let client = clients.remove(0);
        assert_eq!(client.status, StageStatus::Completed);
        let challenge = test_challenge(Stage::TobNylocas);
        let ctx = fixtures::merge_context(&challenge, Stage::TobNylocas).build();
        let ticks: Vec<u32> = client
            .timeline
            .finalize(&ctx)
            .iter()
            .map(|event| event.tick)
            .collect();
        assert_eq!(ticks, vec![0, 1, 8]);
    }

    #[test]
    fn a_client_with_malformed_events_is_bad_data() {
        let mut broken = fixtures::player_update_event(
            4,
            Stage::TobNylocas,
            (3296, 4249),
            "1Ogp",
            DataSource::Primary,
            &[],
            false,
        );
        broken.player = None;
        let message = ChallengeEvents {
            events: vec![broken],
            ..Default::default()
        };
        let clients = clients_of(vec![
            ClientStageStream::Events {
                client_id: ClientId(1),
                events: Bytes::from(message.encode_to_vec()),
            },
            end(1, StageStatus::Completed, 8),
        ]);
        assert_eq!(clients.len(), 1);
        assert!(matches!(clients[0].anomalies[..], [Anomaly::BadData]));
        assert_eq!(clients[0].timeline.tick_count(), 0);
    }

    #[test]
    fn sote_pivots_are_extracted_into_stage_data() {
        use event::sote_maze::Maze;
        use fixtures::SoteMazePath;

        let challenge = test_challenge(Stage::TobSotetseg);
        let mut events: Vec<TaggedEvent> = vec![
            fixtures::sote_maze_proc_event(106, Maze::Maze33),
            fixtures::sote_maze_path_event(
                112,
                Maze::Maze33,
                SoteMazePath::OverworldTiles(&[(7, 0)]),
            ),
            fixtures::sote_maze_path_event(
                124,
                Maze::Maze33,
                SoteMazePath::OverworldPivots(&[
                    (7, 0),
                    (10, 2),
                    (11, 4),
                    (12, 6),
                    (10, 8),
                    (9, 10),
                    (11, 12),
                    (12, 14),
                ]),
            ),
            fixtures::sote_maze_end_event(124, Maze::Maze33, Some("1Ogp")),
        ]
        .into_iter()
        .map(|event| TaggedEvent::new(ClientId(1), event))
        .collect();

        let mut client = ClientEvents {
            client_id: ClientId(1),
            metadata: None,
            primary_player: None,
            status: StageStatus::Completed,
            accurate: true,
            recorded_ticks: 169,
            server_ticks: None,
            timeline: Timeline::new(),
            stage_data: StageData::new(Stage::TobSotetseg),
            anomalies: Vec::new(),
        };
        preprocess_events(&mut client, &challenge, &mut events);

        let StageData::Sotetseg { pivots } = &client.stage_data else {
            panic!("sotetseg collects stage data");
        };
        assert_eq!(pivots.len(), 1);
        assert_eq!(pivots[0].maze, Maze::Maze33);
        assert!(pivots[0].underworld.is_empty());
        assert_eq!(
            pivots[0].overworld,
            vec![
                (7, 0).into(),
                (10, 2).into(),
                (11, 4).into(),
                (12, 6).into(),
                (10, 8).into(),
                (9, 10).into(),
                (11, 12).into(),
                (12, 14).into(),
            ],
        );

        let remaining: Vec<(u32, event::Type)> = events
            .iter()
            .map(|event| (event.tick, event.r#type()))
            .collect();
        assert_eq!(
            remaining,
            vec![
                (106, event::Type::TobSoteMazeProc),
                (112, event::Type::TobSoteMazePath),
                (124, event::Type::TobSoteMazeEnd),
            ],
        );
    }
}

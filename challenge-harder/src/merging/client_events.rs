//! Per-client stage event streams.

use std::collections::{BTreeMap, HashSet};

use prost::Message;

use crate::lifecycle::core::types::{
    ClientId, ClientStageStream, ServerTicks, Stage, StageStatus, UserId,
};
use crate::proto::event::player::DataSource;
use crate::proto::{ChallengeEvents, Coords, event};

use super::client_consistency::{self, ConsistencyIssue, MAX_RECORDED_TICK};
use super::event::TaggedEvent;
use super::timeline::Timeline;
use super::{BadData, ChallengeInfo, Tick};

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
    /// The client reported a tick count longer than any possible recording.
    InvalidTickCount,
    /// The client sent additional events beyond their reported tick count.
    EventsBeyondReportedTicks,
    /// The client recorded players outside the challenge party.
    UnknownPlayer,
}

#[derive(Debug)]
pub(super) struct PluginInfo {
    pub user_id: UserId,
    pub plugin_version: String,
    pub runelite_version: String,
}

/// A client's report of a how it recorded a stage.
#[derive(Debug)]
pub(super) struct ReportedInfo {
    pub id: ClientId,
    pub plugin_info: Option<PluginInfo>,
    pub primary_player: Option<String>,
    pub status: StageStatus,
    pub reported_accurate: bool,
    pub last_recorded_tick: Tick,
    pub server_ticks: Option<ServerTicks>,
}

/// A client's processed input into a merge.
#[derive(Debug)]
pub(super) struct ClientEvents {
    pub info: ReportedInfo,
    pub timeline: Timeline,
    pub accurate: bool,
    pub stage_data: StageData,
    pub anomalies: Vec<Anomaly>,
    pub consistency_issues: Vec<ConsistencyIssue>,
}

impl ClientEvents {
    #[inline]
    #[must_use]
    pub fn is_participant(&self) -> bool {
        self.info.primary_player.is_some()
    }

    #[inline]
    #[must_use]
    pub fn is_spectator(&self) -> bool {
        !self.is_participant()
    }

    /// Initializes events for a client from its raw stage stream.
    ///
    /// A fatally invalid stream returns the client's reported information
    /// alongside the error.
    #[expect(clippy::result_large_err)]
    fn from_client_stream(
        challenge: &ChallengeInfo,
        stage: Stage,
        id: ClientId,
        stream: Vec<ClientStageStream>,
    ) -> Result<ClientEvents, BadDataClient> {
        StreamParser::new(id, challenge, stage).parse(stream)
    }
}

/// Partitions a stage stream's records into per-client events, ordered by
/// client ID, returning both successfully parsed clients and invalid ones.
pub(super) fn from_stage_stream(
    challenge: &ChallengeInfo,
    stage: Stage,
    records: Vec<ClientStageStream>,
) -> (Vec<ClientEvents>, Vec<BadDataClient>) {
    let mut partitions: BTreeMap<ClientId, Vec<ClientStageStream>> = BTreeMap::new();
    for record in records {
        partitions
            .entry(record.client_id())
            .or_default()
            .push(record);
    }

    let mut clients = Vec::new();
    let mut bad_data_clients = Vec::new();
    for (client_id, records) in partitions {
        match ClientEvents::from_client_stream(challenge, stage, client_id, records) {
            Ok(client) => clients.push(client),
            Err(bad_data) => {
                tracing::error!(%client_id, error = %bad_data.error, "client_bad_data");
                bad_data_clients.push(bad_data);
            }
        }
    }
    (clients, bad_data_clients)
}

/// A client excluded from a merge for fatally invalid data.
#[derive(Debug)]
pub(super) struct BadDataClient {
    pub info: ReportedInfo,
    pub error: BadData,
}

#[derive(Debug)]
struct StreamParser<'a> {
    client_id: ClientId,
    challenge: &'a ChallengeInfo<'a>,
    stage: Stage,
    anomalies: Vec<Anomaly>,
    stage_data: StageData,
}

impl<'a> StreamParser<'a> {
    fn new(client_id: ClientId, challenge: &'a ChallengeInfo, stage: Stage) -> Self {
        Self {
            client_id,
            challenge,
            stage,
            anomalies: Vec::new(),
            stage_data: StageData::new(stage),
        }
    }

    #[expect(clippy::result_large_err, reason = "return client info")]
    fn parse(mut self, stream: Vec<ClientStageStream>) -> Result<ClientEvents, BadDataClient> {
        let (mut info, mut raw_events) = self.read_stage_stream(stream);

        if let Err(error) = self.check_tick_counts(&mut info) {
            return Err(BadDataClient { info, error });
        }
        info.primary_player = match self.preprocess_events(&mut raw_events) {
            Ok(primary_player) => primary_player,
            Err(error) => return Err(BadDataClient { info, error }),
        };

        let timeline =
            match Timeline::build(self.challenge.party, info.last_recorded_tick, raw_events) {
                Ok(timeline) => timeline,
                Err(error) => {
                    return Err(BadDataClient {
                        info,
                        error: error.into(),
                    });
                }
            };

        let consistency_issues =
            match client_consistency::check(self.challenge, self.stage, &timeline) {
                Ok(issues) => issues,
                Err(error) => return Err(BadDataClient { info, error }),
            };

        let derived_accurate = info
            .server_ticks
            .is_some_and(|st| st.precise && info.last_recorded_tick == Tick(st.count));
        if info.reported_accurate && !derived_accurate {
            tracing::warn!(
                client_id = %info.id,
                last_recorded_tick = %info.last_recorded_tick,
                server_tick_count = info.server_ticks.map(|st| st.count),
                precise = info.server_ticks.map(|st| st.precise),
                "client_reported_accuracy_demoted",
            );
        }
        let accurate = info.reported_accurate && derived_accurate && consistency_issues.is_empty();

        Ok(ClientEvents {
            info,
            timeline,
            accurate,
            stage_data: self.stage_data,
            anomalies: self.anomalies,
            consistency_issues,
        })
    }

    fn read_stage_stream(
        &mut self,
        stream: Vec<ClientStageStream>,
    ) -> (ReportedInfo, Vec<TaggedEvent>) {
        let mut raw_events: Vec<TaggedEvent> = Vec::new();
        let mut saw_stage_end = false;
        let mut info = ReportedInfo {
            id: self.client_id,
            plugin_info: None,
            primary_player: None,
            status: StageStatus::Started,
            reported_accurate: false,
            last_recorded_tick: Tick(0),
            server_ticks: None,
        };

        for record in stream {
            match record {
                ClientStageStream::Metadata {
                    user_id,
                    plugin_version,
                    runelite_version,
                    ..
                } => {
                    info.plugin_info = Some(PluginInfo {
                        user_id,
                        plugin_version,
                        runelite_version,
                    });
                }
                ClientStageStream::Events { events, .. } => match ChallengeEvents::decode(events) {
                    Ok(message) => {
                        raw_events.extend(
                            message
                                .events
                                .into_iter()
                                .map(|event| TaggedEvent::new(self.client_id, event)),
                        );
                    }
                    Err(error) => {
                        tracing::error!(
                            client_id = %self.client_id,
                            %error,
                            "client_events_deserialization_failed",
                        );
                    }
                },
                ClientStageStream::End { update, .. } => {
                    info.status = update.status;
                    info.reported_accurate = update.accurate;
                    info.last_recorded_tick = Tick(update.recorded_ticks);
                    info.server_ticks = update.server_ticks;
                    saw_stage_end = true;
                }
            }
        }
        if !saw_stage_end {
            self.anomalies.push(Anomaly::MissingStageMetadata);
            tracing::warn!(client_id = %self.client_id, "client_missing_stage_metadata");
        }

        raw_events.sort_unstable_by_key(|event| event.tick);

        if info.last_recorded_tick == Tick(0)
            && let Some(event) = raw_events.last()
        {
            info.last_recorded_tick = Tick(event.tick);
        }

        let cut = raw_events.partition_point(|event| Tick(event.tick) <= info.last_recorded_tick);
        let dropped = raw_events.len() - cut;
        raw_events.truncate(cut);

        if dropped > 0 {
            self.anomalies.push(Anomaly::EventsBeyondReportedTicks);
            tracing::warn!(
                client_id = %self.client_id,
                reported_ticks = %info.last_recorded_tick,
                dropped_event_count = dropped,
                "client_events_beyond_reported_ticks",
            );
        }

        (info, raw_events)
    }

    fn check_tick_counts(&mut self, info: &mut ReportedInfo) -> Result<(), BadData> {
        if info.last_recorded_tick > MAX_RECORDED_TICK {
            return Err(BadData::Inconsistent {
                tick: info.last_recorded_tick,
                message: "event beyond the maximum recordable tick".to_string(),
            });
        }
        if info.server_ticks.is_some_and(|st| st.count == 0) {
            return Err(BadData::InvalidServerTickCount);
        }

        let invalid_server = info
            .server_ticks
            .is_some_and(|st| Tick(st.count) > MAX_RECORDED_TICK);
        if invalid_server {
            tracing::warn!(
                client_id = %info.id,
                last_recorded_tick = %info.last_recorded_tick,
                server_tick_count = info.server_ticks.map(|st| st.count),
                "client_invalid_tick_count",
            );
            info.server_ticks = None;
            self.anomalies.push(Anomaly::InvalidTickCount);
        }

        Ok(())
    }

    /// Prepares the client's recorded events for merging, while extracting the
    /// client's primary player and stage data.
    fn preprocess_events(
        &mut self,
        events: &mut Vec<TaggedEvent>,
    ) -> Result<Option<String>, BadData> {
        let mut primary_players = HashSet::new();
        let mut unknown_players: BTreeMap<String, u32> = BTreeMap::new();

        events.retain_mut(|event| {
            let kind = event.r#type();
            if let Some(player) = event.player.as_mut() {
                if let Some(index) = self
                    .challenge
                    .party
                    .iter()
                    .position(|name| name == &player.name)
                {
                    player.party_index = u32::try_from(index).expect("party index fits in a u32");
                } else {
                    *unknown_players.entry(player.name.clone()).or_default() += 1;
                    return false;
                }

                if kind == event::Type::PlayerUpdate && player.data_source() == DataSource::Primary
                {
                    primary_players.insert(player.name.clone());
                }
            }

            // A maze path without tiles is a pivot report.
            if kind == event::Type::TobSoteMazePath
                && let Some(maze) = event.sote_maze.as_mut()
                && maze.overworld_tiles.is_empty()
            {
                if let StageData::Sotetseg { pivots } = &mut self.stage_data
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
                client_id = %self.client_id,
                players = %serde_json::to_string(&unknown_players).expect("string map serializes"),
                "client_events_unknown_players",
            );
            self.anomalies.push(Anomaly::UnknownPlayer);
        }

        if primary_players.len() > 1 {
            tracing::error!(
                client_id = %self.client_id,
                primary_players_count = primary_players.len(),
                "client_multiple_primary_players",
            );
            return Err(BadData::MultiplePrimaryPlayers);
        }

        Ok(primary_players.into_iter().next())
    }
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
                    fixtures::nylo_wave_event(
                        event::Type::TobNyloWaveSpawn,
                        Tick(tick),
                        wave,
                        0,
                        12,
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
        let (clients, bad_data_clients) = from_stage_stream(&challenge, Stage::TobNylocas, records);
        assert!(bad_data_clients.is_empty());
        clients
    }

    fn bad_clients_of(records: Vec<ClientStageStream>) -> Vec<BadDataClient> {
        let challenge = test_challenge(Stage::TobNylocas);
        let (clients, bad_data_clients) = from_stage_stream(&challenge, Stage::TobNylocas, records);
        assert!(clients.is_empty());
        bad_data_clients
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
        let ctx = fixtures::merge_context(&challenge, Stage::TobNylocas)
            .recording(true, Tick(200), vec![])
            .build();
        let reports: Vec<(ClientId, StageStatus, Tick, usize)> = clients
            .into_iter()
            .map(|client| {
                (
                    client.info.id,
                    client.info.status,
                    client.info.last_recorded_tick,
                    client.timeline.finalize(&ctx).len(),
                )
            })
            .collect();
        assert_eq!(
            reports,
            vec![
                (ClientId(1), StageStatus::Completed, Tick(200), 2),
                (ClientId(2), StageStatus::Wiped, Tick(185), 1),
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
        assert_eq!(clients[0].info.status, StageStatus::Completed);
        assert_eq!(clients[0].info.last_recorded_tick, Tick(190));
    }

    #[test]
    fn clients_without_a_report_are_untrusted_with_backfilled_ticks() {
        let mut clients = clients_of(vec![metadata(1), events(1, &[4, 8, 12])]);
        assert_eq!(clients.len(), 1);
        let client = clients.remove(0);
        assert_eq!(client.info.status, StageStatus::Started);
        assert_eq!(client.info.last_recorded_tick, Tick(12));
        assert!(!client.accurate);
        assert_eq!(client.info.server_ticks, None);
        assert_eq!(client.timeline.missing_tick_count(), 10);
        let challenge = test_challenge(Stage::TobNylocas);
        let ctx = fixtures::merge_context(&challenge, Stage::TobNylocas)
            .recording(true, Tick(12), vec![])
            .build();
        assert_eq!(client.timeline.finalize(&ctx).len(), 3);
    }

    #[test]
    fn an_invalid_reported_tick_count_is_bad_data() {
        let mut bad_data_clients = bad_clients_of(vec![
            events(1, &[4, 8]),
            end(1, StageStatus::Completed, 50_000),
        ]);
        assert_eq!(bad_data_clients.len(), 1);
        let BadDataClient { info, error } = bad_data_clients.remove(0);
        assert_eq!(
            error,
            BadData::Inconsistent {
                tick: Tick(50_000),
                message: "event beyond the maximum recordable tick".to_string(),
            },
        );
        assert_eq!(info.id, ClientId(1));
        assert_eq!(info.status, StageStatus::Completed);
        assert_eq!(info.last_recorded_tick, Tick(50_000));
        assert_eq!(
            info.server_ticks,
            Some(ServerTicks {
                count: 50_000,
                precise: true,
            }),
        );
    }

    #[test]
    fn an_invalid_server_tick_count_is_ignored() {
        let clients = clients_of(vec![
            events(1, &[4, 8]),
            ClientStageStream::End {
                client_id: ClientId(1),
                update: StageUpdate {
                    stage: Stage::TobNylocas,
                    status: StageStatus::Completed,
                    accurate: true,
                    recorded_ticks: 8,
                    server_ticks: Some(ServerTicks {
                        count: 40_000,
                        precise: true,
                    }),
                },
            },
        ]);
        assert_eq!(clients.len(), 1);
        let client = &clients[0];
        assert_eq!(client.info.last_recorded_tick, Tick(8));
        assert_eq!(client.info.server_ticks, None);
        assert!(!client.accurate);
        assert!(matches!(client.anomalies[..], [Anomaly::InvalidTickCount]));
    }

    #[test]
    fn a_zero_server_tick_count_is_bad_data() {
        let mut bad_data_clients = bad_clients_of(vec![
            events(1, &[4, 8]),
            ClientStageStream::End {
                client_id: ClientId(1),
                update: StageUpdate {
                    stage: Stage::TobNylocas,
                    status: StageStatus::Wiped,
                    accurate: false,
                    recorded_ticks: 10,
                    server_ticks: Some(ServerTicks {
                        count: 0,
                        precise: true,
                    }),
                },
            },
        ]);
        assert_eq!(bad_data_clients.len(), 1);
        let BadDataClient { info, error } = bad_data_clients.remove(0);
        assert_eq!(error, BadData::InvalidServerTickCount);
        assert_eq!(info.id, ClientId(1));
        assert_eq!(info.status, StageStatus::Wiped);
        assert_eq!(info.last_recorded_tick, Tick(10));
        assert_eq!(
            info.server_ticks,
            Some(ServerTicks {
                count: 0,
                precise: true,
            }),
        );
    }

    #[test]
    fn events_beyond_the_recorded_tick_count_are_dropped() {
        let mut clients = clients_of(vec![
            events(1, &[4, 8, 12, 16]),
            end(1, StageStatus::Completed, 8),
        ]);
        assert_eq!(clients.len(), 1);
        let client = clients.remove(0);
        assert_eq!(client.info.status, StageStatus::Completed);
        assert!(client.accurate);
        assert_eq!(client.info.last_recorded_tick, Tick(8));
        assert_eq!(
            client.info.server_ticks,
            Some(ServerTicks {
                count: 8,
                precise: true,
            }),
        );
        let challenge = test_challenge(Stage::TobNylocas);
        let ctx = fixtures::merge_context(&challenge, Stage::TobNylocas)
            .recording(true, Tick(8), vec![])
            .build();
        let ticks: Vec<u32> = client
            .timeline
            .finalize(&ctx)
            .iter()
            .map(|event| event.tick)
            .collect();
        assert_eq!(ticks, vec![4, 8]);
    }

    #[test]
    fn an_event_beyond_the_maximum_tick_is_bad_data() {
        let mut bad_data_clients = bad_clients_of(vec![events(1, &[4, 36_500])]);
        assert_eq!(bad_data_clients.len(), 1);
        let BadDataClient { info, error } = bad_data_clients.remove(0);
        assert_eq!(
            error,
            BadData::Inconsistent {
                tick: Tick(36_500),
                message: "event beyond the maximum recordable tick".to_string(),
            },
        );
        assert_eq!(info.id, ClientId(1));
        assert_eq!(info.status, StageStatus::Started);
        assert_eq!(info.last_recorded_tick, Tick(36_500));
    }

    #[test]
    fn events_sort_by_tick_across_batches() {
        let batch = |waves: &[(u32, u32)]| {
            let message = ChallengeEvents {
                events: waves
                    .iter()
                    .map(|&(tick, wave)| {
                        fixtures::nylo_wave_event(
                            event::Type::TobNyloWaveSpawn,
                            Tick(tick),
                            wave,
                            0,
                            12,
                        )
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
        let ctx = fixtures::merge_context(&challenge, Stage::TobNylocas)
            .recording(true, Tick(16), vec![])
            .build();
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
            events(1, &[4, 8]),
            ClientStageStream::Events {
                client_id: ClientId(1),
                events: Bytes::from_static(b"\xff\xff\xff\xff"),
            },
            ClientStageStream::Events {
                client_id: ClientId(1),
                events: Bytes::from(
                    ChallengeEvents {
                        events: vec![fixtures::nylo_wave_event(
                            event::Type::TobNyloWaveSpawn,
                            Tick(12),
                            3,
                            0,
                            12,
                        )],
                        ..Default::default()
                    }
                    .encode_to_vec(),
                ),
            },
            end(1, StageStatus::Completed, 12),
        ]);
        assert_eq!(clients.len(), 1);
        let client = clients.remove(0);
        assert_eq!(client.info.status, StageStatus::Completed);
        let challenge = test_challenge(Stage::TobNylocas);
        let ctx = fixtures::merge_context(&challenge, Stage::TobNylocas)
            .recording(true, Tick(12), vec![])
            .build();
        let ticks: Vec<u32> = client
            .timeline
            .finalize(&ctx)
            .iter()
            .map(|event| event.tick)
            .collect();
        assert_eq!(ticks, vec![4, 8, 12]);
    }

    #[test]
    fn a_client_with_malformed_events_is_bad_data() {
        let mut broken =
            fixtures::PlayerUpdateEvent::new(Tick(4), Stage::TobNylocas, "1Ogp", (3296, 4249))
                .build();
        broken.player = None;
        let message = ChallengeEvents {
            events: vec![broken],
            ..Default::default()
        };
        let mut bad_data_clients = bad_clients_of(vec![
            ClientStageStream::Events {
                client_id: ClientId(1),
                events: Bytes::from(message.encode_to_vec()),
            },
            end(1, StageStatus::Completed, 8),
        ]);
        assert_eq!(bad_data_clients.len(), 1);
        let BadDataClient { info, error } = bad_data_clients.remove(0);
        assert!(matches!(error, BadData::MalformedEvent(_)));
        assert_eq!(info.id, ClientId(1));
        assert_eq!(info.status, StageStatus::Completed);
        assert_eq!(info.last_recorded_tick, Tick(8));
    }

    #[test]
    fn consistency_issues_demote_client_accuracy() {
        let message = ChallengeEvents {
            events: vec![
                fixtures::PlayerUpdateEvent::new(Tick(4), Stage::TobNylocas, "1Ogp", (3296, 4249))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(5), Stage::TobNylocas, "1Ogp", (3306, 4249))
                    .build(),
            ],
            ..Default::default()
        };
        let mut clients = clients_of(vec![
            ClientStageStream::Events {
                client_id: ClientId(1),
                events: Bytes::from(message.encode_to_vec()),
            },
            end(1, StageStatus::Completed, 8),
        ]);
        assert_eq!(clients.len(), 1);
        let client = clients.remove(0);
        assert!(!client.accurate);
        assert_eq!(
            client.consistency_issues,
            vec![ConsistencyIssue::LargeJump {
                player: "1Ogp".to_string(),
                tick: Tick(5),
                last_tick: Tick(4),
                start: Coords { x: 3296, y: 4249 },
                end: Coords { x: 3306, y: 4249 },
            }],
        );
    }

    #[test]
    fn sote_pivots_are_extracted_into_stage_data() {
        use event::sote_maze::Maze;
        use fixtures::SoteMazePath;

        let challenge = test_challenge(Stage::TobSotetseg);
        let mut events: Vec<TaggedEvent> = vec![
            fixtures::sote_maze_proc_event(Tick(106), Maze::Maze33),
            fixtures::sote_maze_path_event(
                Tick(112),
                Maze::Maze33,
                SoteMazePath::OverworldTiles(&[(7, 0)]),
            ),
            fixtures::sote_maze_path_event(
                Tick(124),
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
            fixtures::sote_maze_end_event(Tick(124), Maze::Maze33, Some("1Ogp")),
        ]
        .into_iter()
        .map(|event| TaggedEvent::new(ClientId(1), event))
        .collect();

        let mut parser = StreamParser::new(ClientId(1), &challenge, Stage::TobSotetseg);
        parser.preprocess_events(&mut events).expect("good");

        let StageData::Sotetseg { pivots } = &parser.stage_data else {
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

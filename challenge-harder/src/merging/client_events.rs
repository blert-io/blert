//! Per-client stage event streams.

use std::collections::{BTreeMap, BTreeSet};

use blert::proto::Event;
use blert::{
    ConfigVersion, DataSource, FieldError, InvalidVersion, PartyIndex, PluginVersion, RawActor,
    Recording, RecordingBuilder, RejectionReason, Tick, WarningReason,
};
use prost::Message;

use crate::lifecycle::core::types::{
    ClientId, ClientStageStream, ServerTicks, Stage, StageStatus, UserId,
};
use crate::proto::ChallengeEvents;

use super::client_consistency::{self, ConsistencyIssue, MAX_RECORDED_TICK};
use super::{BadData, ChallengeInfo};

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
    AttacksOnCooldown,
}

#[derive(Debug)]
pub(super) struct PluginInfo {
    pub user_id: UserId,
    pub plugin_version: String,
    pub runelite_version: String,
    pub recording_config_version: Option<u32>,
}

/// A client's report of a how it recorded a stage.
#[derive(Debug)]
pub(super) struct ReportedInfo {
    pub id: ClientId,
    pub plugin_info: Option<PluginInfo>,
    pub primary_player: Option<PartyIndex>,
    pub status: StageStatus,
    pub reported_accurate: bool,
    pub last_recorded_tick: Tick,
    pub server_ticks: Option<ServerTicks>,
}

/// A client's processed input into a merge.
#[derive(Debug)]
pub(super) struct ClientEvents {
    pub info: ReportedInfo,
    pub recording: Recording,
    pub accurate: bool,
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
        challenge: &ChallengeInfo<'_>,
        stage: Stage,
        id: ClientId,
        stream: &[&ClientStageStream],
    ) -> Result<ClientEvents, BadDataClient> {
        StreamParser::new(id, challenge, stage).parse(stream)
    }
}

/// Partitions a stage stream's records into per-client events, ordered by
/// recording length, longest first, then client ID, returning both
/// successfully parsed clients and invalid ones.
pub(super) fn from_stage_stream(
    challenge: &ChallengeInfo<'_>,
    stage: Stage,
    records: &[ClientStageStream],
) -> (Vec<ClientEvents>, Vec<BadDataClient>) {
    let mut partitions: BTreeMap<ClientId, Vec<&ClientStageStream>> = BTreeMap::new();
    for record in records {
        partitions
            .entry(record.client_id())
            .or_default()
            .push(record);
    }

    let mut clients = Vec::new();
    let mut bad_data_clients = Vec::new();
    for (client_id, records) in partitions {
        match ClientEvents::from_client_stream(challenge, stage, client_id, &records) {
            Ok(client) => clients.push(client),
            Err(bad_data) => {
                tracing::error!(%client_id, error = %bad_data.error, "client_bad_data");
                bad_data_clients.push(bad_data);
            }
        }
    }
    clients.sort_by(|a, b| {
        b.info
            .last_recorded_tick
            .cmp(&a.info.last_recorded_tick)
            .then(a.info.id.cmp(&b.info.id))
    });
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
}

impl<'a> StreamParser<'a> {
    fn new(client_id: ClientId, challenge: &'a ChallengeInfo<'a>, stage: Stage) -> Self {
        Self {
            client_id,
            challenge,
            stage,
            anomalies: Vec::new(),
        }
    }

    #[expect(clippy::result_large_err, reason = "return client info")]
    fn parse(mut self, stream: &[&ClientStageStream]) -> Result<ClientEvents, BadDataClient> {
        let (mut info, raw_events) = self.read_stage_stream(stream);

        if let Err(error) = self.check_tick_counts(&mut info) {
            return Err(BadDataClient { info, error });
        }
        if !stream
            .iter()
            .any(|record| matches!(record, ClientStageStream::Events { .. }))
        {
            return Err(BadDataClient {
                info,
                error: BadData::NoRecording,
            });
        }
        let Some(plugin_version) = info
            .plugin_info
            .as_ref()
            .and_then(|plugin_info| plugin_info.plugin_version.parse::<PluginVersion>().ok())
        else {
            return Err(BadDataClient {
                info,
                error: BadData::InvalidPluginVersion,
            });
        };

        let mut builder = RecordingBuilder::new(
            self.client_id,
            plugin_version,
            self.config_version(&info),
            self.stage,
            self.challenge.mode,
            self.challenge.party.to_vec(),
            Some(info.last_recorded_tick),
        );
        builder.ingest(raw_events);
        if let Err(error) = self.check_rejections(&builder, &info) {
            return Err(BadDataClient { info, error });
        }
        let Some(recording) = builder.into_recording() else {
            return Err(BadDataClient {
                info,
                error: BadData::NoRecording,
            });
        };

        info.primary_player = match self.find_one_primary_player(&recording) {
            Ok(primary_player) => primary_player,
            Err(error) => return Err(BadDataClient { info, error }),
        };

        let consistency_issues = match client_consistency::check(&recording.snapshot()) {
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
            recording,
            accurate,
            anomalies: self.anomalies,
            consistency_issues,
        })
    }

    fn read_stage_stream(&mut self, stream: &[&ClientStageStream]) -> (ReportedInfo, Vec<Event>) {
        let mut raw_events: Vec<Event> = Vec::new();
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
                    recording_config_version,
                    ..
                } => {
                    let reported_version = info
                        .plugin_info
                        .as_ref()
                        .and_then(|plugin_info| plugin_info.recording_config_version);
                    info.plugin_info = Some(PluginInfo {
                        user_id: *user_id,
                        plugin_version: plugin_version.clone(),
                        runelite_version: runelite_version.clone(),
                        recording_config_version: recording_config_version.or(reported_version),
                    });
                }
                ClientStageStream::Events { events, .. } => {
                    match ChallengeEvents::decode(events.as_ref()) {
                        Ok(message) => raw_events.extend(message.events),
                        Err(error) => {
                            tracing::error!(
                                client_id = %self.client_id,
                                %error,
                                "client_events_deserialization_failed",
                            );
                        }
                    }
                }
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

        if info.last_recorded_tick == Tick(0)
            && let Some(last_tick) = raw_events.iter().map(|event| Tick(event.tick)).max()
        {
            info.last_recorded_tick = last_tick;
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

    fn config_version(&self, info: &ReportedInfo) -> ConfigVersion {
        let Some(version) = info
            .plugin_info
            .as_ref()
            .and_then(|plugin_info| plugin_info.recording_config_version)
        else {
            return ConfigVersion::LATEST;
        };
        ConfigVersion::parse(version).unwrap_or_else(|InvalidVersion(version)| {
            tracing::warn!(
                client_id = %self.client_id,
                version,
                "client_unsupported_recording_config_version",
            );
            ConfigVersion::LATEST
        })
    }

    fn check_rejections(
        &mut self,
        builder: &RecordingBuilder,
        info: &ReportedInfo,
    ) -> Result<(), BadData> {
        let mut unknown_players: BTreeMap<&str, u32> = BTreeMap::new();
        let mut beyond_last_tick = 0;

        for rejection in builder.rejections() {
            match &rejection.reason {
                RejectionReason::InvalidField {
                    error: FieldError::UnknownActor(RawActor::Player(name)),
                    ..
                } => *unknown_players.entry(name).or_default() += 1,
                RejectionReason::BeyondLastTick => beyond_last_tick += 1,
                RejectionReason::InvalidField {
                    error: FieldError::UnknownActor(RawActor::Npc(_)),
                    ..
                }
                | RejectionReason::AttackNotFound => {}
                RejectionReason::UnknownType(_)
                | RejectionReason::WrongStage(_)
                | RejectionReason::MissingPayload(_)
                | RejectionReason::InvalidField { .. }
                | RejectionReason::Inconsistent(_)
                | RejectionReason::UniqueViolation => {
                    return Err(BadData::RejectedEvent(rejection.clone()));
                }
            }
        }
        let mut on_cooldown = 0;
        let mut first_on_cooldown = None;
        for warning in builder.warnings() {
            match &warning.reason {
                WarningReason::InvalidField {
                    error: FieldError::UnknownActor(RawActor::Player(name)),
                    ..
                } => *unknown_players.entry(name).or_default() += 1,
                WarningReason::OnCooldown => {
                    on_cooldown += 1;
                    first_on_cooldown.get_or_insert(warning.tick);
                }
                WarningReason::InvalidField { .. } => {}
            }
        }

        if beyond_last_tick > 0 {
            self.anomalies.push(Anomaly::EventsBeyondReportedTicks);
            tracing::warn!(
                client_id = %self.client_id,
                reported_ticks = %info.last_recorded_tick,
                dropped_event_count = beyond_last_tick,
                "client_events_beyond_reported_ticks",
            );
        }

        if let Some(first_tick) = first_on_cooldown {
            self.anomalies.push(Anomaly::AttacksOnCooldown);
            tracing::warn!(
                client_id = %self.client_id,
                dropped_attack_count = on_cooldown,
                first_tick = first_tick.0,
                "client_attacks_on_cooldown",
            );
        }

        if !unknown_players.is_empty() {
            tracing::error!(
                client_id = %self.client_id,
                players = %serde_json::to_string(&unknown_players).expect("string map serializes"),
                "client_events_unknown_players",
            );
            self.anomalies.push(Anomaly::UnknownPlayer);
        }

        Ok(())
    }

    fn find_one_primary_player(
        &self,
        recording: &Recording,
    ) -> Result<Option<PartyIndex>, BadData> {
        let primary_players: BTreeSet<PartyIndex> = recording
            .states()
            .flat_map(|(_, state)| state.players.iter())
            .filter(|(_, player)| matches!(player.data, DataSource::Primary(_)))
            .map(|(index, _)| index)
            .collect();

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
    use blert::proto::event;
    use blert::{BuildRejection, EventKind, NyloWave, Point, Rsn};
    use bytes::Bytes;

    use super::*;
    use crate::lifecycle::core::types::{ChallengeMode, StageUpdate, UserId};
    use crate::merging::fixtures;

    fn test_challenge(stage: Stage) -> ChallengeInfo<'static> {
        static PARTY: std::sync::LazyLock<Vec<Rsn>> =
            std::sync::LazyLock::new(|| vec![Rsn::try_from("1Ogp").unwrap()]);
        fixtures::challenge_info(stage, ChallengeMode::TobRegular, &PARTY)
    }

    fn metadata(client: u32) -> ClientStageStream {
        ClientStageStream::Metadata {
            client_id: ClientId(client),
            user_id: UserId(i64::from(client) * 10),
            plugin_version: "0.9.14".into(),
            runelite_version: "1.12.33".into(),
            recording_config_version: None,
        }
    }

    fn events(client: u32, ticks: &[u32]) -> ClientStageStream {
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

    fn end(client: u32, status: StageStatus, ticks: u32) -> ClientStageStream {
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
                overall_ticks: None,
            },
        }
    }

    #[test]
    fn clients_partition_longest_recording_first_then_by_id() {
        let challenge = test_challenge(Stage::TobNylocas);
        let (clients, bad_data_clients) = from_stage_stream(
            &challenge,
            Stage::TobNylocas,
            &[
                metadata(2),
                metadata(1),
                events(1, &[4, 8]),
                end(1, StageStatus::Completed, 185),
                events(2, &[0]),
                end(2, StageStatus::Wiped, 200),
                metadata(3),
                events(3, &[0]),
                end(3, StageStatus::Wiped, 200),
            ],
        );
        assert!(bad_data_clients.is_empty());
        let reports: Vec<(ClientId, StageStatus, Tick, usize)> = clients
            .into_iter()
            .map(|client| {
                (
                    client.info.id,
                    client.info.status,
                    client.info.last_recorded_tick,
                    client
                        .recording
                        .states()
                        .map(|(_, state)| state.events.len())
                        .sum(),
                )
            })
            .collect();
        assert_eq!(
            reports,
            vec![
                (ClientId(2), StageStatus::Wiped, Tick(200), 1),
                (ClientId(3), StageStatus::Wiped, Tick(200), 1),
                (ClientId(1), StageStatus::Completed, Tick(185), 2),
            ],
        );
    }

    #[test]
    fn a_later_report_supersedes_an_earlier_one() {
        let challenge = test_challenge(Stage::TobNylocas);
        let (clients, bad_data_clients) = from_stage_stream(
            &challenge,
            Stage::TobNylocas,
            &[
                metadata(1),
                events(1, &[4, 8]),
                end(1, StageStatus::Wiped, 100),
                end(1, StageStatus::Completed, 190),
            ],
        );
        assert!(bad_data_clients.is_empty());
        assert_eq!(clients.len(), 1);
        assert_eq!(clients[0].info.status, StageStatus::Completed);
        assert_eq!(clients[0].info.last_recorded_tick, Tick(190));
    }

    #[test]
    fn metadata_without_config_version_keeps_previously_reported_version() {
        let challenge = test_challenge(Stage::TobNylocas);
        let (clients, bad_data_clients) = from_stage_stream(
            &challenge,
            Stage::TobNylocas,
            &[
                ClientStageStream::Metadata {
                    client_id: ClientId(1),
                    user_id: UserId(10),
                    plugin_version: "0.9.24".into(),
                    runelite_version: "1.13.1".into(),
                    recording_config_version: Some(3),
                },
                events(1, &[4, 9]),
                metadata(1),
                end(1, StageStatus::Completed, 120),
            ],
        );
        assert!(bad_data_clients.is_empty());
        assert_eq!(clients.len(), 1);
        assert_eq!(
            clients[0]
                .info
                .plugin_info
                .as_ref()
                .and_then(|plugin_info| plugin_info.recording_config_version),
            Some(3),
        );
    }

    #[test]
    fn metadata_with_recording_config_version_fills_in_previous_missing_version() {
        let challenge = test_challenge(Stage::TobNylocas);
        let (clients, bad_data_clients) = from_stage_stream(
            &challenge,
            Stage::TobNylocas,
            &[
                metadata(1),
                events(1, &[6, 11]),
                ClientStageStream::Metadata {
                    client_id: ClientId(1),
                    user_id: UserId(10),
                    plugin_version: "0.9.24".into(),
                    runelite_version: "1.13.1".into(),
                    recording_config_version: Some(5),
                },
                end(1, StageStatus::Completed, 140),
            ],
        );
        assert!(bad_data_clients.is_empty());
        assert_eq!(clients.len(), 1);
        assert_eq!(
            clients[0]
                .info
                .plugin_info
                .as_ref()
                .and_then(|plugin_info| plugin_info.recording_config_version),
            Some(5),
        );
    }

    #[test]
    fn clients_without_a_report_are_untrusted_with_backfilled_ticks() {
        let challenge = test_challenge(Stage::TobNylocas);
        let (mut clients, bad_data_clients) = from_stage_stream(
            &challenge,
            Stage::TobNylocas,
            &[metadata(1), events(1, &[4, 8, 12])],
        );
        assert!(bad_data_clients.is_empty());
        assert_eq!(clients.len(), 1);
        let client = clients.remove(0);
        assert_eq!(client.info.status, StageStatus::Started);
        assert_eq!(client.info.last_recorded_tick, Tick(12));
        assert!(!client.accurate);
        assert_eq!(client.info.server_ticks, None);
        assert_eq!(client.recording.last_tick(), Tick(12));
        assert_eq!(
            client
                .recording
                .states()
                .map(|(tick, _)| tick)
                .collect::<Vec<_>>(),
            vec![Tick(4), Tick(8), Tick(12)],
        );
    }

    #[test]
    fn an_invalid_reported_tick_count_is_bad_data() {
        let challenge = test_challenge(Stage::TobNylocas);
        let (clients, mut bad_data_clients) = from_stage_stream(
            &challenge,
            Stage::TobNylocas,
            &[events(1, &[4, 8]), end(1, StageStatus::Completed, 50_000)],
        );
        assert!(clients.is_empty());
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
        let challenge = test_challenge(Stage::TobNylocas);
        let (clients, bad_data_clients) = from_stage_stream(
            &challenge,
            Stage::TobNylocas,
            &[
                metadata(1),
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
                        overall_ticks: None,
                    },
                },
            ],
        );
        assert!(bad_data_clients.is_empty());
        assert_eq!(clients.len(), 1);
        let client = &clients[0];
        assert_eq!(client.info.last_recorded_tick, Tick(8));
        assert_eq!(client.info.server_ticks, None);
        assert!(!client.accurate);
        assert!(matches!(client.anomalies[..], [Anomaly::InvalidTickCount]));
    }

    #[test]
    fn a_zero_server_tick_count_is_bad_data() {
        let challenge = test_challenge(Stage::TobNylocas);
        let (clients, mut bad_data_clients) = from_stage_stream(
            &challenge,
            Stage::TobNylocas,
            &[
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
                        overall_ticks: None,
                    },
                },
            ],
        );
        assert!(clients.is_empty());
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
        let challenge = test_challenge(Stage::TobNylocas);
        let (mut clients, bad_data_clients) = from_stage_stream(
            &challenge,
            Stage::TobNylocas,
            &[
                metadata(1),
                events(1, &[4, 8, 12, 16]),
                end(1, StageStatus::Completed, 8),
            ],
        );
        assert!(bad_data_clients.is_empty());
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
        assert!(matches!(
            client.anomalies[..],
            [Anomaly::EventsBeyondReportedTicks]
        ));
        assert_eq!(
            client
                .recording
                .states()
                .map(|(tick, _)| tick)
                .collect::<Vec<_>>(),
            vec![Tick(4), Tick(8)],
        );
    }

    #[test]
    fn an_event_beyond_the_maximum_tick_is_bad_data() {
        let challenge = test_challenge(Stage::TobNylocas);
        let (clients, mut bad_data_clients) =
            from_stage_stream(&challenge, Stage::TobNylocas, &[events(1, &[4, 36_500])]);
        assert!(clients.is_empty());
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
        let challenge = test_challenge(Stage::TobNylocas);
        let (mut clients, bad_data_clients) = from_stage_stream(
            &challenge,
            Stage::TobNylocas,
            &[
                metadata(1),
                batch(&[(8, 2), (16, 4)]),
                batch(&[(4, 1), (12, 3)]),
                end(1, StageStatus::Completed, 16),
            ],
        );
        assert!(bad_data_clients.is_empty());
        let order: Vec<(Tick, EventKind)> = clients
            .remove(0)
            .recording
            .states()
            .flat_map(|(tick, state)| {
                state
                    .events
                    .iter()
                    .map(move |event| (tick, event.kind.clone()))
            })
            .collect();
        let spawn = |wave| {
            EventKind::NyloWaveSpawn(NyloWave {
                wave,
                nylos_alive: 0,
            })
        };
        assert_eq!(
            order,
            vec![
                (Tick(4), spawn(1)),
                (Tick(8), spawn(2)),
                (Tick(12), spawn(3)),
                (Tick(16), spawn(4)),
            ],
        );
    }

    #[test]
    fn a_malformed_batch_loses_only_its_own_events() {
        let challenge = test_challenge(Stage::TobNylocas);
        let (mut clients, bad_data_clients) = from_stage_stream(
            &challenge,
            Stage::TobNylocas,
            &[
                metadata(1),
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
            ],
        );
        assert!(bad_data_clients.is_empty());
        assert_eq!(clients.len(), 1);
        let client = clients.remove(0);
        assert_eq!(client.info.status, StageStatus::Completed);
        assert_eq!(
            client
                .recording
                .states()
                .map(|(tick, _)| tick)
                .collect::<Vec<_>>(),
            vec![Tick(4), Tick(8), Tick(12)],
        );
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
        let challenge = test_challenge(Stage::TobNylocas);
        let (clients, mut bad_data_clients) = from_stage_stream(
            &challenge,
            Stage::TobNylocas,
            &[
                metadata(1),
                ClientStageStream::Events {
                    client_id: ClientId(1),
                    events: Bytes::from(message.encode_to_vec()),
                },
                end(1, StageStatus::Completed, 8),
            ],
        );
        assert!(clients.is_empty());
        assert_eq!(bad_data_clients.len(), 1);
        let BadDataClient { info, error } = bad_data_clients.remove(0);
        assert_eq!(
            error,
            BadData::RejectedEvent(BuildRejection {
                tick: Tick(4),
                kind: event::Type::PlayerUpdate,
                reason: RejectionReason::MissingPayload("player"),
            }),
        );
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
        let challenge = test_challenge(Stage::TobNylocas);
        let (mut clients, bad_data_clients) = from_stage_stream(
            &challenge,
            Stage::TobNylocas,
            &[
                metadata(1),
                ClientStageStream::Events {
                    client_id: ClientId(1),
                    events: Bytes::from(message.encode_to_vec()),
                },
                end(1, StageStatus::Completed, 8),
            ],
        );
        assert!(bad_data_clients.is_empty());
        assert_eq!(clients.len(), 1);
        let client = clients.remove(0);
        assert!(!client.accurate);
        assert_eq!(
            client.consistency_issues,
            vec![ConsistencyIssue::LargeJump {
                player: client
                    .recording
                    .party_index(&Rsn::try_from("1Ogp").unwrap())
                    .unwrap(),
                tick: Tick(5),
                last_tick: Tick(4),
                start: Point(3296, 4249),
                end: Point(3306, 4249),
            }],
        );
    }

    #[test]
    fn unknown_action_targets_are_cleared_and_flagged() {
        let message = ChallengeEvents {
            events: vec![
                fixtures::PlayerUpdateEvent::new(Tick(4), Stage::TobMaiden, "1Ogp", (0, 0)).build(),
                fixtures::npc_update_event(fixtures::NpcEvent {
                    tick: Tick(4),
                    stage: Stage::TobMaiden,
                    npc_id: 8360,
                    room_id: 1001,
                    ..Default::default()
                }),
                fixtures::npc_attack_event(
                    Tick(4),
                    Stage::TobMaiden,
                    (0, 0),
                    8360,
                    1001,
                    blert::NpcAttack::TobMaidenAuto,
                    Some("aSaradomin"),
                ),
                fixtures::player_spell_event(
                    Tick(4),
                    Stage::TobMaiden,
                    (0, 0),
                    "1Ogp",
                    blert::PlayerSpell::HealOther,
                    Some(event::spell::Target::TargetPlayer("aSaradomin".to_string())),
                ),
            ],
            ..Default::default()
        };
        let challenge = test_challenge(Stage::TobMaiden);
        let (mut clients, bad_data_clients) = from_stage_stream(
            &challenge,
            Stage::TobMaiden,
            &[
                metadata(1),
                ClientStageStream::Events {
                    client_id: ClientId(1),
                    events: Bytes::from(message.encode_to_vec()),
                },
                end(1, StageStatus::Completed, 8),
            ],
        );
        assert!(bad_data_clients.is_empty());
        assert_eq!(clients.len(), 1);
        let client = clients.remove(0);
        assert!(matches!(client.anomalies[..], [Anomaly::UnknownPlayer]));
        let targets: Vec<_> = client
            .recording
            .events_for_tick(Tick(4))
            .filter_map(|event| match &event.kind {
                EventKind::NpcAttack(attack) => Some(attack.target),
                EventKind::PlayerSpell(cast) => Some(cast.target),
                _ => None,
            })
            .collect();
        assert_eq!(targets, vec![None, None]);
    }

    #[test]
    fn attacks_on_cooldown_are_dropped_and_flagged() {
        let message = ChallengeEvents {
            events: vec![
                fixtures::PlayerUpdateEvent::new(Tick(4), Stage::TobMaiden, "1Ogp", (0, 0)).build(),
                fixtures::player_attack_event(fixtures::PlayerAttackEvent {
                    tick: Tick(4),
                    stage: Stage::TobMaiden,
                    coords: (0, 0),
                    name: "1Ogp",
                    party_index: None,
                    attack: blert::PlayerAttack::TwistedBow,
                    weapon_id: 0,
                    distance_to_target: 7,
                    target: None,
                }),
                fixtures::PlayerUpdateEvent::new(Tick(6), Stage::TobMaiden, "1Ogp", (0, 0)).build(),
                fixtures::player_attack_event(fixtures::PlayerAttackEvent {
                    tick: Tick(6),
                    stage: Stage::TobMaiden,
                    coords: (0, 0),
                    name: "1Ogp",
                    party_index: None,
                    attack: blert::PlayerAttack::TwistedBow,
                    weapon_id: 0,
                    distance_to_target: 7,
                    target: None,
                }),
            ],
            ..Default::default()
        };
        let challenge = test_challenge(Stage::TobMaiden);
        let (mut clients, bad_data_clients) = from_stage_stream(
            &challenge,
            Stage::TobMaiden,
            &[
                metadata(1),
                ClientStageStream::Events {
                    client_id: ClientId(1),
                    events: Bytes::from(message.encode_to_vec()),
                },
                end(1, StageStatus::Completed, 8),
            ],
        );
        assert!(bad_data_clients.is_empty());
        assert_eq!(clients.len(), 1);
        let client = clients.remove(0);
        assert!(matches!(client.anomalies[..], [Anomaly::AttacksOnCooldown]));
        let attack_ticks: Vec<_> = client
            .recording
            .states()
            .filter(|(_, state)| {
                state
                    .events
                    .iter()
                    .any(|event| matches!(event.kind, EventKind::PlayerAttack(_)))
            })
            .map(|(tick, _)| tick)
            .collect();
        assert_eq!(attack_ticks, vec![Tick(4)]);
    }
}

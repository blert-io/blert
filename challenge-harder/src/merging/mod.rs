//! Stage event merging.
//!
//! Combines the event streams recorded by a stage's clients into a single
//! canonical timeline for challenge processing to consume.

// TODO(frolv): Remove once the container's full API has consumers.
#![cfg_attr(not(test), expect(dead_code))]

pub mod capture;
mod classification;
mod client_consistency;
mod client_events;
mod derivation;
mod event;
#[cfg(test)]
pub(crate) mod fixtures;
mod similarity;
mod timeline;
mod trace;
mod world;

use classification::classify_clients;
use client_consistency::ConsistencyIssue;
use client_events::ClientEvents;
use event::MalformedEvent;

use crate::lifecycle::core::types::{
    ChallengeMode, ChallengeType, ClientId, ClientStageStream, ServerTicks, Stage, StageStatus,
    Uuid,
};
pub use crate::merging::classification::{ReferenceMethod, ReferenceTicks};
pub use crate::merging::trace::Tracer;
use crate::proto::Event;

/// A notable condition encountered while merging a stage's clients.
#[derive(Debug, PartialEq, Eq)]
pub enum MergeAlert {
    /// Clients sent conflicting server tick counts.
    MultipleServerTickCounts {
        precise: bool,
        tick_counts: Vec<u32>,
    },
    /// The timeline was shifted forward to fit a reference tick count.
    TimelineOffsetApplied { offset: u32 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Classification {
    Reference,
    Matching,
    Mismatched,
}

/// How a client in a merge was processed.
#[derive(Debug, PartialEq, Eq)]
pub enum MergeStatus {
    Merged(Classification),
    Unmerged(Classification),
    Skipped(BadData),
}

/// The result of a client within a merge run.
#[derive(Debug, PartialEq, Eq)]
pub struct ClientOutcome {
    pub client_id: ClientId,
    pub primary_player: Option<String>,
    pub stage_status: StageStatus,
    pub accurate: bool,
    pub recorded_ticks: u32,
    pub server_ticks: Option<ServerTicks>,
    pub consistency_issues: Vec<ConsistencyIssue>,
    pub status: MergeStatus,
}

impl ClientOutcome {
    fn new(client: &ClientEvents, status: MergeStatus) -> ClientOutcome {
        ClientOutcome {
            client_id: client.client_id,
            primary_player: client.primary_player.clone(),
            stage_status: client.status,
            accurate: client.accurate,
            recorded_ticks: client.recorded_ticks,
            server_ticks: client.server_ticks,
            consistency_issues: client.consistency_issues.clone(),
            status,
        }
    }
}

/// A summary of what occurred during a merge run.
#[derive(Debug, PartialEq, Eq)]
pub struct MergeReport {
    pub alerts: Vec<MergeAlert>,
    pub reference_ticks: Option<ReferenceTicks>,
    pub clients: Vec<ClientOutcome>,
    pub merged_count: usize,
    pub unmerged_count: usize,
    pub skipped_count: usize,
}

impl MergeReport {
    /// Creates a report for a merge that skipped every client.
    fn empty(clients: Vec<ClientOutcome>) -> MergeReport {
        let skipped_count = clients.len();
        MergeReport {
            alerts: Vec::new(),
            reference_ticks: None,
            clients,
            merged_count: 0,
            unmerged_count: 0,
            skipped_count,
        }
    }
}

/// Challenge context for a merge.
#[derive(Debug, Clone)]
pub struct ChallengeInfo<'a> {
    pub uuid: Uuid,
    pub challenge_type: ChallengeType,
    pub mode: ChallengeMode,
    pub party: &'a [String],
}

/// Fatally invalid client input data.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum BadData {
    #[error(transparent)]
    MalformedEvent(#[from] MalformedEvent),
    #[error("tick {tick}: {message}")]
    Inconsistent { tick: u32, message: String },
    #[error("multiple primary players")]
    MultiplePrimaryPlayers,
    #[error("invalid server tick count")]
    InvalidServerTickCount,
}

/// The state of an in-progress merge.
#[derive(Debug)]
struct MergeContext<'a> {
    challenge: &'a ChallengeInfo<'a>,
    stage: Stage,
    clients: Vec<ClientEvents>,
}

/// Merges the events recorded by a stage's clients into a canonical timeline.
/// Returns the merged timeline, if created, alongside a report of what happened.
pub fn merge(
    challenge: &ChallengeInfo<'_>,
    stage: Stage,
    records: Vec<ClientStageStream>,
    mut tracer: Option<&mut Tracer>,
) -> (Option<MergedEvents>, MergeReport) {
    let _span = tracing::info_span!("merge", uuid = %challenge.uuid, ?stage).entered();

    let (mut clients, bad_data_clients) =
        client_events::from_stage_stream(challenge, stage, records);

    if let Some(tracer) = tracer.as_deref_mut() {
        for client in &clients {
            tracer.record_input_client(client);
        }
        for client in &bad_data_clients {
            tracer.record_input_client(&client.client);
        }
    }

    let mut outcomes: Vec<ClientOutcome> = Vec::new();
    for client in bad_data_clients {
        outcomes.push(ClientOutcome::new(
            &client.client,
            MergeStatus::Skipped(client.error),
        ));
    }

    if clients.is_empty() {
        return (None, MergeReport::empty(outcomes));
    }

    let mut alerts = Vec::new();

    let classification = classify_clients(&mut clients);

    if let Some(tracer) = tracer {
        tracer.record_classification(&classification, &clients);
    }

    alerts.extend(classification.alert);

    let ctx = MergeContext {
        challenge,
        stage,
        clients,
    };

    let mut timeline = ctx.clients[classification.base].timeline.clone();
    outcomes.push(ClientOutcome::new(
        &ctx.clients[classification.base],
        MergeStatus::Merged(Classification::Reference),
    ));

    // TODO(frolv): port merging of matching and mismatched clients.
    for client in classification.matching {
        outcomes.push(ClientOutcome::new(
            &ctx.clients[client],
            MergeStatus::Unmerged(Classification::Matching),
        ));
    }
    for client in classification.mismatched {
        outcomes.push(ClientOutcome::new(
            &ctx.clients[client],
            MergeStatus::Unmerged(Classification::Mismatched),
        ));
    }

    let reference = &classification.reference_ticks;

    let offset = end_align_to_reference(&mut timeline, reference, &outcomes);
    if offset > 0 {
        alerts.push(MergeAlert::TimelineOffsetApplied { offset });
    }

    let last_tick = timeline.last_tick().unwrap_or(0);
    let missing_tick_count = timeline.missing_tick_count();
    let events = timeline.finalize(&ctx);

    // TODO(frolv): port postprocessing

    // TODO(frolv): port trust prefixes
    let trusted_until = if reference.method == ReferenceMethod::AccurateModal {
        last_tick + 1
    } else {
        0
    };

    let events = MergedEvents::new(
        events,
        Metadata {
            status: ctx.clients[classification.base].status,
            last_tick,
            missing_tick_count,
            offset,
            precise_server_tick_count: matches!(
                reference.method,
                ReferenceMethod::AccurateModal | ReferenceMethod::PreciseServer
            ),
            accurate_until: trusted_until,
            queryable_until: trusted_until,
        },
    );

    let mut merged_count = 0;
    let mut unmerged_count = 0;
    let mut skipped_count = 0;
    for client in &outcomes {
        match client.status {
            MergeStatus::Merged(_) => merged_count += 1,
            MergeStatus::Unmerged(_) => unmerged_count += 1,
            MergeStatus::Skipped(_) => skipped_count += 1,
        }
    }

    (
        Some(events),
        MergeReport {
            alerts,
            reference_ticks: Some(classification.reference_ticks),
            clients: outcomes,
            merged_count,
            unmerged_count,
            skipped_count,
        },
    )
}

fn end_align_to_reference(
    timeline: &mut timeline::Timeline,
    reference: &ReferenceTicks,
    outcomes: &[ClientOutcome],
) -> u32 {
    // If a client reported an in-game tick count, the stage has been completed,
    // so assume that the events are offset from the end of the stage.
    let offset = match reference.method {
        ReferenceMethod::RecordedTicks => 0,
        ReferenceMethod::AccurateModal
        | ReferenceMethod::PreciseServer
        | ReferenceMethod::ImpreciseServer => reference
            .count
            .saturating_sub(timeline.last_tick().unwrap_or(0)),
    };
    if offset == 0 {
        return 0;
    }

    timeline.shift(offset);
    tracing::warn!(
        offset,
        reference_count = reference.count,
        "merge_timeline_offset_applied",
    );

    // In the rare case where the base client left before stage end and the only
    // stream that saw the end was rejected, the merged timeline will not match
    // the reference count. End alignment will then shift the timeline even
    // though base tick 0 may have been the true stage tick 0. Log it for
    // traceability into whether this ever actually occurs.
    let end_seen_by_contributor = outcomes.iter().any(|outcome| {
        matches!(outcome.status, MergeStatus::Merged(_)) && outcome.server_ticks.is_some()
    });
    if !end_seen_by_contributor {
        tracing::warn!(
            offset,
            reference_count = reference.count,
            "merge_offset_no_merged_end_stream",
        );
    }

    offset
}

/// Trust and shape metadata of a merged timeline.
#[derive(Debug)]
struct Metadata {
    status: StageStatus,
    last_tick: u32,
    missing_tick_count: u32,
    offset: u32,
    precise_server_tick_count: bool,
    accurate_until: u32,
    queryable_until: u32,
}

/// A canonical timeline of stage events combined from clients' recordings.
#[derive(Debug)]
pub struct MergedEvents {
    /// Events in tick order.
    events: Vec<Event>,
    metadata: Metadata,
}

impl MergedEvents {
    fn new(events: Vec<Event>, metadata: Metadata) -> MergedEvents {
        MergedEvents { events, metadata }
    }

    /// Iterates over every event in tick order.
    pub fn iter(&self) -> std::slice::Iter<'_, Event> {
        self.events.iter()
    }

    /// The number of events in the timeline.
    pub fn len(&self) -> usize {
        self.events.len()
    }

    /// Whether the timeline contains no events.
    #[expect(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    /// The events occurring on `tick`.
    pub fn events_for_tick(&self, tick: u32) -> &[Event] {
        &self.events[self.tick_range(tick)]
    }

    /// Mutable events occurring on `tick`.
    pub fn events_for_tick_mut(&mut self, tick: u32) -> &mut [Event] {
        let range = self.tick_range(tick);
        &mut self.events[range]
    }

    /// The overall status of the stage.
    pub fn status(&self) -> StageStatus {
        self.metadata.status
    }

    /// The final tick of the timeline.
    pub fn last_tick(&self) -> u32 {
        self.metadata.last_tick
    }

    /// The number of ticks in the timeline on which no client recorded events.
    pub fn missing_tick_count(&self) -> u32 {
        self.metadata.missing_tick_count
    }

    /// Number of empty ticks inserted at the start of the timeline to align it.
    pub fn offset(&self) -> u32 {
        self.metadata.offset
    }

    /// Whether the timeline's tick count is verified by the game server.
    pub fn has_precise_server_tick_count(&self) -> bool {
        self.metadata.precise_server_tick_count
    }

    /// The exclusive tick at which the timeline can no longer be trusted to
    /// match the true server tick count.
    pub fn accurate_until(&self) -> u32 {
        self.metadata.accurate_until
    }

    /// The exclusive tick at which the event stream can no longer be fully
    /// corroborated for strict analysis.
    pub fn queryable_until(&self) -> u32 {
        self.metadata.queryable_until
    }

    /// Whether queryability covers the entire stage.
    pub fn fully_queryable(&self) -> bool {
        self.metadata.last_tick < self.metadata.queryable_until
    }

    /// Consumes the timeline, returning its events in tick order.
    pub fn into_events(self) -> Vec<Event> {
        self.events
    }

    /// Limits the accuracy and queryability of the event stream to `tick`, exclusive.
    pub fn restrict_accuracy_to(&mut self, tick: u32) {
        self.metadata.accurate_until = self.metadata.accurate_until.min(tick);
        self.metadata.queryable_until = self.metadata.queryable_until.min(tick);
    }

    fn tick_range(&self, tick: u32) -> std::ops::Range<usize> {
        let start = self.events.partition_point(|event| event.tick < tick);
        let end = start
            + self.events[start..]
                .iter()
                .take_while(|e| e.tick == tick)
                .count();
        start..end
    }
}

impl std::ops::Index<usize> for MergedEvents {
    type Output = Event;

    fn index(&self, index: usize) -> &Event {
        &self.events[index]
    }
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;
    use prost::Message;

    use super::*;
    use crate::lifecycle::core::types::{ClientId, ServerTicks, StageUpdate};
    use crate::proto::{ChallengeEvents, event};

    fn nylocas_challenge() -> ChallengeInfo<'static> {
        static PARTY: std::sync::LazyLock<Vec<String>> =
            std::sync::LazyLock::new(|| vec!["1Ogp".to_string()]);
        fixtures::challenge_info(Stage::TobNylocas, ChallengeMode::TobRegular, &PARTY)
    }

    fn wave_event(tick: u32, wave: u32) -> Event {
        fixtures::nylo_wave_event(event::Type::TobNyloWaveSpawn, tick, wave, 0, 12)
    }

    fn merge_one_client(accurate: bool, recorded_ticks: u32, events: Vec<Event>) -> MergedEvents {
        let challenge = nylocas_challenge();
        let payload = ChallengeEvents {
            events,
            ..Default::default()
        };
        let records = vec![
            ClientStageStream::Events {
                client_id: ClientId(1),
                events: Bytes::from(payload.encode_to_vec()),
            },
            ClientStageStream::End {
                client_id: ClientId(1),
                update: StageUpdate {
                    stage: Stage::TobNylocas,
                    status: StageStatus::Completed,
                    accurate,
                    recorded_ticks,
                    server_ticks: accurate.then_some(ServerTicks {
                        count: recorded_ticks,
                        precise: true,
                    }),
                },
            },
        ];
        merge(&challenge, Stage::TobNylocas, records, None)
            .0
            .expect("stage has client data")
    }

    #[test]
    fn merge_of_an_empty_stream_is_none() {
        let party = vec!["1Ogp".to_string()];
        let challenge =
            fixtures::challenge_info(Stage::MokhaiotlDelve1, ChallengeMode::NoMode, &party);
        let (merged, report) = merge(&challenge, Stage::MokhaiotlDelve1, vec![], None);
        assert!(merged.is_none());
        assert_eq!(
            report,
            MergeReport {
                alerts: Vec::new(),
                reference_ticks: None,
                clients: Vec::new(),
                merged_count: 0,
                unmerged_count: 0,
                skipped_count: 0,
            }
        );
    }

    #[test]
    fn alerts_raised_during_the_merge_are_reported() {
        let challenge = nylocas_challenge();
        let records = vec![
            ClientStageStream::End {
                client_id: ClientId(1),
                update: StageUpdate {
                    stage: Stage::TobNylocas,
                    status: StageStatus::Completed,
                    accurate: false,
                    recorded_ticks: 90,
                    server_ticks: Some(ServerTicks {
                        count: 90,
                        precise: true,
                    }),
                },
            },
            ClientStageStream::End {
                client_id: ClientId(2),
                update: StageUpdate {
                    stage: Stage::TobNylocas,
                    status: StageStatus::Completed,
                    accurate: false,
                    recorded_ticks: 95,
                    server_ticks: Some(ServerTicks {
                        count: 95,
                        precise: true,
                    }),
                },
            },
        ];
        let (merged, report) = merge(&challenge, Stage::TobNylocas, records, None);
        assert!(merged.is_some());
        assert_eq!(
            report.alerts,
            vec![MergeAlert::MultipleServerTickCounts {
                precise: true,
                tick_counts: vec![90, 95],
            }]
        );
    }

    #[test]
    fn bad_data_clients_are_reported_as_skipped() {
        let challenge = nylocas_challenge();
        let records = vec![
            ClientStageStream::End {
                client_id: ClientId(1),
                update: StageUpdate {
                    stage: Stage::TobNylocas,
                    status: StageStatus::Completed,
                    accurate: false,
                    recorded_ticks: 90,
                    server_ticks: None,
                },
            },
            ClientStageStream::End {
                client_id: ClientId(2),
                update: StageUpdate {
                    stage: Stage::TobNylocas,
                    status: StageStatus::Completed,
                    accurate: false,
                    recorded_ticks: 10,
                    server_ticks: Some(ServerTicks {
                        count: 0,
                        precise: true,
                    }),
                },
            },
        ];
        let (merged, report) = merge(&challenge, Stage::TobNylocas, records, None);
        assert!(merged.is_some());
        assert_eq!(
            report.clients,
            vec![
                ClientOutcome {
                    client_id: ClientId(2),
                    primary_player: None,
                    stage_status: StageStatus::Completed,
                    accurate: false,
                    recorded_ticks: 10,
                    server_ticks: Some(ServerTicks {
                        count: 0,
                        precise: true,
                    }),
                    consistency_issues: Vec::new(),
                    status: MergeStatus::Skipped(BadData::InvalidServerTickCount),
                },
                ClientOutcome {
                    client_id: ClientId(1),
                    primary_player: None,
                    stage_status: StageStatus::Completed,
                    accurate: false,
                    recorded_ticks: 90,
                    server_ticks: None,
                    consistency_issues: Vec::new(),
                    status: MergeStatus::Merged(Classification::Reference),
                },
            ],
        );
        assert_eq!(report.merged_count, 1);
        assert_eq!(report.unmerged_count, 0);
        assert_eq!(report.skipped_count, 1);
    }

    #[test]
    fn all_clients_bad_data_returns_report_without_timeline() {
        let challenge = nylocas_challenge();
        let records = vec![ClientStageStream::End {
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
        }];
        let (merged, report) = merge(&challenge, Stage::TobNylocas, records, None);
        assert!(merged.is_none());
        assert_eq!(
            report,
            MergeReport {
                alerts: Vec::new(),
                reference_ticks: None,
                clients: vec![ClientOutcome {
                    client_id: ClientId(1),
                    primary_player: None,
                    stage_status: StageStatus::Wiped,
                    accurate: false,
                    recorded_ticks: 10,
                    server_ticks: Some(ServerTicks {
                        count: 0,
                        precise: true,
                    }),
                    consistency_issues: Vec::new(),
                    status: MergeStatus::Skipped(BadData::InvalidServerTickCount),
                }],
                merged_count: 0,
                unmerged_count: 0,
                skipped_count: 1,
            }
        );
    }

    #[test]
    fn events_for_tick_slices_to_a_single_tick() {
        let merged = merge_one_client(
            true,
            20,
            vec![
                wave_event(4, 1),
                wave_event(8, 2),
                wave_event(12, 3),
                wave_event(16, 4),
            ],
        );
        let waves: Vec<u32> = merged
            .events_for_tick(8)
            .iter()
            .map(|event| event.nylo_wave.unwrap().wave)
            .collect();
        assert_eq!(waves, vec![2]);
        assert!(merged.events_for_tick(6).is_empty());
        assert!(merged.events_for_tick(18).is_empty());
    }

    #[test]
    fn mutation_through_a_tick_slice_is_visible_in_iteration() {
        let mut merged = merge_one_client(true, 10, vec![wave_event(4, 1), wave_event(8, 2)]);
        for event in merged.events_for_tick_mut(8) {
            event.y_coord = 99;
        }
        let updated: Vec<i32> = merged.iter().map(|event| event.y_coord).collect();
        assert_eq!(updated, vec![0, 99]);
    }

    #[test]
    fn missing_ticks_counts_unrecorded_ticks() {
        let accurate = merge_one_client(true, 5, vec![wave_event(4, 1)]);
        assert_eq!(accurate.last_tick(), 5);
        assert_eq!(accurate.missing_tick_count(), 5);

        let challenge = nylocas_challenge();
        let payload = ChallengeEvents {
            events: vec![wave_event(4, 1)],
            ..Default::default()
        };
        let records = vec![
            ClientStageStream::Events {
                client_id: ClientId(1),
                events: Bytes::from(payload.encode_to_vec()),
            },
            ClientStageStream::End {
                client_id: ClientId(1),
                update: StageUpdate {
                    stage: Stage::TobNylocas,
                    status: StageStatus::Completed,
                    accurate: false,
                    recorded_ticks: 5,
                    server_ticks: Some(ServerTicks {
                        count: 8,
                        precise: true,
                    }),
                },
            },
        ];
        let (merged, report) = merge(&challenge, Stage::TobNylocas, records, None);
        let merged = merged.expect("stage has client data");
        assert_eq!(merged.last_tick(), 8);
        assert_eq!(merged.missing_tick_count(), 8);
        assert_eq!(
            report.alerts,
            vec![MergeAlert::TimelineOffsetApplied { offset: 3 }]
        );
    }

    #[test]
    fn restrict_accuracy_to_only_clamps_down() {
        let mut merged = merge_one_client(true, 100, vec![wave_event(4, 1), wave_event(100, 14)]);
        merged.restrict_accuracy_to(40);
        assert_eq!(merged.accurate_until(), 40);
        assert_eq!(merged.queryable_until(), 40);
        merged.restrict_accuracy_to(80);
        assert_eq!(merged.accurate_until(), 40);
        assert_eq!(merged.queryable_until(), 40);
        assert!(!merged.fully_queryable());
    }
}

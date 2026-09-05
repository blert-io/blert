//! Stage event merging.
//!
//! Combines the event streams recorded by a stage's clients into a single
//! canonical timeline for challenge processing to consume.

// TODO(frolv): Remove once the container's full API has consumers.
#![cfg_attr(not(test), expect(dead_code))]

mod alignment;
mod classification;
mod client_consistency;
mod client_events;
mod consolidator;
mod derivation;
mod event;
mod mapping;
mod similarity;
mod tick;
mod timeline;
mod trace;
mod trusted_prefixes;
mod world;

pub mod capture;
#[cfg(test)]
pub(crate) mod fixtures;

pub use classification::{ReferenceMethod, ReferenceTicks};
pub(crate) use tick::{Tick, Ticks};
pub use trace::Tracer;

use std::collections::{BTreeMap, BTreeSet};

use crate::lifecycle::core::types::{
    ChallengeMode, ChallengeType, ClientId, ClientStageStream, ServerTicks, Stage, StageStatus,
    Uuid,
};
use crate::proto::Event;

use alignment::TickAligner;
use classification::{ClientClassification, classify_clients};
use client_consistency::ConsistencyIssue;
use client_events::{BadDataClient, ClientEvents};
use event::MalformedEvent;
use mapping::{Mappings, MergeMapping, TickMapping};
use similarity::SimilarityScorer;
use trusted_prefixes::{TimelineInfo, compute_trusted_prefixes};

/// A notable condition encountered while merging a stage's clients.
#[derive(Debug, PartialEq, Eq)]
pub enum MergeAlert {
    /// Clients sent conflicting server tick counts.
    MultipleServerTickCounts {
        precise: bool,
        tick_counts: Vec<Ticks>,
    },
    /// The timeline was shifted forward to fit a reference tick count.
    TimelineOffsetApplied { offset: Ticks },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Classification {
    Reference,
    Matching,
    Mismatched,
}

/// How a client in a merge was processed.
#[derive(Debug, Clone, PartialEq, Eq)]
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
    pub last_tick: Tick,
    pub server_ticks: Option<ServerTicks>,
    pub consistency_issues: Vec<ConsistencyIssue>,
    pub status: MergeStatus,
}

impl ClientOutcome {
    fn new(client: &ClientEvents, status: MergeStatus) -> ClientOutcome {
        ClientOutcome {
            client_id: client.info.id,
            primary_player: client.info.primary_player.clone(),
            stage_status: client.info.status,
            accurate: client.accurate,
            last_tick: client.info.last_recorded_tick,
            server_ticks: client.info.server_ticks,
            consistency_issues: client.consistency_issues.clone(),
            status,
        }
    }
}

impl From<&RegisteredClient> for ClientOutcome {
    fn from(client: &RegisteredClient) -> ClientOutcome {
        Self::new(&client.client, client.status.clone())
    }
}

impl From<BadDataClient> for ClientOutcome {
    fn from(client: BadDataClient) -> ClientOutcome {
        ClientOutcome {
            client_id: client.info.id,
            primary_player: client.info.primary_player,
            stage_status: client.info.status,
            accurate: client.info.reported_accurate,
            last_tick: client.info.last_recorded_tick,
            server_ticks: client.info.server_ticks,
            consistency_issues: Vec::new(),
            status: MergeStatus::Skipped(client.error),
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
    /// Creates a report detailing the results of merging `clients`.
    fn new(
        clients: Vec<ClientOutcome>,
        reference_ticks: ReferenceTicks,
        alerts: Vec<MergeAlert>,
    ) -> MergeReport {
        let mut merged_count = 0;
        let mut unmerged_count = 0;
        let mut skipped_count = 0;
        for client in &clients {
            match client.status {
                MergeStatus::Merged(_) => merged_count += 1,
                MergeStatus::Unmerged(_) => unmerged_count += 1,
                MergeStatus::Skipped(_) => skipped_count += 1,
            }
        }
        MergeReport {
            alerts,
            reference_ticks: Some(reference_ticks),
            clients,
            merged_count,
            unmerged_count,
            skipped_count,
        }
    }

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
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BadData {
    #[error(transparent)]
    MalformedEvent(#[from] MalformedEvent),
    #[error("tick {tick}: {message}")]
    Inconsistent { tick: Tick, message: String },
    #[error("multiple primary players")]
    MultiplePrimaryPlayers,
    #[error("invalid server tick count")]
    InvalidServerTickCount,
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
            tracer.record_bad_data_client(client);
        }
    }

    let mut outcomes: Vec<ClientOutcome> = bad_data_clients
        .into_iter()
        .map(ClientOutcome::from)
        .collect();

    if clients.is_empty() {
        return (None, MergeReport::empty(outcomes));
    }

    let mut alerts = Vec::new();

    let classification = classify_clients(&mut clients);

    if let Some(tracer) = tracer.as_deref_mut() {
        tracer.record_classification(&classification, &clients);
    }

    let mut ctx = MergeContext::new(challenge, stage, clients, &classification);

    alerts.extend(classification.alert);

    let mut merged = MergedTimeline::new(ctx.client(classification.base));
    if let Some(tracer) = tracer.as_deref_mut() {
        tracer.record_intermediate_snapshot(merged.timeline.tick_states());
    }

    for client in classification.matching {
        merged.merge_from(
            &mut ctx,
            client,
            Classification::Matching,
            tracer.as_deref_mut(),
        );
    }
    for client in classification.mismatched {
        merged.merge_from(
            &mut ctx,
            client,
            Classification::Mismatched,
            tracer.as_deref_mut(),
        );
    }

    let reference = classification.reference_ticks;
    outcomes.extend(ctx.clients.iter().map(ClientOutcome::from));

    let offset = merged.end_align_to_reference(reference, &outcomes);
    if offset.is_nonzero() {
        alerts.push(MergeAlert::TimelineOffsetApplied { offset });
    }

    let last_tick = merged.timeline.last_tick();
    let missing_tick_count = merged.timeline.missing_tick_count();
    let events = merged.timeline.finalize(&ctx);

    // TODO(frolv): port postprocessing

    let prefixes = compute_trusted_prefixes(
        &ctx,
        &TimelineInfo {
            last_tick,
            offset,
            inherited_accuracy: merged.inherited_accurate,
            reference_method: reference.method,
        },
    );
    if let Some(tracer) = tracer {
        tracer.record_trusted_prefixes(prefixes);
    }

    let events = MergedEvents::new(
        events,
        Metadata {
            status: ctx.client(classification.base).info.status, // TODO(frolv): derive
            last_tick,
            missing_tick_count,
            offset,
            precise_server_tick_count: matches!(
                reference.method,
                ReferenceMethod::AccurateModal | ReferenceMethod::PreciseServer
            ),
            accurate_until: prefixes.accurate_until,
            queryable_until: prefixes.queryable_until,
        },
    );

    (
        Some(events),
        MergeReport::new(outcomes, classification.reference_ticks, alerts),
    )
}

/// A client participating in a merge.
#[derive(Debug)]
struct RegisteredClient {
    client: ClientEvents,
    status: MergeStatus,
}

/// The state of an in-progress merge.
#[derive(Debug)]
struct MergeContext<'a> {
    challenge: &'a ChallengeInfo<'a>,
    stage: Stage,
    clients: Vec<RegisteredClient>,
    mapping: MergeMapping,
    /// Per-client local tick numbers at which conflicts occurred.
    contested_ticks: BTreeMap<ClientId, BTreeSet<Tick>>,
}

impl<'a> MergeContext<'a> {
    fn new(
        challenge: &'a ChallengeInfo<'a>,
        stage: Stage,
        clients: Vec<ClientEvents>,
        classification: &ClientClassification,
    ) -> Self {
        let mapping = MergeMapping::new(clients[classification.base].info.id);
        let mut clients: Vec<RegisteredClient> = clients
            .into_iter()
            .map(|c| RegisteredClient {
                client: c,
                status: MergeStatus::Unmerged(Classification::Mismatched),
            })
            .collect();

        clients[classification.base].status = MergeStatus::Merged(Classification::Reference);
        for &i in &classification.matching {
            clients[i].status = MergeStatus::Unmerged(Classification::Matching);
        }
        for &i in &classification.mismatched {
            clients[i].status = MergeStatus::Unmerged(Classification::Mismatched);
        }

        Self {
            challenge,
            stage,
            clients,
            mapping,
            contested_ticks: BTreeMap::new(),
        }
    }

    fn client(&self, index: usize) -> &ClientEvents {
        &self.clients[index].client
    }

    /// Returns the primary player of the client with `id`, if it has one.
    fn primary_player(&self, id: ClientId) -> Option<&str> {
        self.clients
            .iter()
            .find(|c| c.client.info.id == id)
            .and_then(|c| c.client.info.primary_player.as_deref())
    }
}

/// An in-progress merged timeline.
struct MergedTimeline {
    timeline: timeline::Timeline,
    /// Whether the merged output inherits its accuracy from an accurate base.
    inherited_accurate: bool,
}

impl MergedTimeline {
    /// Initializes a new merged timeline from a base client.
    fn new(base: &ClientEvents) -> Self {
        Self {
            timeline: base.timeline.clone(),
            inherited_accurate: base.accurate,
        }
    }

    /// Attempts to merge `client` into the timeline, recording its result.
    fn merge_from(
        &self,
        ctx: &mut MergeContext<'_>,
        client: usize,
        classification: Classification,
        mut tracer: Option<&mut Tracer>,
    ) {
        let target = ctx.client(client);
        if let Some(tracer) = tracer.as_deref_mut() {
            tracer.begin_merge_step(target.info.id, classification);
        }

        let mappings = if self.inherited_accurate && target.accurate {
            let last_tick = self.timeline.last_tick();
            Mappings {
                base: TickMapping::identity(last_tick),
                target: TickMapping::identity(last_tick),
                merged_last_tick: last_tick,
            }
        } else {
            let base_ticks = self.timeline.tick_states();
            let target_ticks = target.timeline.tick_states();
            let scorer = SimilarityScorer::new();
            let alignment =
                TickAligner::new(base_ticks, target_ticks, |a, b| scorer.score(a, b)).align();
            if let Some(tracer) = tracer.as_deref_mut() {
                tracer.record_alignment(&alignment);
            }

            if alignment.alignments.is_empty() {
                // The aligner found no alignable regions; nothing to merge.
                let status = MergeStatus::Unmerged(classification);
                if let Some(tracer) = tracer {
                    tracer.end_merge_step(&status);
                }
                ctx.clients[client].status = status;
                return;
            }

            let entries: Vec<_> = alignment
                .alignments
                .iter()
                .map(|local| local.entries.clone())
                .collect();
            TickMapping::from_alignment(
                self.timeline.last_tick(),
                target.timeline.last_tick(),
                &entries,
            )
        };

        ctx.mapping.begin(target.info.id, mappings);
        if let Some(tracer) = tracer.as_deref_mut() {
            tracer.record_mapping(&ctx.mapping);
        }

        // TODO(frolv): port consolidation
        ctx.mapping.discard();

        let status = MergeStatus::Unmerged(classification);
        if let Some(tracer) = tracer {
            tracer.end_merge_step(&status);
        }
        ctx.clients[client].status = status;
    }

    /// Shifts the timeline so that its last recorded tick lies at the reference
    /// tick count, returning the number of ticks shifted.
    fn end_align_to_reference(
        &mut self,
        reference: ReferenceTicks,
        outcomes: &[ClientOutcome],
    ) -> Ticks {
        // If a client reported an in-game tick count, the stage has been completed,
        // so assume that the events are offset from the end of the stage.
        let offset = match reference.method {
            ReferenceMethod::RecordedTicks => Ticks(0),
            ReferenceMethod::AccurateModal
            | ReferenceMethod::PreciseServer
            | ReferenceMethod::ImpreciseServer => {
                Tick::at(reference.duration) - self.timeline.last_tick()
            }
        };
        if offset.is_zero() {
            return offset;
        }

        self.timeline.shift(offset);
        tracing::warn!(
            %offset,
            reference_duration = %reference.duration,
            "merge_timeline_offset_applied",
        );

        // In the rare case where the base client left before stage end and the
        // only stream that saw the end was rejected, the merged timeline will
        // not match the reference count. End alignment will then shift the
        // timeline even though base tick 0 may have been the true stage tick 0.
        // Log it for traceability into whether this ever actually occurs.
        let end_seen_by_contributor = outcomes.iter().any(|outcome| {
            matches!(outcome.status, MergeStatus::Merged(_)) && outcome.server_ticks.is_some()
        });
        if !end_seen_by_contributor {
            tracing::warn!(
                %offset,
                reference_duration = %reference.duration,
                "merge_offset_no_merged_end_stream",
            );
        }

        offset
    }
}

/// Trust and shape metadata of a merged timeline.
#[derive(Debug)]
struct Metadata {
    status: StageStatus,
    last_tick: Tick,
    missing_tick_count: u32,
    offset: Ticks,
    precise_server_tick_count: bool,
    accurate_until: Tick,
    queryable_until: Tick,
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
    pub fn events_for_tick(&self, tick: Tick) -> &[Event] {
        &self.events[self.tick_range(tick)]
    }

    /// Mutable events occurring on `tick`.
    pub fn events_for_tick_mut(&mut self, tick: Tick) -> &mut [Event] {
        let range = self.tick_range(tick);
        &mut self.events[range]
    }

    /// The overall status of the stage.
    pub fn status(&self) -> StageStatus {
        self.metadata.status
    }

    /// The final tick of the timeline.
    pub fn last_tick(&self) -> Tick {
        self.metadata.last_tick
    }

    /// The duration of the stage.
    pub fn duration(&self) -> Ticks {
        self.last_tick().duration()
    }

    /// The number of ticks in the timeline on which no client recorded events.
    pub fn missing_tick_count(&self) -> u32 {
        self.metadata.missing_tick_count
    }

    /// Number of empty ticks inserted at the start of the timeline to align it.
    pub fn offset(&self) -> Ticks {
        self.metadata.offset
    }

    /// Whether the timeline's tick count is verified by the game server.
    pub fn has_precise_server_tick_count(&self) -> bool {
        self.metadata.precise_server_tick_count
    }

    /// The exclusive tick at which the timeline can no longer be trusted to
    /// match the true server tick count.
    pub fn accurate_until(&self) -> Tick {
        self.metadata.accurate_until
    }

    /// The exclusive tick at which the event stream can no longer be fully
    /// corroborated for strict analysis.
    pub fn queryable_until(&self) -> Tick {
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
    pub fn restrict_accuracy_to(&mut self, tick: Tick) {
        self.metadata.accurate_until = self.metadata.accurate_until.min(tick);
        self.metadata.queryable_until = self.metadata.queryable_until.min(tick);
    }

    fn tick_range(&self, tick: Tick) -> std::ops::Range<usize> {
        let start = self.events.partition_point(|event| event.tick < tick.0);
        let end = start
            + self.events[start..]
                .iter()
                .take_while(|e| e.tick == tick.0)
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

    fn wave_event(tick: Tick, wave: u32) -> Event {
        fixtures::nylo_wave_event(event::Type::TobNyloWaveSpawn, tick, wave, 0, 12)
    }

    fn merge_one_client(accurate: bool, last_tick: Tick, events: Vec<Event>) -> MergedEvents {
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
                    recorded_ticks: last_tick.0,
                    server_ticks: accurate.then_some(ServerTicks {
                        count: last_tick.0,
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
                tick_counts: vec![Ticks(90), Ticks(95)],
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
                    last_tick: Tick(10),
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
                    last_tick: Tick(90),
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
                    last_tick: Tick(10),
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
    fn two_accurate_clients_merge_as_reference_and_matching() {
        let challenge = nylocas_challenge();
        let payload = ChallengeEvents {
            events: vec![wave_event(Tick(4), 1), wave_event(Tick(8), 2)],
            ..Default::default()
        };
        let end = |client_id: i64| ClientStageStream::End {
            client_id: ClientId(client_id),
            update: StageUpdate {
                stage: Stage::TobNylocas,
                status: StageStatus::Completed,
                accurate: true,
                recorded_ticks: 90,
                server_ticks: Some(ServerTicks {
                    count: 90,
                    precise: true,
                }),
            },
        };
        let records = vec![
            ClientStageStream::Events {
                client_id: ClientId(1),
                events: Bytes::from(payload.encode_to_vec()),
            },
            ClientStageStream::Events {
                client_id: ClientId(2),
                events: Bytes::from(payload.encode_to_vec()),
            },
            end(1),
            end(2),
        ];

        let (merged, report) = merge(&challenge, Stage::TobNylocas, records, None);

        assert!(merged.is_some());
        let outcome = |client_id: i64, status: MergeStatus| ClientOutcome {
            client_id: ClientId(client_id),
            primary_player: None,
            stage_status: StageStatus::Completed,
            accurate: true,
            last_tick: Tick(90),
            server_ticks: Some(ServerTicks {
                count: 90,
                precise: true,
            }),
            consistency_issues: Vec::new(),
            status,
        };
        assert_eq!(
            report,
            MergeReport {
                alerts: Vec::new(),
                reference_ticks: Some(ReferenceTicks {
                    duration: Ticks(90),
                    method: ReferenceMethod::AccurateModal,
                }),
                clients: vec![
                    outcome(1, MergeStatus::Merged(Classification::Reference)),
                    outcome(2, MergeStatus::Unmerged(Classification::Matching)),
                ],
                merged_count: 1,
                unmerged_count: 1, // soon
                skipped_count: 0,
            }
        );
    }

    #[test]
    fn events_for_tick_slices_to_a_single_tick() {
        let merged = merge_one_client(
            true,
            Tick(20),
            vec![
                wave_event(Tick(4), 1),
                wave_event(Tick(8), 2),
                wave_event(Tick(12), 3),
                wave_event(Tick(16), 4),
            ],
        );
        let waves: Vec<u32> = merged
            .events_for_tick(Tick(8))
            .iter()
            .map(|event| event.nylo_wave.unwrap().wave)
            .collect();
        assert_eq!(waves, vec![2]);
        assert!(merged.events_for_tick(Tick(6)).is_empty());
        assert!(merged.events_for_tick(Tick(18)).is_empty());
    }

    #[test]
    fn mutation_through_a_tick_slice_is_visible_in_iteration() {
        let mut merged = merge_one_client(
            true,
            Tick(10),
            vec![wave_event(Tick(4), 1), wave_event(Tick(8), 2)],
        );
        for event in merged.events_for_tick_mut(Tick(8)) {
            event.y_coord = 99;
        }
        let updated: Vec<i32> = merged.iter().map(|event| event.y_coord).collect();
        assert_eq!(updated, vec![0, 99]);
    }

    #[test]
    fn missing_ticks_counts_unrecorded_ticks() {
        let accurate = merge_one_client(true, Tick(5), vec![wave_event(Tick(4), 1)]);
        assert_eq!(accurate.last_tick(), Tick(5));
        assert_eq!(accurate.missing_tick_count(), 5);

        let challenge = nylocas_challenge();
        let payload = ChallengeEvents {
            events: vec![wave_event(Tick(4), 1)],
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
        assert_eq!(merged.last_tick(), Tick(8));
        assert_eq!(merged.missing_tick_count(), 8);
        assert_eq!(
            report.alerts,
            vec![MergeAlert::TimelineOffsetApplied { offset: Ticks(3) }]
        );
    }

    #[test]
    fn restrict_accuracy_to_only_clamps_down() {
        let mut merged = merge_one_client(
            true,
            Tick(100),
            vec![wave_event(Tick(4), 1), wave_event(Tick(100), 14)],
        );
        merged.restrict_accuracy_to(Tick(40));
        assert_eq!(merged.accurate_until(), Tick(40));
        assert_eq!(merged.queryable_until(), Tick(40));
        merged.restrict_accuracy_to(Tick(80));
        assert_eq!(merged.accurate_until(), Tick(40));
        assert_eq!(merged.queryable_until(), Tick(40));
        assert!(!merged.fully_queryable());
    }
}

//! Stage event merging.
//!
//! Combines the event streams recorded by a stage's clients into a single
//! canonical timeline for challenge processing to consume.

mod alignment;
mod classification;
mod client_consistency;
mod client_events;
mod confidence;
mod consolidator;
mod event;
mod mapping;
mod merge_consistency;
mod report;
mod similarity;
mod trace;
mod trusted_prefixes;
mod world;

pub mod capture;
#[cfg(test)]
pub(crate) mod fixtures;

pub use capture::MergeCapture;
pub use classification::{ReferenceMethod, ReferenceTicks};
pub use confidence::StepConfidence;
pub use report::{
    ClientAnomaly, ClientOutcome, MergeAlert, MergeClassification, MergeReport, MergeStatus,
    QualityFlag,
};
pub use trace::Tracer;

use std::collections::{BTreeMap, BTreeSet};

use blert::{BuildRejection, PartyIndex, Recording, Rsn, StageData, Tick, Ticks, Timeline};

use crate::lifecycle::core::types::{
    ChallengeMode, ChallengeType, ClientId, ClientStageStream, Stage, StageStatus, Uuid,
};

use alignment::{AlignmentResult, TickAligner};
use classification::{ClientClassification, classify_clients};
use client_events::ClientEvents;
use consolidator::{ConsolidationResult, Consolidator};
use mapping::{Mappings, MergeMapping, TickMapping};
use merge_consistency::MergeConsistencyIssue;
use similarity::SimilarityScorer;
use trusted_prefixes::{TimelineInfo, compute_trusted_prefixes, record_contested_ticks};

// Provisional confidence acceptance threshold.
// TODO(frolv): Calibrate against real data and consider if it should look at
// individual components instead of a flat threshold.
const MIN_MERGE_CONFIDENCE_THRESHOLD: f64 = 0.75;

// Worst-segment score below which a merged client is flagged for review.
const LOW_CONFIDENCE_WARN_THRESHOLD: f64 = 0.4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Classification {
    Reference,
    Matching,
    Mismatched,
}

#[derive(Debug, Clone, PartialEq)]
enum StepResult {
    Unmerged,
    Merged {
        confidence: Option<StepConfidence>,
        quality_flags: Vec<consolidator::QualityFlag>,
    },
    Rejected {
        reason: RejectionReason,
        quality_flags: Vec<consolidator::QualityFlag>,
    },
}

/// Why a merge step was rejected.
#[derive(Debug, Clone, PartialEq)]
pub enum RejectionReason {
    /// The merged timeline violated a game invariant.
    PostMergeConsistency(Vec<MergeConsistencyIssue>),
    /// The merge step's confidence score fell below the acceptance threshold.
    LowMergeConfidence(StepConfidence),
}

/// Challenge context for a merge.
#[derive(Debug, Clone)]
pub struct ChallengeInfo<'a> {
    pub uuid: Uuid,
    pub challenge_type: ChallengeType,
    pub mode: ChallengeMode,
    pub party: &'a [Rsn],
}

/// Fatally invalid client input data.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BadData {
    #[error("tick {}: {:?} {:?}", .0.tick, .0.kind, .0.reason)]
    RejectedEvent(BuildRejection),
    #[error("tick {tick}: {message}")]
    Inconsistent { tick: Tick, message: String },
    #[error("multiple primary players")]
    MultiplePrimaryPlayers,
    #[error("invalid server tick count")]
    InvalidServerTickCount,
    #[error("no recording")]
    NoRecording,
}

/// Merges the events recorded by a stage's clients into a canonical timeline.
/// Returns the merged timeline, if created, alongside a report of what happened.
pub fn merge<'a>(
    challenge: &'a ChallengeInfo<'a>,
    stage: Stage,
    records: &[ClientStageStream],
    mut tracer: Option<&mut Tracer>,
) -> (Option<MergedTimeline>, MergeReport) {
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

    let mut ctx = MergeContext::new(challenge, clients, &classification);

    alerts.extend(classification.alert);

    let mut merged = MergedRecording::new(ctx.client(classification.base));
    if let Some(tracer) = tracer.as_deref_mut() {
        tracer.record_intermediate_snapshot(&merged.recording);
    }

    for client in classification.matching {
        merged.merge_from(&mut ctx, client, tracer.as_deref_mut());
    }
    for client in classification.mismatched {
        merged.merge_from(&mut ctx, client, tracer.as_deref_mut());
    }

    let reference = classification.reference_ticks;
    let offset = merged.end_align_to_reference(reference, &ctx.clients);
    if offset.is_nonzero() {
        alerts.push(MergeAlert::TimelineOffsetApplied { offset });
    }
    alerts.extend(ctx.surface_alerts());
    outcomes.extend(ctx.clients.iter().map(ClientOutcome::from));

    let timeline = merged.recording.finalize();

    let prefixes = compute_trusted_prefixes(
        &ctx,
        &timeline,
        &TimelineInfo {
            offset,
            inherited_accuracy: merged.inherited_accurate,
            reference_method: reference.method,
        },
    );
    if let Some(tracer) = tracer {
        tracer.record_trusted_prefixes(prefixes);
    }

    let merged = MergedTimeline::new(
        timeline,
        Metadata {
            status: ctx.stage_status(classification.base),
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
        Some(merged),
        MergeReport::new(outcomes, classification.reference_ticks, alerts),
    )
}

/// A client participating in a merge.
#[derive(Debug)]
struct RegisteredClient {
    client: ClientEvents,
    classification: Classification,
    result: StepResult,
}

/// The state of an in-progress merge.
#[derive(Debug)]
struct MergeContext<'a> {
    challenge: &'a ChallengeInfo<'a>,
    clients: Vec<RegisteredClient>,
    mapping: MergeMapping,
    /// Per-client local tick numbers at which conflicts occurred.
    contested_ticks: BTreeMap<ClientId, BTreeSet<Tick>>,
}

impl<'a> MergeContext<'a> {
    fn new(
        challenge: &'a ChallengeInfo<'a>,
        clients: Vec<ClientEvents>,
        classification: &ClientClassification,
    ) -> Self {
        let mapping = MergeMapping::new(clients[classification.base].info.id);
        let mut clients: Vec<RegisteredClient> = clients
            .into_iter()
            .map(|c| RegisteredClient {
                client: c,
                classification: Classification::Mismatched,
                result: StepResult::Unmerged,
            })
            .collect();

        clients[classification.base].classification = Classification::Reference;
        clients[classification.base].result = StepResult::Merged {
            confidence: None,
            quality_flags: Vec::new(),
        };
        for &i in &classification.matching {
            clients[i].classification = Classification::Matching;
        }
        for &i in &classification.mismatched {
            clients[i].classification = Classification::Mismatched;
        }

        Self {
            challenge,
            clients,
            mapping,
            contested_ticks: BTreeMap::new(),
        }
    }

    fn client(&self, index: usize) -> &ClientEvents {
        &self.clients[index].client
    }

    /// Returns the primary player of the client with `id`, if it has one.
    fn primary_player(&self, id: ClientId) -> Option<PartyIndex> {
        self.clients
            .iter()
            .find(|c| c.client.info.id == id)
            .and_then(|c| c.client.info.primary_player)
    }

    /// Returns the final status of the stage based on the merged clients.
    fn stage_status(&self, base: usize) -> StageStatus {
        fn rank(status: StageStatus) -> u8 {
            match status {
                StageStatus::Entered => 0,
                StageStatus::Started => 1,
                StageStatus::Wiped => 2,
                StageStatus::Completed => 3,
            }
        }
        self.clients
            .iter()
            .filter(|client| !matches!(client.result, StepResult::Rejected { .. }))
            .map(|client| client.client.info.status)
            .fold(self.client(base).info.status, |status, candidate| {
                if rank(candidate) > rank(status) {
                    candidate
                } else {
                    status
                }
            })
    }

    /// Raises alerts for any issues encountered during the merge.
    fn surface_alerts(&self) -> Vec<MergeAlert> {
        let mut alerts = Vec::new();

        let mut consistency_issues = Vec::new();
        let mut total_issues = 0;
        let mut confidence_rejections = Vec::new();
        let mut worst_segment_scores = Vec::new();
        for client in &self.clients {
            let id = client.client.info.id;
            match &client.result {
                StepResult::Rejected {
                    reason: RejectionReason::PostMergeConsistency(issues),
                    ..
                } => {
                    consistency_issues.push(id);
                    total_issues += issues.len();
                }
                StepResult::Rejected {
                    reason: RejectionReason::LowMergeConfidence(_),
                    ..
                } => {
                    confidence_rejections.push(id);
                }
                StepResult::Merged {
                    confidence: Some(confidence),
                    ..
                } => {
                    if let Some(score) = confidence.worst_segment_score()
                        && score < LOW_CONFIDENCE_WARN_THRESHOLD
                    {
                        worst_segment_scores.push((id, score));
                    }
                }
                StepResult::Merged {
                    confidence: None, ..
                }
                | StepResult::Unmerged => {}
            }
        }
        if !consistency_issues.is_empty() {
            alerts.push(MergeAlert::PostMergeConsistencyRejections {
                client_ids: consistency_issues,
                total_issues,
            });
        }
        if !confidence_rejections.is_empty() {
            alerts.push(MergeAlert::LowConfidenceRejections {
                client_ids: confidence_rejections,
            });
        }
        if !worst_segment_scores.is_empty() {
            alerts.push(MergeAlert::LowStructuralConfidence {
                worst_segment_scores,
            });
        }

        alerts
    }
}

fn merge_stage_data(stage_data: &mut StageData, other: &StageData) {
    if matches!(stage_data, StageData::None) {
        *stage_data = other.clone();
        return;
    }
    let (StageData::Sotetseg { mazes }, StageData::Sotetseg { mazes: other_mazes }) =
        (stage_data, other)
    else {
        return;
    };
    for (maze, pivots) in other_mazes {
        let merged = mazes.entry(*maze).or_default();
        for point in &pivots.overworld {
            if !merged.overworld.contains(point) {
                merged.overworld.push(*point);
            }
        }
        for point in &pivots.underworld {
            if !merged.underworld.contains(point) {
                merged.underworld.push(*point);
            }
        }
    }
}

/// An in-progress merged timeline.
struct MergedRecording {
    recording: Recording,
    /// Whether the merged output inherits its accuracy from an accurate base.
    inherited_accurate: bool,
    scorer: SimilarityScorer,
}

impl MergedRecording {
    /// Initializes a new merged timeline from a base client.
    fn new(base: &ClientEvents) -> Self {
        Self {
            recording: base.recording.clone(),
            inherited_accurate: base.accurate,
            scorer: SimilarityScorer::new(),
        }
    }

    /// Attempts to merge `client` into the timeline, recording its result.
    fn merge_from(
        &mut self,
        ctx: &mut MergeContext<'_>,
        client: usize,
        mut tracer: Option<&mut Tracer>,
    ) {
        let target = ctx.client(client);
        if let Some(tracer) = tracer.as_deref_mut() {
            tracer.begin_merge_step(target.info.id);
        }

        let Some((mappings, alignment)) = self.map_target(target, tracer.as_deref_mut()) else {
            ctx.clients[client].result = StepResult::Unmerged;
            if let Some(tracer) = tracer {
                tracer.end_merge_step(&ctx.clients[client]);
            }
            return;
        };

        let target_id = target.info.id;
        ctx.mapping.begin(target_id, mappings);
        if let Some(tracer) = tracer.as_deref_mut() {
            tracer.record_mapping(&ctx.mapping);
        }

        let ConsolidationResult {
            recording,
            quality_flags,
            counters,
        } = Consolidator::new(
            &self.recording,
            &ctx.client(client).recording,
            ctx,
            tracer.as_deref_mut(),
        )
        .consolidate();

        let confidence = confidence::score_step_confidence(
            alignment.as_ref(),
            &counters,
            &quality_flags,
            &confidence::ConfidenceWeights::default(),
            self.scorer.weights().baseline_compatibility_weight,
        );
        if let Some(tracer) = tracer.as_deref_mut() {
            tracer.record_confidence(&confidence);
        }

        let consistency_result = merge_consistency::check(&recording.snapshot());
        let confidence_result = confidence.check(MIN_MERGE_CONFIDENCE_THRESHOLD);

        let result = match (consistency_result, confidence_result) {
            (Ok(()), Ok(confidence)) => {
                ctx.mapping.commit();
                record_contested_ticks(ctx, target_id, &quality_flags);
                self.recording = recording;
                merge_stage_data(
                    self.recording.stage_data_mut(),
                    ctx.client(client).recording.stage_data(),
                );
                if let Some(tracer) = tracer.as_deref_mut() {
                    tracer.record_intermediate_snapshot(&self.recording);
                }
                StepResult::Merged {
                    confidence: Some(confidence),
                    quality_flags,
                }
            }
            (Err(issues), _) => {
                ctx.mapping.discard();
                tracing::warn!(
                    client_id = %target_id,
                    reason = "POST_MERGE_CONSISTENCY",
                    issue_count = issues.len(),
                    "merge_step_rejected",
                );
                StepResult::Rejected {
                    reason: RejectionReason::PostMergeConsistency(issues),
                    quality_flags,
                }
            }
            (Ok(()), Err(confidence)) => {
                ctx.mapping.discard();
                tracing::warn!(
                    client_id = %target_id,
                    reason = "LOW_MERGE_CONFIDENCE",
                    overall = confidence.overall,
                    "merge_step_rejected",
                );
                StepResult::Rejected {
                    reason: RejectionReason::LowMergeConfidence(confidence),
                    quality_flags,
                }
            }
        };

        ctx.clients[client].result = result;
        if let Some(tracer) = tracer {
            tracer.end_merge_step(&ctx.clients[client]);
        }
    }

    /// Shifts the timeline so that its last recorded tick lies at the reference
    /// tick count, returning the number of ticks shifted.
    fn end_align_to_reference(
        &mut self,
        reference: ReferenceTicks,
        clients: &[RegisteredClient],
    ) -> Ticks {
        // If a client reported an in-game tick count, the stage has been completed,
        // so assume that the events are offset from the end of the stage.
        let offset = match reference.method {
            ReferenceMethod::RecordedTicks => Ticks(0),
            ReferenceMethod::AccurateModal
            | ReferenceMethod::PreciseServer
            | ReferenceMethod::ImpreciseServer => {
                Tick::at(reference.duration) - self.recording.last_tick()
            }
        };
        if offset.is_zero() {
            return offset;
        }

        self.recording.shift(offset);
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
        let end_seen_by_contributor = clients.iter().any(|client| {
            matches!(client.result, StepResult::Merged { .. })
                && client.client.info.server_ticks.is_some()
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

    fn map_target(
        &self,
        target: &ClientEvents,
        tracer: Option<&mut Tracer>,
    ) -> Option<(Mappings, Option<AlignmentResult>)> {
        if self.inherited_accurate && target.accurate {
            let last_tick = self.recording.last_tick();
            let mappings = Mappings {
                base: TickMapping::identity(last_tick),
                target: TickMapping::identity(last_tick),
                merged_last_tick: last_tick,
            };
            return Some((mappings, None));
        }

        let alignment = TickAligner::new(&self.recording, &target.recording, |a, b| {
            self.scorer.score(a, b)
        })
        .align();
        if let Some(tracer) = tracer {
            tracer.record_alignment(&alignment);
        }

        if alignment.alignments.is_empty() {
            // Found no compatible regions; nothing to merge.
            return None;
        }

        let entries: Vec<_> = alignment
            .alignments
            .iter()
            .map(|local| local.entries.clone())
            .collect();
        let mappings = TickMapping::from_alignment(
            self.recording.last_tick(),
            target.recording.last_tick(),
            &entries,
        );
        Some((mappings, Some(alignment)))
    }
}

/// Trust and shape metadata of a merged timeline.
#[derive(Debug)]
struct Metadata {
    status: StageStatus,
    offset: Ticks,
    precise_server_tick_count: bool,
    accurate_until: Tick,
    queryable_until: Tick,
}

/// A canonical timeline of stage events combined from clients' recordings.
#[derive(Debug)]
pub struct MergedTimeline {
    timeline: Timeline,
    metadata: Metadata,
}

impl MergedTimeline {
    fn new(timeline: Timeline, metadata: Metadata) -> MergedTimeline {
        MergedTimeline { timeline, metadata }
    }

    pub fn timeline(&self) -> &Timeline {
        &self.timeline
    }

    /// The overall status of the stage.
    pub fn status(&self) -> StageStatus {
        self.metadata.status
    }

    /// The duration of the stage.
    pub fn duration(&self) -> Ticks {
        self.timeline.last_tick().duration()
    }

    /// The number of ticks in the timeline on which no client recorded events.
    pub fn missing_tick_count(&self) -> u32 {
        u32::try_from(self.timeline.missing_tick_count()).expect("below MAX_RECORDED_TICK")
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

    /// Whether accuracy covers the entire stage.
    pub fn fully_accurate(&self) -> bool {
        self.timeline.last_tick() < self.metadata.accurate_until
    }

    /// Whether queryability covers the entire stage.
    pub fn fully_queryable(&self) -> bool {
        self.timeline.last_tick() < self.metadata.queryable_until
    }

    /// Limits the accuracy and queryability of the event stream to `tick`, exclusive.
    pub fn restrict_accuracy_to(&mut self, tick: Tick) {
        self.metadata.accurate_until = self.metadata.accurate_until.min(tick);
        self.metadata.queryable_until = self.metadata.queryable_until.min(tick);
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::too_many_lines)]

    use blert::proto::{Event, event};
    use blert::{Maze, PlayerAttack, Point, RoomId, SoteMazePivots, Source};
    use bytes::Bytes;
    use prost::Message;

    use super::*;
    use crate::lifecycle::core::types::{ClientId, ServerTicks, StageUpdate};
    use crate::proto::ChallengeEvents;

    fn nylocas_challenge() -> ChallengeInfo<'static> {
        static PARTY: std::sync::LazyLock<Vec<Rsn>> =
            std::sync::LazyLock::new(|| vec![Rsn::try_from("1Ogp").unwrap()]);
        fixtures::challenge_info(Stage::TobNylocas, ChallengeMode::TobRegular, &PARTY)
    }

    fn wave_event(tick: Tick, wave: u32) -> Event {
        fixtures::nylo_wave_event(event::Type::TobNyloWaveSpawn, tick, wave, 0, 12)
    }

    fn merge_one_client(accurate: bool, last_tick: Tick, events: Vec<Event>) -> MergedTimeline {
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
        merge(&challenge, Stage::TobNylocas, &records, None)
            .0
            .expect("stage has client data")
    }

    #[test]
    fn merge_of_an_empty_stream_is_none() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let challenge =
            fixtures::challenge_info(Stage::MokhaiotlDelve1, ChallengeMode::NoMode, &party);
        let (merged, report) = merge(&challenge, Stage::MokhaiotlDelve1, &[], None);
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
        let (merged, report) = merge(&challenge, Stage::TobNylocas, &records, None);
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
    fn stage_status_is_taken_from_the_most_complete_client() {
        let challenge = nylocas_challenge();
        let end =
            |client_id: u32, status: StageStatus, recorded_ticks: u32| ClientStageStream::End {
                client_id: ClientId(client_id),
                update: StageUpdate {
                    stage: Stage::TobNylocas,
                    status,
                    accurate: false,
                    recorded_ticks,
                    server_ticks: None,
                },
            };
        let records = vec![
            end(1, StageStatus::Wiped, 95),
            end(2, StageStatus::Completed, 90),
        ];
        let (merged, report) = merge(&challenge, Stage::TobNylocas, &records, None);
        let merged = merged.expect("stage has client data");
        assert_eq!(merged.status(), StageStatus::Completed);
        assert!(matches!(
            report.clients[0].status,
            MergeStatus::Merged {
                classification: MergeClassification::Reference,
                ..
            }
        ));
        assert_eq!(report.clients[0].stage_status, StageStatus::Wiped);
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
        let (merged, report) = merge(&challenge, Stage::TobNylocas, &records, None);
        assert!(merged.is_some());
        assert_eq!(
            report.clients,
            vec![
                ClientOutcome {
                    id: ClientId(2),
                    metadata: None,
                    primary_player: None,
                    stage_status: StageStatus::Completed,
                    reported_accurate: false,
                    accurate: false,
                    recorded_ticks: Ticks(10),
                    server_ticks: Some(ServerTicks {
                        count: 0,
                        precise: true,
                    }),
                    anomalies: Vec::new(),
                    consistency_issues: Vec::new(),
                    status: MergeStatus::Skipped {
                        error: "invalid server tick count".to_string(),
                    },
                },
                ClientOutcome {
                    id: ClientId(1),
                    metadata: None,
                    primary_player: None,
                    stage_status: StageStatus::Completed,
                    reported_accurate: false,
                    accurate: false,
                    recorded_ticks: Ticks(90),
                    server_ticks: None,
                    anomalies: Vec::new(),
                    consistency_issues: Vec::new(),
                    status: MergeStatus::Merged {
                        classification: MergeClassification::Reference,
                        confidence: None,
                        quality_flags: Vec::new(),
                    },
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
        let (merged, report) = merge(&challenge, Stage::TobNylocas, &records, None);
        assert!(merged.is_none());
        assert_eq!(
            report,
            MergeReport {
                alerts: Vec::new(),
                reference_ticks: None,
                clients: vec![ClientOutcome {
                    id: ClientId(1),
                    metadata: None,
                    primary_player: None,
                    stage_status: StageStatus::Wiped,
                    reported_accurate: false,
                    accurate: false,
                    recorded_ticks: Ticks(10),
                    server_ticks: Some(ServerTicks {
                        count: 0,
                        precise: true,
                    }),
                    anomalies: Vec::new(),
                    consistency_issues: Vec::new(),
                    status: MergeStatus::Skipped {
                        error: "invalid server tick count".to_string(),
                    },
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
        let end = |client_id: u32| ClientStageStream::End {
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

        let (merged, report) = merge(&challenge, Stage::TobNylocas, &records, None);

        assert!(merged.is_some());
        let outcome = |client_id: u32, status: report::MergeStatus| ClientOutcome {
            id: ClientId(client_id),
            metadata: None,
            primary_player: None,
            stage_status: StageStatus::Completed,
            reported_accurate: true,
            accurate: true,
            recorded_ticks: Ticks(90),
            server_ticks: Some(ServerTicks {
                count: 90,
                precise: true,
            }),
            anomalies: Vec::new(),
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
                    outcome(
                        1,
                        MergeStatus::Merged {
                            classification: MergeClassification::Reference,
                            confidence: None,
                            quality_flags: Vec::new(),
                        },
                    ),
                    outcome(
                        2,
                        MergeStatus::Merged {
                            classification: MergeClassification::Matching,
                            confidence: Some(report::StepConfidence {
                                overall: 1.0,
                                structural: report::StructuralConfidence {
                                    value: 1.0,
                                    identity: true,
                                    target_coverage: 1.0,
                                    segments: Vec::new(),
                                    worst_segment_idx: None,
                                },
                                content: report::ContentConfidence {
                                    value: 1.0,
                                    disagreement_rate: 0.0,
                                    large_gap_rate: 0.0,
                                    attack_mapped_failure_rate: 0.0,
                                },
                            }),
                            quality_flags: Vec::new(),
                        },
                    ),
                ],
                merged_count: 2,
                unmerged_count: 0,
                skipped_count: 0,
            }
        );
    }

    #[test]
    fn merge_step_failing_consistency_check_is_rejected() {
        let challenge = nylocas_challenge();
        let boss = |tick: Tick| fixtures::NpcEvent {
            tick,
            stage: Stage::TobNylocas,
            npc_id: blert::npc::id::NYLOCAS_VASILIAS_MELEE_REGULAR,
            room_id: 1001,
            ..Default::default()
        };
        let recording = |client_id: u32, death_tick: Tick| ClientStageStream::Events {
            client_id: ClientId(client_id),
            events: Bytes::from(
                ChallengeEvents {
                    events: vec![
                        fixtures::npc_spawn_event(boss(Tick(0))),
                        fixtures::npc_death_event(boss(death_tick)),
                    ],
                    ..Default::default()
                }
                .encode_to_vec(),
            ),
        };
        let end = |client_id: u32| ClientStageStream::End {
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
            recording(1, Tick(5)),
            recording(2, Tick(20)),
            end(1),
            end(2),
        ];

        let (merged, report) = merge(&challenge, Stage::TobNylocas, &records, None);
        let (base_only, _) = merge(
            &challenge,
            Stage::TobNylocas,
            &[recording(1, Tick(5)), end(1)],
            None,
        );

        assert_eq!(
            merged
                .expect("stage has client data")
                .timeline()
                .to_proto()
                .collect::<Vec<_>>(),
            base_only
                .expect("stage has client data")
                .timeline()
                .to_proto()
                .collect::<Vec<_>>(),
        );
        let outcome = |client_id: u32, status: report::MergeStatus| ClientOutcome {
            id: ClientId(client_id),
            metadata: None,
            primary_player: None,
            stage_status: StageStatus::Completed,
            reported_accurate: true,
            accurate: true,
            recorded_ticks: Ticks(90),
            server_ticks: Some(ServerTicks {
                count: 90,
                precise: true,
            }),
            anomalies: Vec::new(),
            consistency_issues: Vec::new(),
            status,
        };
        assert_eq!(
            report,
            MergeReport {
                alerts: vec![MergeAlert::PostMergeConsistencyRejections {
                    client_ids: vec![ClientId(2)],
                    total_issues: 1,
                }],
                reference_ticks: Some(ReferenceTicks {
                    duration: Ticks(90),
                    method: ReferenceMethod::AccurateModal,
                }),
                clients: vec![
                    outcome(
                        1,
                        MergeStatus::Merged {
                            classification: MergeClassification::Reference,
                            confidence: None,
                            quality_flags: Vec::new(),
                        },
                    ),
                    outcome(
                        2,
                        MergeStatus::Rejected {
                            classification: MergeClassification::Matching,
                            reason: report::RejectionReason::PostMergeConsistency {
                                issues: vec![report::MergeConsistencyIssue::DuplicateNpcDeath {
                                    room_id: RoomId(1001),
                                    occurrences: vec![
                                        report::NpcOccurrence {
                                            tick: Tick(5),
                                            npc_id: Some(
                                                blert::npc::id::NYLOCAS_VASILIAS_MELEE_REGULAR
                                            ),
                                        },
                                        report::NpcOccurrence {
                                            tick: Tick(20),
                                            npc_id: Some(
                                                blert::npc::id::NYLOCAS_VASILIAS_MELEE_REGULAR
                                            ),
                                        },
                                    ],
                                }],
                            },
                            quality_flags: Vec::new(),
                        },
                    ),
                ],
                merged_count: 1,
                unmerged_count: 1,
                skipped_count: 0,
            }
        );
    }

    #[test]
    fn merge_step_with_low_confidence_is_rejected() {
        let challenge = nylocas_challenge();
        let recording = |client_id: u32, attack: PlayerAttack| ClientStageStream::Events {
            client_id: ClientId(client_id),
            events: Bytes::from(
                ChallengeEvents {
                    events: [Tick(0), Tick(5), Tick(10)]
                        .into_iter()
                        .flat_map(|tick| {
                            [
                                fixtures::PlayerUpdateEvent::new(
                                    tick,
                                    Stage::TobNylocas,
                                    "1Ogp",
                                    (3290, 4250),
                                )
                                .build(),
                                fixtures::player_attack_event(fixtures::PlayerAttackEvent {
                                    tick,
                                    stage: Stage::TobNylocas,
                                    coords: (3290, 4250),
                                    name: "1Ogp",
                                    party_index: None,
                                    attack,
                                    weapon_id: 0,
                                    distance_to_target: 1,
                                    target: None,
                                }),
                            ]
                        })
                        .collect(),
                    ..Default::default()
                }
                .encode_to_vec(),
            ),
        };
        let end = |client_id: u32| ClientStageStream::End {
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
            recording(1, PlayerAttack::Scythe),
            recording(2, PlayerAttack::BgsSpec),
            end(1),
            end(2),
        ];

        let (merged, report) = merge(&challenge, Stage::TobNylocas, &records, None);
        let merged = merged.expect("stage has client data");
        let (base_only, _) = merge(
            &challenge,
            Stage::TobNylocas,
            &[recording(1, PlayerAttack::Scythe), end(1)],
            None,
        );

        assert_eq!(
            merged.timeline().to_proto().collect::<Vec<_>>(),
            base_only
                .expect("stage has client data")
                .timeline()
                .to_proto()
                .collect::<Vec<_>>(),
        );
        let player = merged.timeline().party_index(&challenge.party[0]).unwrap();
        let outcome = |client_id: u32, status: report::MergeStatus| ClientOutcome {
            id: ClientId(client_id),
            metadata: None,
            primary_player: None,
            stage_status: StageStatus::Completed,
            reported_accurate: true,
            accurate: true,
            recorded_ticks: Ticks(90),
            server_ticks: Some(ServerTicks {
                count: 90,
                precise: true,
            }),
            anomalies: Vec::new(),
            consistency_issues: Vec::new(),
            status,
        };
        assert_eq!(
            report,
            MergeReport {
                alerts: vec![MergeAlert::LowConfidenceRejections {
                    client_ids: vec![ClientId(2)],
                }],
                reference_ticks: Some(ReferenceTicks {
                    duration: Ticks(90),
                    method: ReferenceMethod::AccurateModal,
                }),
                clients: vec![
                    outcome(
                        1,
                        MergeStatus::Merged {
                            classification: MergeClassification::Reference,
                            confidence: None,
                            quality_flags: Vec::new(),
                        },
                    ),
                    outcome(
                        2,
                        MergeStatus::Rejected {
                            classification: MergeClassification::Matching,
                            reason: report::RejectionReason::LowMergeConfidence {
                                confidence: report::StepConfidence {
                                    overall: 0.7,
                                    structural: report::StructuralConfidence {
                                        value: 1.0,
                                        identity: true,
                                        target_coverage: 1.0,
                                        segments: Vec::new(),
                                        worst_segment_idx: None,
                                    },
                                    content: report::ContentConfidence {
                                        value: 0.4,
                                        disagreement_rate: 1.0,
                                        large_gap_rate: 0.0,
                                        attack_mapped_failure_rate: 0.0,
                                    },
                                },
                            },
                            quality_flags: vec![
                                report::QualityFlag::AttackTypeMismatch {
                                    tick: Tick(0),
                                    player,
                                    kept_type: PlayerAttack::Scythe as i32,
                                    discarded_type: PlayerAttack::BgsSpec as i32,
                                    kept_source: Source::Client(ClientId(1)),
                                    discarded_source: Source::Client(ClientId(2)),
                                },
                                report::QualityFlag::AttackTypeMismatch {
                                    tick: Tick(5),
                                    player,
                                    kept_type: PlayerAttack::Scythe as i32,
                                    discarded_type: PlayerAttack::BgsSpec as i32,
                                    kept_source: Source::Client(ClientId(1)),
                                    discarded_source: Source::Client(ClientId(2)),
                                },
                                report::QualityFlag::AttackTypeMismatch {
                                    tick: Tick(10),
                                    player,
                                    kept_type: PlayerAttack::Scythe as i32,
                                    discarded_type: PlayerAttack::BgsSpec as i32,
                                    kept_source: Source::Client(ClientId(1)),
                                    discarded_source: Source::Client(ClientId(2)),
                                },
                            ],
                        },
                    ),
                ],
                merged_count: 1,
                unmerged_count: 1,
                skipped_count: 0,
            }
        );
    }

    #[test]
    fn missing_ticks_counts_unrecorded_ticks() {
        let accurate = merge_one_client(true, Tick(5), vec![wave_event(Tick(4), 1)]);
        assert_eq!(accurate.timeline().last_tick(), Tick(5));
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
        let (merged, report) = merge(&challenge, Stage::TobNylocas, &records, None);
        let merged = merged.expect("stage has client data");
        assert_eq!(merged.timeline().last_tick(), Tick(8));
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

    #[test]
    fn merge_stage_data_unions_maze_pivots() {
        let mut stage_data = StageData::None;
        merge_stage_data(
            &mut stage_data,
            &StageData::Sotetseg {
                mazes: BTreeMap::from([(
                    Maze::Maze66,
                    SoteMazePivots {
                        overworld: vec![
                            Point(11, 0),
                            Point(7, 2),
                            Point(12, 4),
                            Point(11, 6),
                            Point(11, 8),
                            Point(9, 10),
                            Point(6, 12),
                            Point(6, 14),
                        ],
                        underworld: vec![],
                    },
                )]),
            },
        );
        assert_eq!(
            stage_data,
            StageData::Sotetseg {
                mazes: BTreeMap::from([(
                    Maze::Maze66,
                    SoteMazePivots {
                        overworld: vec![
                            Point(11, 0),
                            Point(7, 2),
                            Point(12, 4),
                            Point(11, 6),
                            Point(11, 8),
                            Point(9, 10),
                            Point(6, 12),
                            Point(6, 14),
                        ],
                        underworld: vec![],
                    },
                )]),
            }
        );

        let mut stage_data = StageData::Sotetseg {
            mazes: BTreeMap::from([(
                Maze::Maze66,
                SoteMazePivots {
                    overworld: vec![
                        Point(8, 0),
                        Point(8, 2),
                        Point(11, 4),
                        Point(7, 6),
                        Point(2, 8),
                        Point(7, 10),
                        Point(7, 12),
                    ],
                    underworld: vec![],
                },
            )]),
        };
        merge_stage_data(
            &mut stage_data,
            &StageData::Sotetseg {
                mazes: BTreeMap::from([(
                    Maze::Maze66,
                    SoteMazePivots {
                        overworld: vec![
                            Point(8, 0),
                            Point(8, 2),
                            Point(11, 4),
                            Point(7, 6),
                            Point(2, 8),
                            Point(7, 10),
                            Point(7, 12),
                        ],
                        underworld: vec![
                            Point(8, 0),
                            Point(8, 2),
                            Point(11, 4),
                            Point(7, 6),
                            Point(2, 8),
                            Point(7, 10),
                            Point(7, 12),
                            Point(3, 14),
                        ],
                    },
                )]),
            },
        );
        assert_eq!(
            stage_data,
            StageData::Sotetseg {
                mazes: BTreeMap::from([(
                    Maze::Maze66,
                    SoteMazePivots {
                        overworld: vec![
                            Point(8, 0),
                            Point(8, 2),
                            Point(11, 4),
                            Point(7, 6),
                            Point(2, 8),
                            Point(7, 10),
                            Point(7, 12),
                        ],
                        underworld: vec![
                            Point(8, 0),
                            Point(8, 2),
                            Point(11, 4),
                            Point(7, 6),
                            Point(2, 8),
                            Point(7, 10),
                            Point(7, 12),
                            Point(3, 14),
                        ],
                    },
                )]),
            }
        );
    }
}

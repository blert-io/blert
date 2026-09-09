//! The outcomes of a merge run.

use serde::{Deserialize, Serialize};

use crate::lifecycle::core::types::{ClientId, ServerTicks, StageStatus, UserId};

use super::client_consistency;
use super::client_events::{Anomaly, BadDataClient, PluginInfo};
use super::confidence;
use super::consolidator::{self, Disagreement};
use super::merge_consistency;
use super::timeline::{self, Target};
use super::{ReferenceTicks, RegisteredClient, StepResult, Tick, Ticks};

#[derive(Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientMetadata {
    pub user_id: UserId,
    pub plugin_version: String,
    #[serde(rename = "runeLiteVersion")]
    pub runelite_version: String,
}

#[derive(Debug, PartialEq, Deserialize, Serialize)]
#[serde(tag = "kind", content = "id", rename_all = "lowercase")]
pub enum Actor {
    Npc(u64),
    Player(String),
}

impl From<&Target<'_>> for Actor {
    fn from(target: &Target<'_>) -> Self {
        match target {
            Target::Npc { room_id, .. } => Self::Npc(*room_id),
            Target::Player(name) => Self::Player((*name).to_string()),
        }
    }
}

impl From<timeline::Actor<'_>> for Actor {
    fn from(actor: timeline::Actor<'_>) -> Self {
        match actor {
            timeline::Actor::Npc(room_id) => Self::Npc(room_id),
            timeline::Actor::Player(name) => Self::Player(name.to_string()),
        }
    }
}

/// A consistency issue detected in a client's recording.
#[derive(Debug, PartialEq, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ConsistencyIssue {
    #[serde(rename_all = "camelCase")]
    LargeJump {
        player: String,
        tick: Tick,
        last_tick: Tick,
        start_x: i32,
        start_y: i32,
        end_x: i32,
        end_y: i32,
    },
    #[serde(rename_all = "camelCase")]
    InvalidEventSequence { kind: i32, tick: Tick },
    #[serde(rename_all = "camelCase")]
    InvalidTickGap {
        kind: i32,
        tick: Tick,
        observed: Ticks,
        min: Ticks,
    },
}

impl From<client_consistency::ConsistencyIssue<'_>> for ConsistencyIssue {
    fn from(issue: client_consistency::ConsistencyIssue<'_>) -> ConsistencyIssue {
        use client_consistency::ConsistencyIssue as Issue;
        match issue {
            Issue::LargeJump {
                player,
                tick,
                last_tick,
                start,
                end,
            } => ConsistencyIssue::LargeJump {
                player: player.to_string(),
                tick,
                last_tick,
                start_x: start.x,
                start_y: start.y,
                end_x: end.x,
                end_y: end.y,
            },
            Issue::InvalidEventSequence { kind, tick } => ConsistencyIssue::InvalidEventSequence {
                kind: kind as i32,
                tick,
            },
            Issue::InvalidTickGap {
                kind,
                tick,
                observed,
                min,
            } => ConsistencyIssue::InvalidTickGap {
                kind: kind as i32,
                tick,
                observed,
                min,
            },
        }
    }
}

impl From<&PluginInfo> for ClientMetadata {
    fn from(plugin_info: &PluginInfo) -> Self {
        Self {
            user_id: plugin_info.user_id,
            plugin_version: plugin_info.plugin_version.clone(),
            runelite_version: plugin_info.runelite_version.clone(),
        }
    }
}

#[derive(Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MergeClassification {
    Reference,
    Matching,
    Mismatched,
}

impl MergeClassification {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Reference => "REFERENCE",
            Self::Matching => "MATCHING",
            Self::Mismatched => "MISMATCHED",
        }
    }
}

impl From<super::Classification> for MergeClassification {
    fn from(classification: super::Classification) -> Self {
        match classification {
            super::Classification::Reference => Self::Reference,
            super::Classification::Matching => Self::Matching,
            super::Classification::Mismatched => Self::Mismatched,
        }
    }
}

#[derive(Debug, PartialEq, Deserialize, Serialize)]
#[serde(
    tag = "status",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
pub enum MergeStatus {
    Skipped {
        error: String,
    },
    Merged {
        classification: MergeClassification,
        confidence: Option<StepConfidence>,
        quality_flags: Vec<QualityFlag>,
    },
    Unmerged {
        classification: MergeClassification,
    },
    Rejected {
        classification: MergeClassification,
        reason: RejectionReason,
        quality_flags: Vec<QualityFlag>,
    },
}

impl MergeStatus {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Skipped { .. } => "SKIPPED",
            Self::Merged { .. } => "MERGED",
            Self::Unmerged { .. } => "UNMERGED",
            Self::Rejected { .. } => "REJECTED",
        }
    }

    pub fn classification(&self) -> Option<&MergeClassification> {
        match self {
            Self::Skipped { .. } => None,
            Self::Merged { classification, .. }
            | Self::Unmerged { classification }
            | Self::Rejected { classification, .. } => Some(classification),
        }
    }
}

impl From<&RegisteredClient<'_>> for MergeStatus {
    fn from(client: &RegisteredClient<'_>) -> Self {
        let classification = client.classification.into();
        match &client.result {
            StepResult::Unmerged => Self::Unmerged { classification },
            StepResult::Merged {
                confidence,
                quality_flags,
            } => Self::Merged {
                classification,
                confidence: confidence.as_ref().map(StepConfidence::from),
                quality_flags: quality_flags.iter().map(QualityFlag::from).collect(),
            },
            StepResult::Rejected {
                reason,
                quality_flags,
            } => Self::Rejected {
                classification,
                reason: reason.into(),
                quality_flags: quality_flags.iter().map(QualityFlag::from).collect(),
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Base,
    Target,
}

impl From<consolidator::Side> for Side {
    fn from(side: consolidator::Side) -> Self {
        match side {
            consolidator::Side::Base => Self::Base,
            consolidator::Side::Target => Self::Target,
        }
    }
}

#[derive(Debug, PartialEq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
pub enum QualityFlag {
    AttackTypeMismatch {
        tick: Tick,
        player: String,
        kept_type: i32,
        discarded_type: i32,
        kept_source_client_id: ClientId,
        discarded_source_client_id: ClientId,
    },
    AttackTargetMismatch {
        tick: Tick,
        player: String,
        kept_target: Actor,
        discarded_target: Actor,
        kept_source_client_id: ClientId,
        discarded_source_client_id: ClientId,
    },
    SpellTypeMismatch {
        tick: Tick,
        player: String,
        kept_type: i32,
        discarded_type: i32,
        kept_source_client_id: ClientId,
        discarded_source_client_id: ClientId,
    },
    SpellTargetMismatch {
        tick: Tick,
        player: String,
        kept_target: Actor,
        discarded_target: Actor,
        kept_source_client_id: ClientId,
        discarded_source_client_id: ClientId,
    },
    NpcAttackTypeMismatch {
        tick: Tick,
        room_id: u64,
        npc_id: u32,
        kept_type: i32,
        discarded_type: i32,
        kept_source_client_id: ClientId,
        discarded_source_client_id: ClientId,
    },
    NpcAttackTargetMismatch {
        tick: Tick,
        room_id: u64,
        npc_id: u32,
        kept_target: Actor,
        discarded_target: Actor,
        kept_source_client_id: ClientId,
        discarded_source_client_id: ClientId,
    },
    UnexpectedConflict {
        event_type: i32,
        attack_tick: Tick,
        kept_source_client_id: ClientId,
        discarded_source_client_id: ClientId,
    },
    LargeTemporalGap {
        event_type: i32,
        tick_gap: Ticks,
        base_tick: Tick,
        target_tick: Tick,
    },
    UnmappedCrossTickReference {
        event_type: i32,
        merged_tick: Tick,
        source_tick: Tick,
        resolved_tick: Tick,
    },
    AttackMappedNotFound {
        event_type: i32,
        source: Side,
        client_tick: Tick,
        client_attack_tick: Tick,
    },
}

impl QualityFlag {
    pub fn name(&self) -> &'static str {
        match self {
            Self::AttackTypeMismatch { .. } => "ATTACK_TYPE_MISMATCH",
            Self::AttackTargetMismatch { .. } => "ATTACK_TARGET_MISMATCH",
            Self::SpellTypeMismatch { .. } => "SPELL_TYPE_MISMATCH",
            Self::SpellTargetMismatch { .. } => "SPELL_TARGET_MISMATCH",
            Self::NpcAttackTypeMismatch { .. } => "NPC_ATTACK_TYPE_MISMATCH",
            Self::NpcAttackTargetMismatch { .. } => "NPC_ATTACK_TARGET_MISMATCH",
            Self::UnexpectedConflict { .. } => "UNEXPECTED_CONFLICT",
            Self::LargeTemporalGap { .. } => "LARGE_TEMPORAL_GAP",
            Self::UnmappedCrossTickReference { .. } => "UNMAPPED_CROSS_TICK_REFERENCE",
            Self::AttackMappedNotFound { .. } => "ATTACK_MAPPED_NOT_FOUND",
        }
    }
}

impl From<&consolidator::QualityFlag<'_>> for QualityFlag {
    #[expect(clippy::too_many_lines)]
    fn from(flag: &consolidator::QualityFlag<'_>) -> Self {
        match flag {
            consolidator::QualityFlag::Disagreement {
                tick,
                kept_source,
                discarded_source,
                subject,
            } => {
                let tick = *tick;
                let kept_source_client_id = *kept_source;
                let discarded_source_client_id = *discarded_source;
                match subject {
                    Disagreement::PlayerAttackKind {
                        player,
                        kept,
                        discarded,
                    } => Self::AttackTypeMismatch {
                        tick,
                        player: (*player).to_string(),
                        kept_type: *kept as i32,
                        discarded_type: *discarded as i32,
                        kept_source_client_id,
                        discarded_source_client_id,
                    },
                    Disagreement::PlayerAttackTarget {
                        player,
                        kept,
                        discarded,
                    } => Self::AttackTargetMismatch {
                        tick,
                        player: (*player).to_string(),
                        kept_target: kept.into(),
                        discarded_target: discarded.into(),
                        kept_source_client_id,
                        discarded_source_client_id,
                    },
                    Disagreement::PlayerSpellKind {
                        player,
                        kept,
                        discarded,
                    } => Self::SpellTypeMismatch {
                        tick,
                        player: (*player).to_string(),
                        kept_type: *kept as i32,
                        discarded_type: *discarded as i32,
                        kept_source_client_id,
                        discarded_source_client_id,
                    },
                    Disagreement::PlayerSpellTarget {
                        player,
                        kept,
                        discarded,
                    } => Self::SpellTargetMismatch {
                        tick,
                        player: (*player).to_string(),
                        kept_target: kept.into(),
                        discarded_target: discarded.into(),
                        kept_source_client_id,
                        discarded_source_client_id,
                    },
                    Disagreement::NpcAttackKind {
                        room_id,
                        npc_id,
                        kept,
                        discarded,
                    } => Self::NpcAttackTypeMismatch {
                        tick,
                        room_id: *room_id,
                        npc_id: *npc_id,
                        kept_type: *kept as i32,
                        discarded_type: *discarded as i32,
                        kept_source_client_id,
                        discarded_source_client_id,
                    },
                    Disagreement::NpcAttackTarget {
                        room_id,
                        npc_id,
                        kept,
                        discarded,
                    } => Self::NpcAttackTargetMismatch {
                        tick,
                        room_id: *room_id,
                        npc_id: *npc_id,
                        kept_target: kept.into(),
                        discarded_target: discarded.into(),
                        kept_source_client_id,
                        discarded_source_client_id,
                    },
                    Disagreement::AttackMapped { kind } => Self::UnexpectedConflict {
                        event_type: *kind as i32,
                        attack_tick: tick,
                        kept_source_client_id,
                        discarded_source_client_id,
                    },
                }
            }
            consolidator::QualityFlag::LargeTemporalGap {
                kind,
                gap,
                base_tick,
                target_tick,
            } => Self::LargeTemporalGap {
                event_type: *kind as i32,
                tick_gap: *gap,
                base_tick: *base_tick,
                target_tick: *target_tick,
            },
            consolidator::QualityFlag::UnmappedCrossTickReference {
                kind,
                merged_tick,
                source_tick,
                resolved_tick,
            } => Self::UnmappedCrossTickReference {
                event_type: *kind as i32,
                merged_tick: *merged_tick,
                source_tick: *source_tick,
                resolved_tick: *resolved_tick,
            },
            consolidator::QualityFlag::AttackMappedNotFound {
                kind,
                side,
                client_tick,
                client_attack_tick,
            } => Self::AttackMappedNotFound {
                event_type: *kind as i32,
                source: (*side).into(),
                client_tick: *client_tick,
                client_attack_tick: *client_attack_tick,
            },
        }
    }
}

#[derive(Debug, PartialEq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
pub enum RejectionReason {
    PostMergeConsistency { issues: Vec<MergeConsistencyIssue> },
    LowMergeConfidence { confidence: StepConfidence },
}

impl From<&super::RejectionReason<'_>> for RejectionReason {
    fn from(reason: &super::RejectionReason<'_>) -> Self {
        match reason {
            super::RejectionReason::PostMergeConsistency(issues) => Self::PostMergeConsistency {
                issues: issues.iter().map(MergeConsistencyIssue::from).collect(),
            },
            super::RejectionReason::LowMergeConfidence(confidence) => Self::LowMergeConfidence {
                confidence: confidence.into(),
            },
        }
    }
}

#[derive(Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepConfidence {
    pub overall: f64,
    pub structural: StructuralConfidence,
    pub content: ContentConfidence,
}

impl StepConfidence {
    pub fn worst_segment_score(&self) -> Option<f64> {
        self.structural
            .worst_segment_idx
            .map(|idx| self.structural.segments[idx].score)
    }
}

#[derive(Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuralConfidence {
    pub value: f64,
    pub identity: bool,
    pub target_coverage: f64,
    pub segments: Vec<SegmentConfidence>,
    pub worst_segment_idx: Option<usize>,
}

#[derive(Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentConfidence {
    pub base_start: usize,
    pub base_end: usize,
    pub discriminability: f64,
    pub bonus_support: f64,
    pub score: f64,
}

#[derive(Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentConfidence {
    pub value: f64,
    pub disagreement_rate: f64,
    pub large_gap_rate: f64,
    pub attack_mapped_failure_rate: f64,
}

impl From<&super::StepConfidence> for StepConfidence {
    fn from(confidence: &super::StepConfidence) -> Self {
        Self {
            overall: confidence.overall,
            structural: StructuralConfidence::from(&confidence.structural),
            content: ContentConfidence::from(&confidence.content),
        }
    }
}

impl From<&confidence::StructuralConfidence> for StructuralConfidence {
    fn from(structural: &confidence::StructuralConfidence) -> Self {
        Self {
            value: structural.value,
            identity: structural.identity,
            target_coverage: structural.target_coverage,
            segments: structural
                .segments
                .iter()
                .map(SegmentConfidence::from)
                .collect(),
            worst_segment_idx: structural.worst_segment_idx,
        }
    }
}

impl From<&confidence::SegmentConfidence> for SegmentConfidence {
    fn from(segment: &confidence::SegmentConfidence) -> Self {
        Self {
            base_start: segment.base_start,
            base_end: segment.base_end,
            discriminability: segment.discriminability,
            bonus_support: segment.bonus_support,
            score: segment.score,
        }
    }
}

impl From<&confidence::ContentConfidence> for ContentConfidence {
    fn from(content: &confidence::ContentConfidence) -> Self {
        Self {
            value: content.value,
            disagreement_rate: content.disagreement_rate,
            large_gap_rate: content.large_gap_rate,
            attack_mapped_failure_rate: content.attack_mapped_failure_rate,
        }
    }
}

/// A client's merge outcome.
#[derive(Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientOutcome {
    pub id: ClientId,
    pub metadata: Option<ClientMetadata>,
    pub primary_player: Option<String>,
    pub stage_status: StageStatus,
    pub reported_accurate: bool,
    pub accurate: bool,
    pub recorded_ticks: Ticks,
    pub server_ticks: Option<ServerTicks>,
    pub anomalies: Vec<ClientAnomaly>,
    pub consistency_issues: Vec<ConsistencyIssue>,
    #[serde(flatten)]
    pub status: MergeStatus,
}

impl From<&RegisteredClient<'_>> for ClientOutcome {
    fn from(client: &RegisteredClient<'_>) -> Self {
        let info = &client.client.info;
        ClientOutcome {
            id: info.id,
            metadata: info.plugin_info.as_ref().map(ClientMetadata::from),
            primary_player: info.primary_player.map(str::to_string),
            stage_status: info.status,
            reported_accurate: info.reported_accurate,
            accurate: client.client.accurate,
            recorded_ticks: info.last_recorded_tick.duration(),
            server_ticks: info.server_ticks,
            anomalies: client
                .client
                .anomalies
                .iter()
                .map(ClientAnomaly::from)
                .collect(),
            consistency_issues: client
                .client
                .consistency_issues
                .iter()
                .cloned()
                .map(ConsistencyIssue::from)
                .collect(),
            status: MergeStatus::from(client),
        }
    }
}

impl From<BadDataClient<'_>> for ClientOutcome {
    fn from(client: BadDataClient<'_>) -> Self {
        let info = client.info;
        ClientOutcome {
            id: info.id,
            metadata: info.plugin_info.as_ref().map(ClientMetadata::from),
            primary_player: info.primary_player.map(str::to_string),
            stage_status: info.status,
            reported_accurate: info.reported_accurate,
            accurate: false,
            recorded_ticks: info.last_recorded_tick.duration(),
            server_ticks: info.server_ticks,
            anomalies: Vec::new(),
            consistency_issues: Vec::new(),
            status: MergeStatus::Skipped {
                error: client.error.to_string(),
            },
        }
    }
}

#[derive(Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ClientAnomaly {
    MissingStageMetadata,
    InvalidTickCount,
    EventsBeyondReportedTicks,
    UnknownPlayer,
}

impl ClientAnomaly {
    pub fn name(&self) -> &'static str {
        match self {
            Self::MissingStageMetadata => "MISSING_STAGE_METADATA",
            Self::InvalidTickCount => "INVALID_TICK_COUNT",
            Self::EventsBeyondReportedTicks => "EVENTS_BEYOND_REPORTED_TICKS",
            Self::UnknownPlayer => "UNKNOWN_PLAYER",
        }
    }
}

impl From<&Anomaly> for ClientAnomaly {
    fn from(anomaly: &Anomaly) -> Self {
        match anomaly {
            Anomaly::MissingStageMetadata => Self::MissingStageMetadata,
            Anomaly::InvalidTickCount => Self::InvalidTickCount,
            Anomaly::EventsBeyondReportedTicks => Self::EventsBeyondReportedTicks,
            Anomaly::UnknownPlayer => Self::UnknownPlayer,
        }
    }
}

/// A notable condition encountered while merging a stage's clients.
#[derive(Debug, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
pub enum MergeAlert {
    /// Clients sent conflicting server tick counts.
    MultipleServerTickCounts {
        precise: bool,
        tick_counts: Vec<Ticks>,
    },
    /// The timeline was shifted forward to fit a reference tick count.
    TimelineOffsetApplied { offset: Ticks },
    /// Merge steps were rejected for violating game invariants.
    PostMergeConsistencyRejections {
        client_ids: Vec<ClientId>,
        total_issues: usize,
    },
    /// Merge steps were rejected because their confidence scores fell below
    /// the acceptance threshold.
    LowConfidenceRejections { client_ids: Vec<ClientId> },
    /// Clients were merged which had a segment of their alignment score below
    /// the structural confidence warning threshold.
    LowStructuralConfidence {
        worst_segment_scores: Vec<(ClientId, f64)>,
    },
}

impl MergeAlert {
    pub fn name(&self) -> &'static str {
        match self {
            Self::MultipleServerTickCounts { .. } => "MULTIPLE_SERVER_TICK_COUNTS",
            Self::TimelineOffsetApplied { .. } => "TIMELINE_OFFSET_APPLIED",
            Self::PostMergeConsistencyRejections { .. } => "POST_MERGE_CONSISTENCY_REJECTIONS",
            Self::LowConfidenceRejections { .. } => "LOW_CONFIDENCE_REJECTIONS",
            Self::LowStructuralConfidence { .. } => "LOW_STRUCTURAL_CONFIDENCE",
        }
    }
}

#[derive(Debug, PartialEq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
pub enum MergeConsistencyIssue {
    DuplicatePlayerDeath {
        player: String,
        ticks: Vec<Tick>,
    },
    DuplicateNpcSpawn {
        room_id: u64,
        occurrences: Vec<NpcOccurrence>,
    },
    DuplicateNpcDeath {
        room_id: u64,
        occurrences: Vec<NpcOccurrence>,
    },
    DuplicateStreamEvent {
        event_type: i32,
        identity_key: String,
        ticks: Vec<Tick>,
    },
    WeaponCooldownViolation {
        player: String,
        previous: PlayerAttackOccurrence,
        current: PlayerAttackOccurrence,
        cooldown: Ticks,
    },
    DeathBeforeSpawn {
        room_id: u64,
        death_tick: Tick,
        spawn_tick: Option<Tick>,
    },
    PhaseOutOfOrder {
        previous: PhaseOccurrence,
        current: PhaseOccurrence,
    },
    AttackTargetMissing {
        tick: Tick,
        attacker: Actor,
        target: Actor,
    },
    ExclusiveEventViolation {
        exclusive_types: (i32, i32),
        tick: Tick,
    },
}

#[derive(Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcOccurrence {
    pub tick: Tick,
    pub npc_id: u32,
}

#[derive(Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerAttackOccurrence {
    pub tick: Tick,
    pub r#type: i32,
}

#[derive(Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseOccurrence {
    pub event_type: i32,
    pub identity_key: String,
    pub tick: Tick,
}

impl From<&merge_consistency::NpcOccurrence> for NpcOccurrence {
    fn from(occurrence: &merge_consistency::NpcOccurrence) -> Self {
        Self {
            tick: occurrence.tick,
            npc_id: occurrence.npc_id,
        }
    }
}

impl From<&merge_consistency::PlayerAttackOccurrence> for PlayerAttackOccurrence {
    fn from(occurrence: &merge_consistency::PlayerAttackOccurrence) -> Self {
        Self {
            tick: occurrence.tick,
            r#type: occurrence.kind as i32,
        }
    }
}

impl From<&merge_consistency::PhaseOccurrence> for PhaseOccurrence {
    fn from(occurrence: &merge_consistency::PhaseOccurrence) -> Self {
        Self {
            event_type: occurrence.kind as i32,
            identity_key: occurrence.identity_key.clone(),
            tick: occurrence.tick,
        }
    }
}

impl From<&merge_consistency::MergeConsistencyIssue<'_>> for MergeConsistencyIssue {
    fn from(issue: &merge_consistency::MergeConsistencyIssue<'_>) -> Self {
        use merge_consistency::MergeConsistencyIssue as Issue;
        match issue {
            Issue::DuplicatePlayerDeath { player, ticks } => Self::DuplicatePlayerDeath {
                player: (*player).to_string(),
                ticks: ticks.clone(),
            },
            Issue::DuplicateNpcSpawn {
                room_id,
                occurrences,
            } => Self::DuplicateNpcSpawn {
                room_id: *room_id,
                occurrences: occurrences.iter().map(NpcOccurrence::from).collect(),
            },
            Issue::DuplicateNpcDeath {
                room_id,
                occurrences,
            } => Self::DuplicateNpcDeath {
                room_id: *room_id,
                occurrences: occurrences.iter().map(NpcOccurrence::from).collect(),
            },
            Issue::DuplicateStreamEvent {
                kind,
                identity_key,
                ticks,
            } => Self::DuplicateStreamEvent {
                event_type: *kind as i32,
                identity_key: identity_key.clone(),
                ticks: ticks.clone(),
            },
            Issue::WeaponCooldownViolation {
                player,
                previous,
                current,
                cooldown,
            } => Self::WeaponCooldownViolation {
                player: (*player).to_string(),
                previous: previous.into(),
                current: current.into(),
                cooldown: *cooldown,
            },
            Issue::DeathBeforeSpawn {
                room_id,
                death_tick,
                spawn_tick,
            } => Self::DeathBeforeSpawn {
                room_id: *room_id,
                death_tick: *death_tick,
                spawn_tick: *spawn_tick,
            },
            Issue::PhaseOutOfOrder { previous, current } => Self::PhaseOutOfOrder {
                previous: previous.into(),
                current: current.into(),
            },
            Issue::AttackTargetMissing {
                tick,
                attacker,
                target,
            } => Self::AttackTargetMissing {
                tick: *tick,
                attacker: (*attacker).into(),
                target: (*target).into(),
            },
            Issue::ExclusiveEventViolation {
                exclusive_types: (a, b),
                tick,
            } => Self::ExclusiveEventViolation {
                exclusive_types: (*a as i32, *b as i32),
                tick: *tick,
            },
        }
    }
}

/// A summary of what occurred during a merge run.
#[derive(Debug, PartialEq)]
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
    pub(super) fn new(
        clients: Vec<ClientOutcome>,
        reference_ticks: ReferenceTicks,
        alerts: Vec<MergeAlert>,
    ) -> MergeReport {
        let mut merged_count = 0;
        let mut unmerged_count = 0;
        let mut skipped_count = 0;
        for client in &clients {
            match client.status {
                MergeStatus::Merged { .. } => merged_count += 1,
                MergeStatus::Unmerged { .. } | MergeStatus::Rejected { .. } => unmerged_count += 1,
                MergeStatus::Skipped { .. } => skipped_count += 1,
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
    pub(super) fn empty(clients: Vec<ClientOutcome>) -> MergeReport {
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

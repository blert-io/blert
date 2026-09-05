//! Merge run tracing.

use std::collections::BTreeMap;
use std::time::Instant;

use serde::Serialize;

use crate::lifecycle::core::types::{ClientId, UserId};
use crate::proto::event;

use super::alignment::{AlignmentEntry, AlignmentRange, AlignmentResult, LocalAlignment};
use super::classification::{ClientClassification, ReferenceMethod};
use super::client_events::{self, BadDataClient, ClientEvents, ReportedInfo};
use super::consolidator::Disagreement;
use super::event::IdentityKey;
use super::mapping::{MergeMapping, TickMapping};
use super::timeline::{GraphicsCoords, GraphicsKind, NpcState, PlayerState, Target, TickState};
use super::{Tick, Ticks};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InputClient {
    client_id: ClientId,
    primary_player: Option<String>,
    metadata: Option<ClientMetadata>,
    reported_accurate: bool,
    accurate: bool,
    recorded_ticks: u32,
    ticks: Vec<TickSummary>,
    stage_data: StageData,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClientMetadata {
    user_id: UserId,
    plugin_version: String,
    rune_lite_version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StageData {
    sote_pivots: Vec<SotePivot>,
}

impl From<&client_events::StageData> for StageData {
    fn from(data: &client_events::StageData) -> Self {
        match data {
            client_events::StageData::None => Self {
                sote_pivots: Vec::new(),
            },
            client_events::StageData::Sotetseg { pivots } => Self {
                sote_pivots: pivots
                    .iter()
                    .map(|pivot| SotePivot {
                        maze: pivot.maze as i32,
                        overworld: pivot.overworld.iter().map(Coords::from).collect(),
                        underworld: pivot.underworld.iter().map(Coords::from).collect(),
                    })
                    .collect(),
            },
        }
    }
}

#[derive(Debug, Serialize)]
struct SotePivot {
    maze: i32,
    overworld: Vec<Coords>,
    underworld: Vec<Coords>,
}

#[derive(Debug, Serialize)]
struct Coords {
    x: i32,
    y: i32,
}

impl From<&crate::proto::Coords> for Coords {
    fn from(coords: &crate::proto::Coords) -> Self {
        Self {
            x: coords.x,
            y: coords.y,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceSelection {
    count: Ticks,
    method: ReferenceSelectionMethod,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum ReferenceSelectionMethod {
    AccurateModal,
    PreciseServer,
    ImpreciseServer,
    RecordedTicks,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Classification {
    reference_selection: ReferenceSelection,
    base_client_id: ClientId,
    matching_client_ids: Vec<ClientId>,
    mismatched_client_ids: Vec<ClientId>,
    accuracy_demotions: Vec<ClientId>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerAttackSummary {
    r#type: i32,
    weapon_id: Option<i32>,
    target: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerSummary {
    username: String,
    source: i32,
    x: i32,
    y: i32,
    attack: Option<PlayerAttackSummary>,
}

impl From<(&str, &PlayerState)> for PlayerSummary {
    fn from((username, state): (&str, &PlayerState)) -> Self {
        Self {
            username: username.to_string(),
            source: state.data_source as i32,
            x: state.position.x,
            y: state.position.y,
            attack: state.attack.as_ref().map(|attack| PlayerAttackSummary {
                r#type: attack.value.kind as i32,
                weapon_id: attack.value.weapon.as_ref().map(|weapon| weapon.id),
                target: attack
                    .value
                    .target
                    .as_ref()
                    .and_then(|target| match &target.value {
                        Target::Npc { room_id, .. } => Some(*room_id),
                        Target::Player(_) => None,
                    }),
            }),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillLevelSummary {
    current: u16,
    base: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NpcAttackSummary {
    r#type: i32,
    target: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NpcSummary {
    room_id: u64,
    id: u32,
    x: i32,
    y: i32,
    hitpoints: SkillLevelSummary,
    attack: Option<NpcAttackSummary>,
}

impl From<(u64, &NpcState)> for NpcSummary {
    fn from((room_id, state): (u64, &NpcState)) -> Self {
        Self {
            room_id,
            id: state.id,
            x: state.position.x,
            y: state.position.y,
            hitpoints: SkillLevelSummary {
                current: state.hitpoints.current,
                base: state.hitpoints.base,
            },
            attack: state.attack.as_ref().map(|attack| NpcAttackSummary {
                r#type: attack.value.kind as i32,
                target: attack
                    .value
                    .target
                    .as_ref()
                    .and_then(|target| match &target.value {
                        Target::Player(name) => Some(name.clone()),
                        Target::Npc { .. } => None,
                    }),
            }),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GraphicsSummary {
    r#type: &'static str,
    counts_by_source: BTreeMap<ClientId, u32>,
}

impl From<(&GraphicsKind, &GraphicsCoords)> for GraphicsSummary {
    fn from((kind, coords): (&GraphicsKind, &GraphicsCoords)) -> Self {
        let mut counts_by_source: BTreeMap<ClientId, u32> = BTreeMap::new();
        for sourced in coords.iter() {
            *counts_by_source.entry(sourced.source).or_default() += 1;
        }
        Self {
            r#type: match kind {
                GraphicsKind::MaidenBloodSplats => "TOB_MAIDEN_BLOOD_SPLATS",
                GraphicsKind::SoteMazeTiles => "TOB_SOTE_OVERWORLD_TILES",
                GraphicsKind::VerzikYellows => "TOB_VERZIK_YELLOWS",
            },
            counts_by_source,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TickSummary {
    tick: Tick,
    players: Vec<PlayerSummary>,
    npcs: Vec<NpcSummary>,
    graphics: Vec<GraphicsSummary>,
    event_counts: BTreeMap<&'static str, u32>,
}

impl From<&TickState> for TickSummary {
    fn from(state: &TickState) -> Self {
        let mut event_counts: BTreeMap<&'static str, u32> = BTreeMap::new();
        for event in state.events() {
            *event_counts
                .entry(event.r#type().as_str_name())
                .or_default() += 1;
        }
        Self {
            tick: state.tick(),
            players: state.players().map(PlayerSummary::from).collect(),
            npcs: state.npcs().map(NpcSummary::from).collect(),
            graphics: state.graphics().map(GraphicsSummary::from).collect(),
            event_counts,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum StepClassification {
    Reference,
    Matching,
    Mismatched,
}

impl From<super::Classification> for StepClassification {
    fn from(classification: super::Classification) -> Self {
        match classification {
            super::Classification::Reference => Self::Reference,
            super::Classification::Matching => Self::Matching,
            super::Classification::Mismatched => Self::Mismatched,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum StepStatus {
    Merged,
    Unmerged,
    Skipped,
}

impl From<&super::MergeStatus> for StepStatus {
    fn from(status: &super::MergeStatus) -> Self {
        match status {
            super::MergeStatus::Merged(_) => Self::Merged,
            super::MergeStatus::Unmerged(_) => Self::Unmerged,
            super::MergeStatus::Skipped(_) => Self::Skipped,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "action",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
enum StepAlignmentEntry {
    Merge {
        base_index: usize,
        target_index: usize,
        score: f64,
    },
    Insert {
        target_index: usize,
    },
    Keep {
        base_index: usize,
    },
}

impl From<&AlignmentEntry> for StepAlignmentEntry {
    fn from(entry: &AlignmentEntry) -> Self {
        match *entry {
            AlignmentEntry::Merge {
                base_index,
                target_index,
                score,
            } => Self::Merge {
                base_index,
                target_index,
                score,
            },
            AlignmentEntry::Insert { target_index } => Self::Insert { target_index },
            AlignmentEntry::Keep { base_index } => Self::Keep { base_index },
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StepAlignmentRange {
    base_start: usize,
    base_end: usize,
    target_start: usize,
    target_end: usize,
}

impl From<AlignmentRange> for StepAlignmentRange {
    fn from(range: AlignmentRange) -> Self {
        Self {
            base_start: range.base_start,
            base_end: range.base_end,
            target_start: range.target_start,
            target_end: range.target_end,
        }
    }
}

#[derive(Debug, Serialize)]
struct StepLocalAlignment {
    entries: Vec<StepAlignmentEntry>,
    range: StepAlignmentRange,
}

impl From<&LocalAlignment> for StepLocalAlignment {
    fn from(alignment: &LocalAlignment) -> Self {
        Self {
            entries: alignment
                .entries
                .iter()
                .map(StepAlignmentEntry::from)
                .collect(),
            range: alignment.range.into(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StepAlignment {
    alignments: Vec<StepLocalAlignment>,
    base_coverage: f64,
    target_coverage: f64,
    gap_count: usize,
}

impl From<&AlignmentResult> for StepAlignment {
    fn from(result: &AlignmentResult) -> Self {
        Self {
            alignments: result
                .alignments
                .iter()
                .map(StepLocalAlignment::from)
                .collect(),
            base_coverage: result.base_coverage,
            target_coverage: result.target_coverage,
            gap_count: result.gap_count,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StepMapping {
    base: BTreeMap<Tick, Tick>,
    target: BTreeMap<Tick, Tick>,
    merged_tick_count: u32,
}

fn serialize_tick_mapping(mapping: &TickMapping) -> BTreeMap<Tick, Tick> {
    mapping
        .client_last_tick()
        .up_to_inclusive()
        .filter_map(|tick| mapping.to_merged(tick).map(|merged| (tick, merged)))
        .collect()
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(super) enum TickMergeDecision {
    /// Both sides recorded the tick and their states were merged.
    Merged,
    /// Only the target recorded the tick.
    Filled,
    /// Only the base recorded the tick.
    Retained,
    /// Neither side recorded the tick.
    Skipped,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TickDecision {
    tick: Tick,
    #[serde(rename = "type")]
    decision: TickMergeDecision,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StreamOccurrence {
    pub merged_tick: Tick,
    pub client_tick: Tick,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(super) enum StreamOutcome {
    Paired,
    UnpairedBase,
    UnpairedTarget,
}

#[derive(Debug)]
pub(super) struct StreamResolution<'a> {
    pub kind: event::Type,
    pub key: &'a IdentityKey<'a>,
    pub base: Option<StreamOccurrence>,
    pub target: Option<StreamOccurrence>,
    pub resolved_tick: Tick,
    pub outcome: StreamOutcome,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamReconciliationEntry {
    event_type: &'static str,
    identity_key: String,
    base: Option<StreamOccurrence>,
    target: Option<StreamOccurrence>,
    resolved_tick: Tick,
    tick_gap: Option<Ticks>,
    outcome: StreamOutcome,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(super) enum AttackMappedDiscardReason {
    UnmappedTick,
    AttackNotFound,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
enum Side {
    Base,
    Target,
}

impl From<super::consolidator::Side> for Side {
    fn from(side: super::consolidator::Side) -> Self {
        match side {
            super::consolidator::Side::Base => Self::Base,
            super::consolidator::Side::Target => Self::Target,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttackMappedCandidate {
    source_client_id: ClientId,
    client_tick: Tick,
    client_attack_tick: Tick,
}

impl From<&super::consolidator::AttackMappedCandidate<'_>> for AttackMappedCandidate {
    fn from(candidate: &super::consolidator::AttackMappedCandidate<'_>) -> Self {
        Self {
            source_client_id: candidate.event.source(),
            client_tick: candidate.client_tick,
            client_attack_tick: candidate.client_attack_tick,
        }
    }
}

#[derive(Debug)]
pub(super) struct AttackMappedResolution<'a> {
    pub kind: event::Type,
    pub attack_tick: Tick,
    pub base: Option<&'a super::consolidator::AttackMappedCandidate<'a>>,
    pub target: Option<&'a super::consolidator::AttackMappedCandidate<'a>>,
    pub resolved_tick: Tick,
    pub winner: super::consolidator::Side,
    pub resolution: Option<super::consolidator::Resolution<'a>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttackMappedResolutionEntry {
    event_type: &'static str,
    attack_tick: Tick,
    base: Option<AttackMappedCandidate>,
    target: Option<AttackMappedCandidate>,
    resolved_tick: Tick,
    winner: Side,
    resolution: Option<Resolution>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttackMappedDiscardEntry {
    event_type: &'static str,
    side: Side,
    client_tick: Tick,
    client_attack_tick: Tick,
    reason: AttackMappedDiscardReason,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Measurement {
    primary_player: String,
    distance: f64,
}

impl From<&super::consolidator::Measurement<'_>> for Measurement {
    fn from(measurement: &super::consolidator::Measurement<'_>) -> Self {
        Self {
            primary_player: measurement.primary_player.to_string(),
            distance: measurement.distance,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "strategy",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum Resolution {
    Unexpected,
    KeepBase,
    Proximity {
        base: Option<Measurement>,
        target: Option<Measurement>,
        winner: Side,
    },
}

impl From<&super::consolidator::Resolution<'_>> for Resolution {
    fn from(resolution: &super::consolidator::Resolution<'_>) -> Self {
        match resolution {
            super::consolidator::Resolution::Unexpected => Self::Unexpected,
            super::consolidator::Resolution::KeepBase => Self::KeepBase,
            super::consolidator::Resolution::Proximity {
                base,
                target,
                winner,
            } => Self::Proximity {
                base: base.as_ref().map(Measurement::from),
                target: target.as_ref().map(Measurement::from),
                winner: (*winner).into(),
            },
        }
    }
}

#[derive(Debug)]
pub(super) struct ActionConflict<'a> {
    pub tick: Tick,
    pub actor: super::timeline::Actor<'a>,
    pub base_source: ClientId,
    pub base_kind: &'static str,
    pub target_source: ClientId,
    pub target_kind: &'static str,
    pub resolution: super::consolidator::Resolution<'a>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionConflictEntry {
    tick: Tick,
    actor: Actor,
    base_source: ClientId,
    base_kind: &'static str,
    target_source: ClientId,
    target_kind: &'static str,
    resolution: Resolution,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttackMappedTrace {
    resolved: Vec<AttackMappedResolutionEntry>,
    discarded: Vec<AttackMappedDiscardEntry>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReconciliationTrace {
    /// Reconciled stream events by `"EVENT_TYPE:identityKey"`.
    stream: BTreeMap<String, Vec<StreamReconciliationEntry>>,
    attack_mapped: AttackMappedTrace,
    action_conflicts: Vec<ActionConflictEntry>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "id", rename_all = "lowercase")]
enum Actor {
    Npc(u64),
    Player(String),
}

impl From<&Target> for Actor {
    fn from(target: &Target) -> Self {
        match target {
            Target::Npc { room_id, .. } => Self::Npc(*room_id),
            Target::Player(name) => Self::Player(name.clone()),
        }
    }
}

impl From<super::timeline::Actor<'_>> for Actor {
    fn from(actor: super::timeline::Actor<'_>) -> Self {
        match actor {
            super::timeline::Actor::Npc(room_id) => Self::Npc(room_id),
            super::timeline::Actor::Player(name) => Self::Player(name.to_string()),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
enum QualityFlag {
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
        event_type: &'static str,
        attack_tick: Tick,
        kept_source_client_id: ClientId,
        discarded_source_client_id: ClientId,
    },
    LargeTemporalGap {
        event_type: &'static str,
        tick_gap: Ticks,
        base_tick: Tick,
        target_tick: Tick,
    },
    UnmappedCrossTickReference {
        event_type: &'static str,
        merged_tick: Tick,
        source_tick: Tick,
        resolved_tick: Tick,
    },
    AttackMappedNotFound {
        event_type: &'static str,
        source: Side,
        client_tick: Tick,
        client_attack_tick: Tick,
    },
}

impl From<&super::consolidator::QualityFlag> for QualityFlag {
    #[expect(clippy::too_many_lines)]
    fn from(flag: &super::consolidator::QualityFlag) -> Self {
        match flag {
            super::consolidator::QualityFlag::Disagreement {
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
                        player: player.clone(),
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
                        player: player.clone(),
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
                        player: player.clone(),
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
                        player: player.clone(),
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
                        event_type: kind.as_str_name(),
                        attack_tick: tick,
                        kept_source_client_id,
                        discarded_source_client_id,
                    },
                }
            }
            super::consolidator::QualityFlag::LargeTemporalGap {
                kind,
                gap,
                base_tick,
                target_tick,
            } => Self::LargeTemporalGap {
                event_type: kind.as_str_name(),
                tick_gap: *gap,
                base_tick: *base_tick,
                target_tick: *target_tick,
            },
            super::consolidator::QualityFlag::UnmappedCrossTickReference {
                kind,
                merged_tick,
                source_tick,
                resolved_tick,
            } => Self::UnmappedCrossTickReference {
                event_type: kind.as_str_name(),
                merged_tick: *merged_tick,
                source_tick: *source_tick,
                resolved_tick: *resolved_tick,
            },
            super::consolidator::QualityFlag::AttackMappedNotFound {
                kind,
                side,
                client_tick,
                client_attack_tick,
            } => Self::AttackMappedNotFound {
                event_type: kind.as_str_name(),
                source: (*side).into(),
                client_tick: *client_tick,
                client_attack_tick: *client_attack_tick,
            },
        }
    }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReconciliationCounters {
    player_attacks: u32,
    player_spells: u32,
    npc_attacks: u32,
    stream_event_pairs: u32,
    attack_mapped_events: u32,
}

impl From<&super::consolidator::ReconciliationCounters> for ReconciliationCounters {
    fn from(counters: &super::consolidator::ReconciliationCounters) -> Self {
        Self {
            player_attacks: counters.player_attack_pairs,
            player_spells: counters.player_spell_pairs,
            npc_attacks: counters.npc_attack_pairs,
            stream_event_pairs: counters.stream_event_pairs,
            attack_mapped_events: counters.attack_mapped_events,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MergeStep {
    client_id: ClientId,
    classification: StepClassification,
    status: StepStatus,
    duration_ms: f64,
    alignment: Option<StepAlignment>,
    mapping: Option<StepMapping>,
    tick_decisions: Vec<TickDecision>,
    reconciliation: Option<ReconciliationTrace>,
    quality_flags: Vec<QualityFlag>,
    counters: ReconciliationCounters,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrustedPrefixes {
    accurate_until: Tick,
    queryable_until: Tick,
}

impl From<super::trusted_prefixes::TrustedPrefixes> for TrustedPrefixes {
    fn from(prefixes: super::trusted_prefixes::TrustedPrefixes) -> Self {
        Self {
            accurate_until: prefixes.accurate_until,
            queryable_until: prefixes.queryable_until,
        }
    }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceOutput {
    input_clients: Vec<InputClient>,
    classification: Option<Classification>,
    merge_steps: Vec<MergeStep>,
    intermediate_snapshots: Vec<Vec<TickSummary>>,
    trusted_prefixes: Option<TrustedPrefixes>,
}

/// A merge step in progress. Either committed into the output or discarded.
#[derive(Debug)]
struct CurrentStep {
    client_id: ClientId,
    classification: StepClassification,
    started_at: Instant,
    alignment: Option<StepAlignment>,
    mapping: Option<StepMapping>,
    tick_decisions: Vec<TickDecision>,
    reconciliation: Option<ReconciliationTrace>,
    quality_flags: Vec<QualityFlag>,
    counters: ReconciliationCounters,
}

pub struct Tracer {
    output: TraceOutput,
    current_step: Option<CurrentStep>,
}

impl Tracer {
    pub fn new() -> Self {
        Self {
            output: TraceOutput::default(),
            current_step: None,
        }
    }

    pub fn output(&self) -> &TraceOutput {
        &self.output
    }

    pub(super) fn record_input_client(&mut self, client: &ClientEvents) {
        let ticks = client
            .timeline
            .tick_states()
            .iter()
            .flatten()
            .map(TickSummary::from)
            .collect();
        self.input_client(
            &client.info,
            client.accurate,
            ticks,
            StageData::from(&client.stage_data),
        );
    }

    pub(super) fn record_bad_data_client(&mut self, client: &BadDataClient) {
        self.input_client(
            &client.info,
            client.info.reported_accurate,
            Vec::new(),
            StageData {
                sote_pivots: Vec::new(),
            },
        );
    }

    fn input_client(
        &mut self,
        info: &ReportedInfo,
        accurate: bool,
        ticks: Vec<TickSummary>,
        stage_data: StageData,
    ) {
        self.output.input_clients.push(InputClient {
            client_id: info.id,
            primary_player: info.primary_player.clone(),
            metadata: info.plugin_info.as_ref().map(|plugin_info| ClientMetadata {
                user_id: plugin_info.user_id,
                plugin_version: plugin_info.plugin_version.clone(),
                rune_lite_version: plugin_info.runelite_version.clone(),
            }),
            reported_accurate: info.reported_accurate,
            accurate,
            recorded_ticks: info.last_recorded_tick.0 + 1,
            ticks,
            stage_data,
        });
    }

    pub(super) fn record_classification(
        &mut self,
        classification: &ClientClassification,
        clients: &[ClientEvents],
    ) {
        let ids = |indices: &[usize]| -> Vec<ClientId> {
            indices.iter().map(|&i| clients[i].info.id).collect()
        };
        let accuracy_demotions = clients
            .iter()
            .filter(|c| c.info.reported_accurate && !c.accurate)
            .map(|c| c.info.id)
            .collect();
        self.output.classification = Some(Classification {
            reference_selection: ReferenceSelection {
                count: classification.reference_ticks.duration,
                method: match classification.reference_ticks.method {
                    ReferenceMethod::AccurateModal => ReferenceSelectionMethod::AccurateModal,
                    ReferenceMethod::PreciseServer => ReferenceSelectionMethod::PreciseServer,
                    ReferenceMethod::ImpreciseServer => ReferenceSelectionMethod::ImpreciseServer,
                    ReferenceMethod::RecordedTicks => ReferenceSelectionMethod::RecordedTicks,
                },
            },
            base_client_id: clients[classification.base].info.id,
            matching_client_ids: ids(&classification.matching),
            mismatched_client_ids: ids(&classification.mismatched),
            accuracy_demotions,
        });
    }

    pub(super) fn begin_merge_step(
        &mut self,
        client_id: ClientId,
        classification: super::Classification,
    ) {
        self.current_step = Some(CurrentStep {
            client_id,
            classification: classification.into(),
            started_at: Instant::now(),
            alignment: None,
            mapping: None,
            tick_decisions: Vec::new(),
            reconciliation: None,
            quality_flags: Vec::new(),
            counters: ReconciliationCounters::default(),
        });
    }

    pub(super) fn record_tick_decision(&mut self, tick: Tick, decision: TickMergeDecision) {
        if let Some(step) = &mut self.current_step {
            step.tick_decisions.push(TickDecision { tick, decision });
        }
    }

    pub(super) fn record_alignment(&mut self, alignment: &AlignmentResult) {
        if let Some(step) = &mut self.current_step {
            step.alignment = Some(StepAlignment::from(alignment));
        }
    }

    pub(super) fn record_mapping(&mut self, mapping: &MergeMapping) {
        let Some(step) = &mut self.current_step else {
            return;
        };
        let Some(mappings) = mapping.current_step() else {
            return;
        };
        step.mapping = Some(StepMapping {
            base: serialize_tick_mapping(&mappings.base),
            target: serialize_tick_mapping(&mappings.target),
            merged_tick_count: mappings.merged_last_tick.0 + 1,
        });
    }

    pub(super) fn record_stream_resolution(&mut self, resolution: &StreamResolution<'_>) {
        let Some(step) = &mut self.current_step else {
            return;
        };
        let event_type = resolution.kind.as_str_name();
        let identity_key = resolution.key.to_string();
        let tick_gap = resolution
            .base
            .zip(resolution.target)
            .map(|(base, target)| base.merged_tick.abs_diff(target.merged_tick));
        step.reconciliation
            .get_or_insert_default()
            .stream
            .entry(format!("{event_type}:{identity_key}"))
            .or_default()
            .push(StreamReconciliationEntry {
                event_type,
                identity_key,
                base: resolution.base,
                target: resolution.target,
                resolved_tick: resolution.resolved_tick,
                tick_gap,
                outcome: resolution.outcome,
            });
    }

    pub(super) fn record_attack_mapped_resolution(
        &mut self,
        resolution: &AttackMappedResolution<'_>,
    ) {
        let Some(step) = &mut self.current_step else {
            return;
        };
        step.reconciliation
            .get_or_insert_default()
            .attack_mapped
            .resolved
            .push(AttackMappedResolutionEntry {
                event_type: resolution.kind.as_str_name(),
                attack_tick: resolution.attack_tick,
                base: resolution.base.map(AttackMappedCandidate::from),
                target: resolution.target.map(AttackMappedCandidate::from),
                resolved_tick: resolution.resolved_tick,
                winner: resolution.winner.into(),
                resolution: resolution.resolution.as_ref().map(Resolution::from),
            });
    }

    pub(super) fn record_attack_mapped_discard(
        &mut self,
        kind: event::Type,
        side: super::consolidator::Side,
        client_tick: Tick,
        client_attack_tick: Tick,
        reason: AttackMappedDiscardReason,
    ) {
        let Some(step) = &mut self.current_step else {
            return;
        };
        step.reconciliation
            .get_or_insert_default()
            .attack_mapped
            .discarded
            .push(AttackMappedDiscardEntry {
                event_type: kind.as_str_name(),
                side: side.into(),
                client_tick,
                client_attack_tick,
                reason,
            });
    }

    pub(super) fn record_action_conflict(&mut self, conflict: &ActionConflict<'_>) {
        let Some(step) = &mut self.current_step else {
            return;
        };
        step.reconciliation
            .get_or_insert_default()
            .action_conflicts
            .push(ActionConflictEntry {
                tick: conflict.tick,
                actor: conflict.actor.into(),
                base_source: conflict.base_source,
                base_kind: conflict.base_kind,
                target_source: conflict.target_source,
                target_kind: conflict.target_kind,
                resolution: (&conflict.resolution).into(),
            });
    }

    pub(super) fn record_quality_flags(&mut self, flags: &[super::consolidator::QualityFlag]) {
        if let Some(step) = &mut self.current_step {
            step.quality_flags = flags.iter().map(QualityFlag::from).collect();
        }
    }

    pub(super) fn record_reconciliation_counters(
        &mut self,
        counters: &super::consolidator::ReconciliationCounters,
    ) {
        if let Some(step) = &mut self.current_step {
            step.counters = counters.into();
        }
    }

    /// Commits the in-progress merge step into the output with its outcome.
    pub(super) fn end_merge_step(&mut self, status: &super::MergeStatus) {
        if let Some(step) = self.current_step.take() {
            self.output.merge_steps.push(MergeStep {
                client_id: step.client_id,
                classification: step.classification,
                status: status.into(),
                duration_ms: step.started_at.elapsed().as_secs_f64() * 1000.0,
                alignment: step.alignment,
                mapping: step.mapping,
                tick_decisions: step.tick_decisions,
                reconciliation: step.reconciliation,
                quality_flags: step.quality_flags,
                counters: step.counters,
            });
        }
    }

    pub(super) fn record_intermediate_snapshot(&mut self, ticks: &[Option<TickState>]) {
        self.output
            .intermediate_snapshots
            .push(ticks.iter().flatten().map(TickSummary::from).collect());
    }

    pub(super) fn record_trusted_prefixes(
        &mut self,
        prefixes: super::trusted_prefixes::TrustedPrefixes,
    ) {
        self.output.trusted_prefixes = Some(prefixes.into());
    }
}

//! Merge run tracing.

use std::collections::BTreeMap;
use std::time::Instant;

use blert::proto::event;
use blert::{
    Actor, DataSource, EventKind, NpcAttacked, NpcState, ObjectKind, PartyIndex, PlayerAttacked,
    PlayerState, Point, Recording, RoomId, Source, Tick, TickObjects, TickState, Ticks,
};
use serde::Serialize;

use crate::lifecycle::core::types::ClientId;

use super::RegisteredClient;
use super::alignment::{AlignmentEntry, AlignmentRange, AlignmentResult, LocalAlignment};
use super::classification::{ClientClassification, ReferenceMethod};
use super::client_events::{BadDataClient, ClientEvents, ReportedInfo};
use super::event::{IdentityKey, event_type};
use super::mapping::{MergeMapping, TickMapping};
use super::report::{
    ActorDef, ClientMetadata, MergeClassification, MergeStatus, QualityFlag, RejectionReason, Side,
    StepConfidence,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InputClient {
    client_id: ClientId,
    primary_player: Option<PartyIndex>,
    metadata: Option<ClientMetadata>,
    reported_accurate: bool,
    accurate: bool,
    recorded_ticks: u32,
    ticks: Vec<TickSummary>,
    stage_data: StageData,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StageData {
    sote_pivots: Vec<SotePivot>,
    inferno_wave_start: Option<Ticks>,
}

impl From<&blert::StageData> for StageData {
    fn from(data: &blert::StageData) -> Self {
        match data {
            blert::StageData::None => Self {
                sote_pivots: Vec::new(),
                inferno_wave_start: None,
            },
            blert::StageData::Sotetseg { mazes } => Self {
                sote_pivots: mazes
                    .iter()
                    .map(|(maze, pivots)| SotePivot {
                        maze: *maze as i32,
                        overworld: pivots.overworld.iter().copied().map(Coords::from).collect(),
                        underworld: pivots
                            .underworld
                            .iter()
                            .copied()
                            .map(Coords::from)
                            .collect(),
                    })
                    .collect(),
                inferno_wave_start: None,
            },
            blert::StageData::Inferno { wave_start } => Self {
                sote_pivots: Vec::new(),
                inferno_wave_start: Some(*wave_start),
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
    x: u16,
    y: u16,
}

impl From<Point> for Coords {
    fn from(point: Point) -> Self {
        Self {
            x: point.0,
            y: point.1,
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
    weapon_id: Option<u32>,
    target: Option<u64>,
}

impl From<&PlayerAttacked> for PlayerAttackSummary {
    fn from(attacked: &PlayerAttacked) -> Self {
        Self {
            r#type: attacked.attack as i32,
            weapon_id: attacked.weapon.map(|weapon| weapon.id),
            target: match attacked.target {
                Some(blert::Actor::Npc(room_id)) => Some(room_id.0),
                Some(blert::Actor::Player(_)) | None => None,
            },
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerSummary {
    party_index: PartyIndex,
    source: i32,
    x: u16,
    y: u16,
    attack: Option<PlayerAttackSummary>,
}

impl PlayerSummary {
    fn new(index: PartyIndex, state: &PlayerState, attacked: Option<&PlayerAttacked>) -> Self {
        Self {
            party_index: index,
            source: match state.data {
                DataSource::Primary(_) => event::player::DataSource::Primary as i32,
                DataSource::Secondary => event::player::DataSource::Secondary as i32,
            },
            x: state.position.0,
            y: state.position.1,
            attack: attacked.map(PlayerAttackSummary::from),
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
    target: Option<PartyIndex>,
}

impl From<&NpcAttacked> for NpcAttackSummary {
    fn from(attacked: &NpcAttacked) -> Self {
        Self {
            r#type: attacked.attack as i32,
            target: match attacked.target {
                Some(blert::Actor::Player(index)) => Some(index),
                Some(blert::Actor::Npc(_)) | None => None,
            },
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NpcSummary {
    room_id: u64,
    id: u32,
    x: u16,
    y: u16,
    hitpoints: SkillLevelSummary,
    attacks: Vec<NpcAttackSummary>,
}

impl NpcSummary {
    fn new(room_id: RoomId, state: &NpcState, attacks: Vec<&NpcAttacked>) -> Self {
        Self {
            room_id: room_id.0,
            id: state.id,
            x: state.position.point.0,
            y: state.position.point.1,
            hitpoints: SkillLevelSummary {
                current: state.hitpoints.current,
                base: state.hitpoints.base,
            },
            attacks: attacks.into_iter().map(NpcAttackSummary::from).collect(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GraphicsSummary {
    r#type: &'static str,
    counts_by_source: BTreeMap<Source, u32>,
}

impl GraphicsSummary {
    fn from_objects(objects: &TickObjects) -> Vec<Self> {
        let mut counts: BTreeMap<ObjectKind, BTreeMap<Source, u32>> = BTreeMap::new();
        for (kind, _, source) in objects.iter() {
            *counts.entry(kind).or_default().entry(source).or_default() += 1;
        }
        counts
            .into_iter()
            .filter_map(|(kind, counts_by_source)| {
                let r#type = match kind {
                    ObjectKind::MaidenBloodSplats => "TOB_MAIDEN_BLOOD_SPLATS",
                    ObjectKind::SoteMazeTiles => "TOB_SOTE_OVERWORLD_TILES",
                    ObjectKind::VerzikYellows => "TOB_VERZIK_YELLOWS",

                    // Solo challenges only.
                    ObjectKind::ColosseumReentryPrimaryPool
                    | ObjectKind::ColosseumReentrySecondaryPool
                    | ObjectKind::MokhaiotlRock
                    | ObjectKind::MokhaiotlSplat
                    | ObjectKind::MokhaiotlShockwave => return None,
                };
                Some(Self {
                    r#type,
                    counts_by_source,
                })
            })
            .collect()
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

impl TickSummary {
    fn new(tick: Tick, state: &TickState) -> Self {
        let mut event_counts: BTreeMap<&'static str, u32> = BTreeMap::new();
        for event in &state.events {
            *event_counts
                .entry(event_type(&event.kind).as_str_name())
                .or_default() += 1;
        }
        Self {
            tick,
            players: state
                .players
                .iter()
                .map(|(index, player)| {
                    let attacked = state.events.iter().find_map(|event| match &event.kind {
                        EventKind::PlayerAttack(attacked) if attacked.player == index => {
                            Some(attacked)
                        }
                        _ => None,
                    });
                    PlayerSummary::new(index, player, attacked)
                })
                .collect(),
            npcs: state
                .npcs
                .iter()
                .map(|(&room_id, npc)| {
                    let attacks = state
                        .events
                        .iter()
                        .filter_map(|event| match &event.kind {
                            EventKind::NpcAttack(attacked) if attacked.npc == room_id => {
                                Some(attacked)
                            }
                            _ => None,
                        })
                        .collect();
                    NpcSummary::new(room_id, npc, attacks)
                })
                .collect(),
            graphics: GraphicsSummary::from_objects(&state.objects),
            event_counts,
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
    pub key: &'a IdentityKey,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttackMappedCandidate {
    source: Source,
    client_tick: Tick,
    client_attack_tick: Tick,
}

impl From<&super::consolidator::AttackMappedCandidate<'_>> for AttackMappedCandidate {
    fn from(candidate: &super::consolidator::AttackMappedCandidate<'_>) -> Self {
        Self {
            source: candidate.event.source,
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
    pub resolution: Option<super::consolidator::Resolution>,
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
    primary_player: PartyIndex,
    distance: f64,
}

impl From<&super::consolidator::Measurement> for Measurement {
    fn from(measurement: &super::consolidator::Measurement) -> Self {
        Self {
            primary_player: measurement.primary_player,
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

impl From<&super::consolidator::Resolution> for Resolution {
    fn from(resolution: &super::consolidator::Resolution) -> Self {
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
pub(super) struct ActionConflict {
    pub tick: Tick,
    pub actor: Actor,
    pub base_source: Source,
    pub base_kind: &'static str,
    pub target_source: Source,
    pub target_kind: &'static str,
    pub resolution: super::consolidator::Resolution,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionConflictEntry {
    tick: Tick,
    #[serde(with = "ActorDef")]
    actor: Actor,
    base_source: Source,
    base_kind: &'static str,
    target_source: Source,
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
    status: &'static str,
    classification: MergeClassification,
    reason: Option<RejectionReason>,
    duration_ms: f64,
    alignment: Option<StepAlignment>,
    mapping: Option<StepMapping>,
    tick_decisions: Vec<TickDecision>,
    reconciliation: Option<ReconciliationTrace>,
    quality_flags: Vec<QualityFlag>,
    counters: ReconciliationCounters,
    confidence: Option<StepConfidence>,
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
    started_at: Instant,
    alignment: Option<StepAlignment>,
    mapping: Option<StepMapping>,
    tick_decisions: Vec<TickDecision>,
    reconciliation: Option<ReconciliationTrace>,
    quality_flags: Vec<QualityFlag>,
    counters: ReconciliationCounters,
    confidence: Option<StepConfidence>,
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
            .recording
            .states()
            .map(|(tick, state)| TickSummary::new(tick, state))
            .collect();
        self.input_client(
            &client.info,
            client.accurate,
            ticks,
            StageData::from(client.recording.stage_data()),
        );
    }

    pub(super) fn record_bad_data_client(&mut self, client: &BadDataClient) {
        self.input_client(
            &client.info,
            client.info.reported_accurate,
            Vec::new(),
            StageData {
                sote_pivots: Vec::new(),
                inferno_wave_start: None,
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
            primary_player: info.primary_player,
            metadata: info.plugin_info.as_ref().map(ClientMetadata::from),
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

    pub(super) fn begin_merge_step(&mut self, client_id: ClientId) {
        self.current_step = Some(CurrentStep {
            client_id,
            started_at: Instant::now(),
            alignment: None,
            mapping: None,
            tick_decisions: Vec::new(),
            reconciliation: None,
            quality_flags: Vec::new(),
            counters: ReconciliationCounters::default(),
            confidence: None,
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

    pub(super) fn record_action_conflict(&mut self, conflict: &ActionConflict) {
        let Some(step) = &mut self.current_step else {
            return;
        };
        step.reconciliation
            .get_or_insert_default()
            .action_conflicts
            .push(ActionConflictEntry {
                tick: conflict.tick,
                actor: conflict.actor,
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

    pub(super) fn record_confidence(&mut self, confidence: &super::StepConfidence) {
        if let Some(step) = &mut self.current_step {
            step.confidence = Some(confidence.into());
        }
    }

    /// Commits the in-progress merge step into the output with its outcome.
    pub(super) fn end_merge_step(&mut self, client: &RegisteredClient) {
        if let Some(current) = self.current_step.take() {
            let status = MergeStatus::from(client);
            self.output.merge_steps.push(MergeStep {
                client_id: current.client_id,
                status: status.name(),
                classification: client.classification.into(),
                reason: match status {
                    MergeStatus::Rejected { reason, .. } => Some(reason),
                    MergeStatus::Skipped { .. }
                    | MergeStatus::Merged { .. }
                    | MergeStatus::Unmerged { .. } => None,
                },
                duration_ms: current.started_at.elapsed().as_secs_f64() * 1000.0,
                alignment: current.alignment,
                mapping: current.mapping,
                tick_decisions: current.tick_decisions,
                reconciliation: current.reconciliation,
                quality_flags: current.quality_flags,
                counters: current.counters,
                confidence: current.confidence,
            });
        }
    }

    pub(super) fn record_intermediate_snapshot(&mut self, recording: &Recording) {
        self.output.intermediate_snapshots.push(
            recording
                .states()
                .map(|(tick, state)| TickSummary::new(tick, state))
                .collect(),
        );
    }

    pub(super) fn record_trusted_prefixes(
        &mut self,
        prefixes: super::trusted_prefixes::TrustedPrefixes,
    ) {
        self.output.trusted_prefixes = Some(prefixes.into());
    }
}

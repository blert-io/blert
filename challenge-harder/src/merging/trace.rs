//! Merge run tracing.

use std::collections::BTreeMap;
use std::time::Instant;

use serde::Serialize;

use crate::lifecycle::core::types::{ClientId, UserId};

use super::alignment::{AlignmentEntry, AlignmentRange, AlignmentResult, LocalAlignment};
use super::classification::{ClientClassification, ReferenceMethod};
use super::client_events::{self, BadDataClient, ClientEvents, ReportedInfo};
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MergeStep {
    client_id: ClientId,
    classification: StepClassification,
    status: StepStatus,
    duration_ms: f64,
    alignment: Option<StepAlignment>,
    mapping: Option<StepMapping>,
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
        });
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
        let (Some(base), Some(target), Some(merged_last_tick)) = (
            mapping.base_mapping(),
            mapping.target_mapping(),
            mapping.merged_last_tick(),
        ) else {
            return;
        };
        step.mapping = Some(StepMapping {
            base: serialize_tick_mapping(base),
            target: serialize_tick_mapping(target),
            merged_tick_count: merged_last_tick.0 + 1,
        });
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

//! Merge run tracing.

use serde::Serialize;

use crate::lifecycle::core::types::{ClientId, UserId};

use super::classification::{ClientClassification, ReferenceMethod};
use super::client_events::{self, ClientEvents};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InputClient {
    client_id: ClientId,
    primary_player: Option<String>,
    metadata: Option<ClientMetadata>,
    reported_accurate: bool,
    accurate: bool,
    recorded_ticks: u32,
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
    count: u32,
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

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tracer {
    input_clients: Vec<InputClient>,
    classification: Option<Classification>,
    // TODO(frolv): port the per-step merge recordings.
}

impl Tracer {
    pub fn new() -> Self {
        Self::default()
    }

    pub(super) fn record_input_client(&mut self, client: &ClientEvents) {
        self.input_clients.push(InputClient {
            client_id: client.client_id,
            primary_player: client.primary_player.clone(),
            metadata: client.metadata.as_ref().map(|metadata| ClientMetadata {
                user_id: metadata.user_id,
                plugin_version: metadata.plugin_version.clone(),
                rune_lite_version: metadata.runelite_version.clone(),
            }),
            reported_accurate: client.reported_accurate,
            accurate: client.accurate,
            recorded_ticks: client.recorded_ticks + 1,
            stage_data: StageData::from(&client.stage_data),
        });
    }

    pub(super) fn record_classification(
        &mut self,
        classification: &ClientClassification,
        clients: &[ClientEvents],
    ) {
        let ids = |indices: &[usize]| -> Vec<ClientId> {
            indices.iter().map(|&i| clients[i].client_id).collect()
        };
        let accuracy_demotions = clients
            .iter()
            .filter(|c| c.reported_accurate && !c.accurate)
            .map(|c| c.client_id)
            .collect();
        self.classification = Some(Classification {
            reference_selection: ReferenceSelection {
                count: classification.reference_ticks.count,
                method: match classification.reference_ticks.method {
                    ReferenceMethod::AccurateModal => ReferenceSelectionMethod::AccurateModal,
                    ReferenceMethod::PreciseServer => ReferenceSelectionMethod::PreciseServer,
                    ReferenceMethod::ImpreciseServer => ReferenceSelectionMethod::ImpreciseServer,
                    ReferenceMethod::RecordedTicks => ReferenceSelectionMethod::RecordedTicks,
                },
            },
            base_client_id: clients[classification.base].client_id,
            matching_client_ids: ids(&classification.matching),
            mismatched_client_ids: ids(&classification.mismatched),
            accuracy_demotions,
        });
    }
}

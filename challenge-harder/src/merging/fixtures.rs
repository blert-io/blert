//! Test helpers.

use std::collections::BTreeMap;

use crate::item::ItemDelta;
use crate::lifecycle::core::types::{ChallengeMode, ClientId, Stage, StageExt, StageStatus};
use crate::prayer::PrayerSet;
use crate::proto::event::attack_style::Style;
use crate::proto::event::sote_maze::Maze;
use crate::proto::event::{VerzikPhase, XarpusPhase};
use crate::proto::{Coords, Event, NpcAttack, PlayerAttack, PlayerSpell, event};
use crate::skill::SkillLevel;

use super::client_consistency::ConsistencyIssue;
use super::client_events::{ClientEvents, ReportedInfo, StageData};
use super::event::TaggedEvent;
use super::mapping::MergeMapping;
use super::timeline::Timeline;
use super::{
    ChallengeInfo, Classification, MergeContext, MergeStatus, MergedEvents, Metadata,
    RegisteredClient, Tick, Ticks,
};

#[derive(Debug, Clone, Copy)]
pub enum ServerTicks {
    Precise(u32),
    #[expect(dead_code)]
    Rounded(u32),
    Missing,
}

pub fn merged_events(
    events: Vec<Event>,
    status: StageStatus,
    server_ticks: ServerTicks,
) -> MergedEvents {
    let last_tick = match server_ticks {
        ServerTicks::Precise(tick) | ServerTicks::Rounded(tick) => tick,
        ServerTicks::Missing => events.last().map_or(0, |e| e.tick),
    };
    let recorded_ticks = events.last().map_or(0, |e| e.tick + 1);
    MergedEvents::new(
        events,
        Metadata {
            status,
            last_tick: Tick(last_tick),
            missing_tick_count: last_tick.saturating_sub(recorded_ticks),
            offset: match server_ticks {
                ServerTicks::Precise(_) | ServerTicks::Rounded(_) => {
                    Ticks(last_tick.saturating_sub(recorded_ticks))
                }
                ServerTicks::Missing => Ticks(0),
            },
            precise_server_tick_count: matches!(server_ticks, ServerTicks::Precise(_)),
            accurate_until: Tick(0),
            queryable_until: Tick(0),
        },
    )
}

pub(super) fn challenge_info(
    stage: Stage,
    mode: ChallengeMode,
    party: &[String],
) -> ChallengeInfo<'_> {
    ChallengeInfo {
        uuid: "a8cb035f-410a-45de-a4d3-2b0a5d8b464d"
            .parse()
            .expect("valid uuid"),
        challenge_type: stage.challenge_type().expect("stage has a challenge"),
        mode,
        party,
    }
}

pub(super) struct ClientBuilder {
    id: ClientId,
    stage: Stage,
    last_recorded_tick: Tick,
    primary_player: Option<String>,
    consistency_issues: Vec<ConsistencyIssue>,
}

impl ClientBuilder {
    pub(super) fn new(id: i64, stage: Stage, last_recorded_tick: Tick) -> Self {
        Self {
            id: ClientId(id),
            stage,
            last_recorded_tick,
            primary_player: None,
            consistency_issues: Vec::new(),
        }
    }

    pub(super) fn primary_player(mut self, name: &str) -> Self {
        self.primary_player = Some(name.to_string());
        self
    }

    pub(super) fn consistency_issue(mut self, issue: ConsistencyIssue) -> Self {
        self.consistency_issues.push(issue);
        self
    }

    pub(super) fn build(self) -> ClientEvents {
        ClientEvents {
            info: ReportedInfo {
                id: self.id,
                plugin_info: None,
                primary_player: self.primary_player,
                status: StageStatus::Completed,
                reported_accurate: true,
                last_recorded_tick: self.last_recorded_tick,
                server_ticks: None,
            },
            timeline: Timeline::build(&[], self.last_recorded_tick, Vec::new())
                .expect("an empty recording is well formed"),
            accurate: true,
            stage_data: StageData::new(self.stage),
            anomalies: Vec::new(),
            consistency_issues: self.consistency_issues,
        }
    }
}

pub(super) fn merge_context<'a>(
    challenge: &'a ChallengeInfo<'a>,
    stage: Stage,
) -> MergeContextBuilder<'a> {
    MergeContextBuilder {
        challenge,
        stage,
        clients: Vec::new(),
    }
}

pub(super) struct MergeContextBuilder<'a> {
    challenge: &'a ChallengeInfo<'a>,
    stage: Stage,
    clients: Vec<ClientEvents>,
}

impl<'a> MergeContextBuilder<'a> {
    pub(super) fn client(mut self, client: ClientEvents) -> Self {
        self.clients.push(client);
        self
    }

    pub(super) fn recording(
        mut self,
        accurate: bool,
        last_recorded_tick: Tick,
        events: Vec<Event>,
    ) -> Self {
        let client_id = ClientId(i64::try_from(self.clients.len() + 1).expect("few clients"));
        let events = events
            .into_iter()
            .map(|event| TaggedEvent::new(client_id, event))
            .collect();
        self.clients.push(ClientEvents {
            info: ReportedInfo {
                id: client_id,
                plugin_info: None,
                primary_player: None,
                status: StageStatus::Completed,
                reported_accurate: accurate,
                last_recorded_tick,
                server_ticks: None,
            },
            timeline: Timeline::build(self.challenge.party, last_recorded_tick, events)
                .expect("fixture events are well formed"),
            accurate,
            stage_data: StageData::new(self.stage),
            anomalies: Vec::new(),
            consistency_issues: Vec::new(),
        });
        self
    }

    pub(super) fn build(self) -> MergeContext<'a> {
        let base_client_id = self
            .clients
            .first()
            .expect("merge context requires at least one client")
            .info
            .id;
        let clients = self
            .clients
            .into_iter()
            .enumerate()
            .map(|(index, client)| RegisteredClient {
                client,
                status: if index == 0 {
                    MergeStatus::Merged(Classification::Reference)
                } else {
                    MergeStatus::Merged(Classification::Matching)
                },
            })
            .collect();
        MergeContext {
            challenge: self.challenge,
            stage: self.stage,
            clients,
            mapping: MergeMapping::new(base_client_id),
            contested_ticks: BTreeMap::new(),
        }
    }
}

pub(super) fn timeline(party: &[String], last_recorded_tick: Tick, events: Vec<Event>) -> Timeline {
    Timeline::build(
        party,
        last_recorded_tick,
        events
            .into_iter()
            .map(|event| TaggedEvent::new(ClientId(1), event))
            .collect(),
    )
    .expect("fixture events are well formed")
}

pub struct PlayerUpdateEvent<'a> {
    tick: Tick,
    stage: Stage,
    name: &'a str,
    coords: (i32, i32),
    party_index: u32,
    source: event::player::DataSource,
    equipment_deltas: &'a [ItemDelta],
    snapshot: bool,
    prayers: Option<PrayerSet>,
}

impl<'a> PlayerUpdateEvent<'a> {
    pub fn new(tick: Tick, stage: Stage, name: &'a str, coords: (i32, i32)) -> Self {
        Self {
            tick,
            stage,
            name,
            coords,
            party_index: 0,
            source: event::player::DataSource::Secondary,
            equipment_deltas: &[],
            snapshot: false,
            prayers: None,
        }
    }

    pub fn party_index(mut self, party_index: u32) -> Self {
        self.party_index = party_index;
        self
    }

    pub fn source(mut self, source: event::player::DataSource) -> Self {
        self.source = source;
        self
    }

    pub fn equipment_deltas(mut self, deltas: &'a [ItemDelta]) -> Self {
        self.equipment_deltas = deltas;
        self
    }

    pub fn prayers(mut self, prayers: PrayerSet) -> Self {
        self.prayers = Some(prayers);
        self
    }

    pub fn build(self) -> Event {
        let mut event = Event {
            tick: self.tick.0,
            stage: self.stage as i32,
            x_coord: self.coords.0,
            y_coord: self.coords.1,
            ..Default::default()
        };
        event.set_type(event::Type::PlayerUpdate);
        event.player = Some(event::Player {
            name: self.name.to_string(),
            party_index: self.party_index,
            data_source: self.source as i32,
            equipment_deltas: self
                .equipment_deltas
                .iter()
                .map(|delta| delta.to_raw())
                .collect(),
            snapshot: self.snapshot,
            active_prayers: self.prayers.map(PrayerSet::to_raw),
            ..Default::default()
        });
        event
    }
}

#[derive(Clone, Copy)]
pub struct PlayerAttackEvent<'a> {
    pub tick: Tick,
    pub stage: Stage,
    pub coords: (i32, i32),
    pub name: &'a str,
    pub party_index: Option<u32>,
    pub attack: PlayerAttack,
    pub weapon_id: u32,
    pub distance_to_target: i32,
    pub target: Option<event::Npc>,
}

pub fn player_attack_event(options: PlayerAttackEvent<'_>) -> Event {
    let mut event = Event {
        tick: options.tick.0,
        stage: options.stage as i32,
        x_coord: options.coords.0,
        y_coord: options.coords.1,
        ..Default::default()
    };
    event.set_type(event::Type::PlayerAttack);
    event.player = Some(event::Player {
        name: options.name.to_string(),
        party_index: options.party_index.unwrap_or(0),
        ..Default::default()
    });
    event.player_attack = Some(event::Attack {
        r#type: options.attack as i32,
        weapon: (options.weapon_id != 0).then_some(event::player::EquippedItem {
            slot: event::player::EquipmentSlot::Weapon as i32,
            id: options.weapon_id,
            quantity: 1,
        }),
        target: options.target,
        distance_to_target: options.distance_to_target,
    });
    event
}

pub fn player_spell_event(
    tick: Tick,
    stage: Stage,
    coords: (i32, i32),
    name: &str,
    spell: PlayerSpell,
    target: Option<event::spell::Target>,
) -> Event {
    let mut event = Event {
        tick: tick.0,
        stage: stage as i32,
        x_coord: coords.0,
        y_coord: coords.1,
        ..Default::default()
    };
    event.set_type(event::Type::PlayerSpell);
    event.player = Some(event::Player {
        name: name.to_string(),
        ..Default::default()
    });
    event.player_spell = Some(event::Spell {
        r#type: spell as i32,
        target,
    });
    event
}

pub fn player_death_event(
    tick: Tick,
    stage: Stage,
    coords: (i32, i32),
    name: &str,
    party_index: u32,
) -> Event {
    let mut event = Event {
        tick: tick.0,
        stage: stage as i32,
        x_coord: coords.0,
        y_coord: coords.1,
        ..Default::default()
    };
    event.set_type(event::Type::PlayerDeath);
    event.player = Some(event::Player {
        name: name.to_string(),
        party_index,
        ..Default::default()
    });
    event
}

#[derive(Clone, Copy, Default)]
pub struct NpcEvent {
    pub tick: Tick,
    pub stage: Stage,
    pub coords: (i32, i32),
    pub npc_id: u32,
    pub room_id: u64,
    pub hitpoints: SkillLevel,
    pub prayers: Option<u64>,
    pub kind: Option<event::npc::Type>,
}

fn npc_event(event_type: event::Type, options: NpcEvent) -> Event {
    let mut event = Event {
        tick: options.tick.0,
        stage: options.stage as i32,
        x_coord: options.coords.0,
        y_coord: options.coords.1,
        ..Default::default()
    };
    event.set_type(event_type);
    event.npc = Some(event::Npc {
        id: options.npc_id,
        room_id: options.room_id,
        hitpoints: options.hitpoints.to_raw(),
        active_prayers: options.prayers.unwrap_or_default(),
        r#type: options.kind,
    });
    event
}

pub fn npc_spawn_event(options: NpcEvent) -> Event {
    npc_event(event::Type::NpcSpawn, options)
}

pub fn npc_update_event(options: NpcEvent) -> Event {
    npc_event(event::Type::NpcUpdate, options)
}

pub fn npc_death_event(options: NpcEvent) -> Event {
    npc_event(event::Type::NpcDeath, options)
}

pub fn npc_attack_event(
    tick: Tick,
    stage: Stage,
    coords: (i32, i32),
    npc_id: u32,
    room_id: u64,
    attack: NpcAttack,
    target: Option<&str>,
) -> Event {
    let mut event = Event {
        tick: tick.0,
        stage: stage as i32,
        x_coord: coords.0,
        y_coord: coords.1,
        ..Default::default()
    };
    event.set_type(event::Type::NpcAttack);
    event.npc = Some(event::Npc {
        id: npc_id,
        room_id,
        ..Default::default()
    });
    event.npc_attack = Some(event::NpcAttacked {
        attack: attack as i32,
        target: target.map(str::to_string),
    });
    event
}

pub fn maiden_crab_leak_event(options: NpcEvent) -> Event {
    npc_event(event::Type::TobMaidenCrabLeak, options)
}

pub fn maiden_blood_splats_event(tick: Tick, coords: &[(i32, i32)]) -> Event {
    let mut event = Event {
        tick: tick.0,
        stage: Stage::TobMaiden as i32,
        ..Default::default()
    };
    event.set_type(event::Type::TobMaidenBloodSplats);
    event.maiden_blood_splats = coords.iter().copied().map(Coords::from).collect();
    event
}

pub fn bloat_down_event(
    tick: Tick,
    coords: (i32, i32),
    down_number: u32,
    up_ticks: Ticks,
) -> Event {
    let mut event = Event {
        tick: tick.0,
        stage: Stage::TobBloat as i32,
        x_coord: coords.0,
        y_coord: coords.1,
        ..Default::default()
    };
    event.set_type(event::Type::TobBloatDown);
    event.bloat_down = Some(event::BloatDown {
        down_number,
        up_ticks: up_ticks.0,
    });
    event
}

pub fn bloat_up_event(tick: Tick) -> Event {
    let mut event = Event {
        tick: tick.0,
        stage: Stage::TobBloat as i32,
        ..Default::default()
    };
    event.set_type(event::Type::TobBloatUp);
    event
}

pub fn bloat_hands_drop_event(tick: Tick, hands: &[(i32, i32)]) -> Event {
    let mut event = Event {
        tick: tick.0,
        stage: Stage::TobBloat as i32,
        ..Default::default()
    };
    event.set_type(event::Type::TobBloatHandsDrop);
    event.bloat_hands = hands.iter().copied().map(Coords::from).collect();
    event
}

pub fn nylo_wave_event(
    event_type: event::Type,
    tick: Tick,
    wave: u32,
    nylos_alive: u32,
    room_cap: u32,
) -> Event {
    assert!(matches!(
        event_type,
        event::Type::TobNyloWaveSpawn | event::Type::TobNyloWaveStall
    ));
    let mut event = Event {
        tick: tick.0,
        stage: Stage::TobNylocas as i32,
        ..Default::default()
    };
    event.set_type(event_type);
    event.nylo_wave = Some(event::NyloWave {
        wave,
        nylos_alive,
        room_cap,
    });
    event
}

pub fn nylo_split_event(event_type: event::Type, tick: Tick) -> Event {
    let mut event = Event {
        tick: tick.0,
        stage: Stage::TobNylocas as i32,
        ..Default::default()
    };
    event.set_type(event_type);
    event
}

pub fn sote_maze_proc_event(tick: Tick, maze: Maze) -> Event {
    let mut event = Event {
        tick: tick.0,
        stage: Stage::TobSotetseg as i32,
        ..Default::default()
    };
    event.set_type(event::Type::TobSoteMazeProc);
    event.sote_maze = Some(event::SoteMaze {
        maze: maze as i32,
        ..Default::default()
    });
    event
}

#[derive(Clone, Copy)]
pub enum SoteMazePath<'a> {
    OverworldTiles(&'a [(i32, i32)]),
    OverworldPivots(&'a [(i32, i32)]),
    UnderworldPivots(&'a [(i32, i32)]),
}

pub fn sote_maze_path_event(tick: Tick, maze: Maze, path: SoteMazePath<'_>) -> Event {
    let coords = |points: &[(i32, i32)]| points.iter().copied().map(Coords::from).collect();
    let mut sote_maze = event::SoteMaze {
        maze: maze as i32,
        ..Default::default()
    };
    match path {
        SoteMazePath::OverworldTiles(tiles) => sote_maze.overworld_tiles = coords(tiles),
        SoteMazePath::OverworldPivots(pivots) => sote_maze.overworld_pivots = coords(pivots),
        SoteMazePath::UnderworldPivots(pivots) => sote_maze.underworld_pivots = coords(pivots),
    }

    let mut event = Event {
        tick: tick.0,
        stage: Stage::TobSotetseg as i32,
        ..Default::default()
    };
    event.set_type(event::Type::TobSoteMazePath);
    event.sote_maze = Some(sote_maze);
    event
}

pub fn sote_maze_end_event(tick: Tick, maze: Maze, chosen_player: Option<&str>) -> Event {
    let mut event = Event {
        tick: tick.0,
        stage: Stage::TobSotetseg as i32,
        ..Default::default()
    };
    event.set_type(event::Type::TobSoteMazeEnd);
    event.sote_maze = Some(event::SoteMaze {
        maze: maze as i32,
        chosen_player: chosen_player.map(str::to_string),
        ..Default::default()
    });
    event
}

pub fn xarpus_exhumed_event(tick: Tick, spawn_tick: Tick, heal_ticks: &[Tick]) -> Event {
    let mut event = Event {
        tick: tick.0,
        stage: Stage::TobXarpus as i32,
        ..Default::default()
    };
    event.set_type(event::Type::TobXarpusExhumed);
    event.xarpus_exhumed = Some(event::XarpusExhumed {
        spawn_tick: spawn_tick.0,
        heal_ticks: heal_ticks.iter().map(|t| t.0).collect(),
        ..Default::default()
    });
    event
}

pub fn xarpus_phase_event(tick: Tick, phase: XarpusPhase) -> Event {
    let mut event = Event {
        tick: tick.0,
        stage: Stage::TobXarpus as i32,
        ..Default::default()
    };
    event.set_type(event::Type::TobXarpusPhase);
    event.set_xarpus_phase(phase);
    event
}

pub fn verzik_phase_event(tick: Tick, phase: VerzikPhase) -> Event {
    let mut event = Event {
        tick: tick.0,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    event.set_type(event::Type::TobVerzikPhase);
    event.set_verzik_phase(phase);
    event
}

pub fn verzik_bounce_event(
    tick: Tick,
    npc_attack_tick: Tick,
    players_in_range: u32,
    players_not_in_range: u32,
    bounced_player: Option<&str>,
) -> Event {
    let mut event = Event {
        tick: tick.0,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    event.set_type(event::Type::TobVerzikBounce);
    event.verzik_bounce = Some(event::VerzikBounce {
        npc_attack_tick: npc_attack_tick.0.cast_signed(),
        players_in_range,
        players_not_in_range,
        bounced_player: bounced_player.map(str::to_string),
    });
    event
}

pub fn verzik_attack_style_event(tick: Tick, npc_attack_tick: Tick, style: Style) -> Event {
    let mut event = Event {
        tick: tick.0,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    event.set_type(event::Type::TobVerzikAttackStyle);
    event.verzik_attack_style = Some(event::AttackStyle {
        style: style as i32,
        npc_attack_tick: npc_attack_tick.0,
    });
    event
}

pub fn mokhaiotl_attack_style_event(
    tick: Tick,
    stage: Stage,
    style: Style,
    npc_attack_tick: Tick,
) -> Event {
    let mut event = Event {
        tick: tick.0,
        stage: stage as i32,
        ..Default::default()
    };
    event.set_type(event::Type::MokhaiotlAttackStyle);
    event.mokhaiotl_attack_style = Some(event::AttackStyle {
        style: style as i32,
        npc_attack_tick: npc_attack_tick.0,
    });
    event
}

pub fn mokhaiotl_larva_leak_event(
    tick: Tick,
    stage: Stage,
    room_id: u64,
    heal_amount: u32,
) -> Event {
    let mut event = Event {
        tick: tick.0,
        stage: stage as i32,
        ..Default::default()
    };
    event.set_type(event::Type::MokhaiotlLarvaLeak);
    event.mokhaiotl_larva_leak = Some(event::MokhaiotlLarvaLeak {
        room_id,
        heal_amount,
    });
    event
}

pub fn colosseum_handicap_choice_event(
    tick: Tick,
    stage: Stage,
    handicap: event::ColosseumHandicap,
    options: &[event::ColosseumHandicap],
) -> Event {
    let mut event = Event {
        tick: tick.0,
        stage: stage as i32,
        ..Default::default()
    };
    event.set_type(event::Type::ColosseumHandicapChoice);
    event.handicap = Some(handicap as i32);
    event.handicap_options = options.iter().map(|&option| option as i32).collect();
    event
}

pub fn inferno_wave_start_event(
    tick: Tick,
    stage: Stage,
    wave: u32,
    overall_ticks: Ticks,
) -> Event {
    let mut event = Event {
        tick: tick.0,
        stage: stage as i32,
        ..Default::default()
    };
    event.set_type(event::Type::InfernoWaveStart);
    event.inferno_wave_start = Some(event::InfernoWaveStart {
        wave,
        overall_ticks: overall_ticks.0,
    });
    event
}

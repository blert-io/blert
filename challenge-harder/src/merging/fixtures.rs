//! Test helpers.

use crate::item::ItemDelta;
use crate::lifecycle::core::types::{Stage, StageStatus};
use crate::proto::event::attack_style::Style;
use crate::proto::event::sote_maze::Maze;
use crate::proto::event::{VerzikPhase, XarpusPhase};
use crate::proto::{Coords, Event, NpcAttack, PlayerAttack, event};
use crate::skill::SkillLevel;

use super::{MergedEvents, Metadata};

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
            last_tick,
            missing_tick_count: last_tick.saturating_sub(recorded_ticks),
            precise_server_tick_count: matches!(server_ticks, ServerTicks::Precise(_)),
            accurate_until: 0,
            queryable_until: 0,
        },
    )
}

#[expect(dead_code)]
pub fn player_update_event(
    tick: u32,
    stage: Stage,
    coords: (i32, i32),
    name: &str,
    source: event::player::DataSource,
    equipment_deltas: &[ItemDelta],
    snapshot: bool,
) -> Event {
    let mut event = Event {
        tick,
        stage: stage as i32,
        x_coord: coords.0,
        y_coord: coords.1,
        ..Default::default()
    };
    event.set_type(event::Type::PlayerUpdate);
    event.player = Some(event::Player {
        name: name.to_string(),
        data_source: source as i32,
        equipment_deltas: equipment_deltas
            .iter()
            .map(|delta| delta.to_raw())
            .collect(),
        snapshot,
        ..Default::default()
    });
    event
}

#[derive(Clone, Copy)]
pub struct PlayerAttackEvent<'a> {
    pub tick: u32,
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
        tick: options.tick,
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

pub fn player_death_event(
    tick: u32,
    stage: Stage,
    coords: (i32, i32),
    name: &str,
    party_index: u32,
) -> Event {
    let mut event = Event {
        tick,
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
    pub tick: u32,
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
        tick: options.tick,
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
    tick: u32,
    stage: Stage,
    coords: (i32, i32),
    npc_id: u32,
    room_id: u64,
    attack: NpcAttack,
    target: Option<&str>,
) -> Event {
    let mut event = Event {
        tick,
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

pub fn bloat_down_event(tick: u32, coords: (i32, i32), down_number: u32, up_ticks: u32) -> Event {
    let mut event = Event {
        tick,
        stage: Stage::TobBloat as i32,
        x_coord: coords.0,
        y_coord: coords.1,
        ..Default::default()
    };
    event.set_type(event::Type::TobBloatDown);
    event.bloat_down = Some(event::BloatDown {
        down_number,
        up_ticks,
    });
    event
}

pub fn bloat_hands_drop_event(tick: u32, hands: &[(i32, i32)]) -> Event {
    let mut event = Event {
        tick,
        stage: Stage::TobBloat as i32,
        ..Default::default()
    };
    event.set_type(event::Type::TobBloatHandsDrop);
    event.bloat_hands = hands.iter().map(|&(x, y)| Coords { x, y }).collect();
    event
}

pub fn nylo_wave_event(
    event_type: event::Type,
    tick: u32,
    wave: u32,
    nylos_alive: u32,
    room_cap: u32,
) -> Event {
    assert!(matches!(
        event_type,
        event::Type::TobNyloWaveSpawn | event::Type::TobNyloWaveStall
    ));
    let mut event = Event {
        tick,
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

pub fn nylo_split_event(event_type: event::Type, tick: u32) -> Event {
    let mut event = Event {
        tick,
        stage: Stage::TobNylocas as i32,
        ..Default::default()
    };
    event.set_type(event_type);
    event
}

pub fn sote_maze_proc_event(tick: u32, maze: Maze) -> Event {
    let mut event = Event {
        tick,
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

pub fn sote_maze_path_event(tick: u32, maze: Maze, path: SoteMazePath<'_>) -> Event {
    let coords = |points: &[(i32, i32)]| points.iter().map(|&(x, y)| Coords { x, y }).collect();
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
        tick,
        stage: Stage::TobSotetseg as i32,
        ..Default::default()
    };
    event.set_type(event::Type::TobSoteMazePath);
    event.sote_maze = Some(sote_maze);
    event
}

pub fn sote_maze_end_event(tick: u32, maze: Maze, chosen_player: Option<&str>) -> Event {
    let mut event = Event {
        tick,
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

pub fn xarpus_exhumed_event(tick: u32, spawn_tick: u32, heal_ticks: &[u32]) -> Event {
    let mut event = Event {
        tick,
        stage: Stage::TobXarpus as i32,
        ..Default::default()
    };
    event.set_type(event::Type::TobXarpusExhumed);
    event.xarpus_exhumed = Some(event::XarpusExhumed {
        spawn_tick,
        heal_ticks: heal_ticks.to_vec(),
        ..Default::default()
    });
    event
}

pub fn xarpus_phase_event(tick: u32, phase: XarpusPhase) -> Event {
    let mut event = Event {
        tick,
        stage: Stage::TobXarpus as i32,
        ..Default::default()
    };
    event.set_type(event::Type::TobXarpusPhase);
    event.set_xarpus_phase(phase);
    event
}

pub fn verzik_phase_event(tick: u32, phase: VerzikPhase) -> Event {
    let mut event = Event {
        tick,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    event.set_type(event::Type::TobVerzikPhase);
    event.set_verzik_phase(phase);
    event
}

pub fn verzik_bounce_event(
    tick: u32,
    npc_attack_tick: u32,
    players_in_range: u32,
    players_not_in_range: u32,
    bounced_player: Option<&str>,
) -> Event {
    let mut event = Event {
        tick,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    event.set_type(event::Type::TobVerzikBounce);
    event.verzik_bounce = Some(event::VerzikBounce {
        npc_attack_tick: npc_attack_tick.cast_signed(),
        players_in_range,
        players_not_in_range,
        bounced_player: bounced_player.map(str::to_string),
    });
    event
}

pub fn verzik_attack_style_event(tick: u32, npc_attack_tick: u32, style: Style) -> Event {
    let mut event = Event {
        tick,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    event.set_type(event::Type::TobVerzikAttackStyle);
    event.verzik_attack_style = Some(event::AttackStyle {
        style: style as i32,
        npc_attack_tick,
    });
    event
}

pub fn mokhaiotl_attack_style_event(
    tick: u32,
    stage: Stage,
    style: Style,
    npc_attack_tick: u32,
) -> Event {
    let mut event = Event {
        tick,
        stage: stage as i32,
        ..Default::default()
    };
    event.set_type(event::Type::MokhaiotlAttackStyle);
    event.mokhaiotl_attack_style = Some(event::AttackStyle {
        style: style as i32,
        npc_attack_tick,
    });
    event
}

pub fn mokhaiotl_larva_leak_event(
    tick: u32,
    stage: Stage,
    room_id: u64,
    heal_amount: u32,
) -> Event {
    let mut event = Event {
        tick,
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
    tick: u32,
    stage: Stage,
    handicap: event::ColosseumHandicap,
    options: &[event::ColosseumHandicap],
) -> Event {
    let mut event = Event {
        tick,
        stage: stage as i32,
        ..Default::default()
    };
    event.set_type(event::Type::ColosseumHandicapChoice);
    event.handicap = Some(handicap as i32);
    event.handicap_options = options.iter().map(|&option| option as i32).collect();
    event
}

pub fn inferno_wave_start_event(tick: u32, stage: Stage, wave: u32, overall_ticks: u32) -> Event {
    let mut event = Event {
        tick,
        stage: stage as i32,
        ..Default::default()
    };
    event.set_type(event::Type::InfernoWaveStart);
    event.inferno_wave_start = Some(event::InfernoWaveStart {
        wave,
        overall_ticks,
    });
    event
}

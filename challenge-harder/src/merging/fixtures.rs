//! Test helpers.

use crate::lifecycle::core::types::{Stage, StageStatus};
use crate::proto::event::attack_style::Style;
use crate::proto::{Event, NpcAttack, event};

use super::{MergedEvents, Metadata};

#[derive(Debug, Clone, Copy)]
pub enum ServerTicks {
    Precise(u32),
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

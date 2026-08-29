//! Recomputation of derived stage events from a merged timeline.

use std::collections::BTreeMap;

use crate::lifecycle::core::types::{ChallengeMode, ClientId};
use crate::npc;
use crate::proto::event::sote_maze::Maze;
use crate::proto::{Coords, Event, Stage, event};

use super::MergeContext;
use super::client_events::StageData;
use super::timeline::{TickState, Timeline};
use super::world;

const FINAL_NYLO_WAVE: u32 = 31;
const NYLO_WAVE_CYCLE: u32 = 4;

/// Recomputes a stage's derived events from its merged timeline.
pub(super) fn derive_events(ctx: &MergeContext, timeline: &mut Timeline) {
    match ctx.stage {
        Stage::TobNylocas => derive_nylocas_events(ctx.challenge.mode, timeline),
        Stage::TobVerzik => derive_verzik_events(timeline),
        _ => {}
    }
}

fn nylocas_event(kind: event::Type, tick: u32) -> Event {
    let mut event = Event {
        tick,
        stage: Stage::TobNylocas as i32,
        ..Default::default()
    };
    event.set_type(kind);
    event
}

fn nylos_alive(state: &TickState) -> u32 {
    state
        .npcs()
        .map(|(_, npc)| {
            if npc::is_nylocas(npc.id) {
                1
            } else if npc::is_nylocas_prinkipas(npc.id) {
                3
            } else {
                0
            }
        })
        .sum()
}

fn derive_nylocas_events(mode: ChallengeMode, timeline: &mut Timeline) {
    let mut wave = 0;
    let mut room_cap = 0;
    let mut next_stall_tick = None;

    for tick in 0..timeline.tick_count() {
        if let Some(state) = timeline.get_mut(tick) {
            let boss = state
                .npcs()
                .find_map(|(_, npc)| npc::is_nylocas_vasilias(npc.id).then_some(npc.position));
            if let Some(position) = boss {
                let mut event = nylocas_event(event::Type::TobNyloBossSpawn, tick);
                event.x_coord = position.x;
                event.y_coord = position.y;
                state.add_synthetic_event(event);
                return;
            }

            if let Some(spawn) = state
                .events_of_type(event::Type::TobNyloWaveSpawn)
                .next()
                .and_then(|event| event.nylo_wave)
            {
                wave = spawn.wave;
                room_cap = spawn.room_cap;
                next_stall_tick = Some(tick + world::natural_stall_for_wave(mode, wave));
                continue;
            }
        }

        if wave == FINAL_NYLO_WAVE {
            if let Some(state) = timeline.get_mut(tick)
                && nylos_alive(state) == 0
            {
                state.add_synthetic_event(nylocas_event(event::Type::TobNyloCleanupEnd, tick));
                wave = 0;
                next_stall_tick = None;
            }
        } else if next_stall_tick == Some(tick) {
            next_stall_tick = Some(tick + NYLO_WAVE_CYCLE);
            if let Some(state) = timeline.get_mut(tick) {
                let nylos_alive = nylos_alive(state);
                if nylos_alive >= room_cap {
                    let mut event = nylocas_event(event::Type::TobNyloWaveStall, tick);
                    event.nylo_wave = Some(event::NyloWave {
                        wave,
                        nylos_alive,
                        room_cap,
                    });
                    state.add_synthetic_event(event);
                }
            }
        }
    }
}

// TODO(frolv): kill this useless event
fn derive_verzik_events(timeline: &mut Timeline) {
    for tick in 0..timeline.tick_count() {
        let Some(state) = timeline.get_mut(tick) else {
            continue;
        };

        let reds_spawned = state
            .events_of_type(event::Type::NpcSpawn)
            .filter_map(|event| event.npc.as_ref())
            .any(|npc| npc::is_verzik_matomenos(npc.id));

        if reds_spawned {
            let mut event = Event {
                tick,
                stage: Stage::TobVerzik as i32,
                ..Default::default()
            };
            event.set_type(event::Type::TobVerzikRedsSpawn);
            state.add_synthetic_event(event);
            return;
        }
    }
}

/// Merges clients' stage-scoped data into a finished timeline.
pub(super) fn merge_stage_data(ctx: &MergeContext, timeline: &mut Timeline) {
    if ctx.stage == Stage::TobSotetseg {
        merge_sote_pivots(ctx, timeline);
    }
}

#[derive(Default)]
struct MazePivots {
    overworld: BTreeMap<Coords, ClientId>,
    underworld: BTreeMap<Coords, ClientId>,
}

/// Unions each client's pivot reports for each maze into one consolidated
/// path event per maze on its end tick.
fn merge_sote_pivots(ctx: &MergeContext, timeline: &mut Timeline) {
    let mut by_maze: BTreeMap<Maze, MazePivots> = BTreeMap::new();

    for client in &ctx.clients {
        let StageData::Sotetseg { pivots } = &client.stage_data else {
            continue;
        };
        for report in pivots {
            let entry = by_maze.entry(report.maze).or_default();
            for &coord in &report.overworld {
                entry.overworld.entry(coord).or_insert(client.client_id);
            }
            for &coord in &report.underworld {
                entry.underworld.entry(coord).or_insert(client.client_id);
            }
        }
    }

    if by_maze.is_empty() {
        return;
    }

    let mut end_ticks: BTreeMap<Maze, u32> = BTreeMap::new();
    for (tick, state) in timeline.ticks().iter().enumerate() {
        let Some(state) = state else {
            continue;
        };
        for event in state.events_of_type(event::Type::TobSoteMazeEnd) {
            if let Some(maze) = &event.sote_maze {
                end_ticks.insert(
                    maze.maze(),
                    u32::try_from(tick).expect("tick count is small"),
                );
            }
        }
    }

    for (maze, pivots) in by_maze {
        let Some(&tick) = end_ticks.get(&maze) else {
            continue;
        };
        let Some(state) = timeline.get_mut(tick) else {
            continue;
        };

        let mut event = Event {
            tick,
            stage: ctx.stage as i32,
            ..Default::default()
        };
        event.set_type(event::Type::TobSoteMazePath);
        event.sote_maze = Some(event::SoteMaze {
            maze: maze as i32,
            overworld_pivots: sort_pivots(pivots.overworld),
            underworld_pivots: sort_pivots(pivots.underworld),
            ..Default::default()
        });
        state.add_synthetic_event(event);
    }
}

fn sort_pivots(pivots: BTreeMap<Coords, ClientId>) -> Vec<Coords> {
    let mut pivots: Vec<Coords> = pivots.into_keys().collect();
    pivots.sort_by_key(|pivot| pivot.y);
    pivots
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lifecycle::core::types::{ChallengeMode, StageStatus};
    use crate::merging::client_events::{ClientEvents, SotePivots};
    use crate::merging::{ChallengeInfo, fixtures};

    static PARTY: std::sync::LazyLock<Vec<String>> =
        std::sync::LazyLock::new(|| vec!["1Ogp".to_string()]);

    fn challenge_for(stage: Stage, mode: ChallengeMode) -> ChallengeInfo<'static> {
        fixtures::challenge_info(stage, mode, &PARTY)
    }

    fn client_with_pivots(id: i64, recorded_ticks: u32, pivots: Vec<SotePivots>) -> ClientEvents {
        ClientEvents {
            client_id: ClientId(id),
            metadata: None,
            primary_player: None,
            status: StageStatus::Completed,
            reported_accurate: true,
            accurate: true,
            recorded_ticks,
            server_ticks: None,
            timeline: Timeline::new(),
            stage_data: StageData::Sotetseg { pivots },
            anomalies: Vec::new(),
            consistency_issues: Vec::new(),
        }
    }

    fn maze_paths(timeline: &Timeline) -> Vec<(u32, Maze, Vec<Coords>, Vec<Coords>)> {
        timeline
            .ticks()
            .iter()
            .flatten()
            .flat_map(|state| state.events_of_type(event::Type::TobSoteMazePath))
            .map(|event| {
                let maze = event.sote_maze.as_ref().expect("path has maze");
                (
                    event.tick,
                    maze.maze(),
                    maze.overworld_pivots.clone(),
                    maze.underworld_pivots.clone(),
                )
            })
            .collect()
    }

    #[test]
    fn all_clients_pivots_consolidate_as_one_event() {
        const TICKS: u32 = 169;
        let mut timeline = fixtures::timeline(
            &PARTY,
            TICKS,
            vec![
                fixtures::sote_maze_proc_event(40, Maze::Maze66),
                fixtures::sote_maze_end_event(64, Maze::Maze66, Some("1Ogp")),
                fixtures::sote_maze_proc_event(106, Maze::Maze33),
                fixtures::sote_maze_end_event(124, Maze::Maze33, Some("1Ogp")),
            ],
        );
        let challenge = challenge_for(Stage::TobSotetseg, ChallengeMode::TobRegular);
        let ctx = MergeContext {
            challenge: &challenge,
            stage: Stage::TobSotetseg,
            clients: vec![
                client_with_pivots(
                    1,
                    TICKS,
                    vec![
                        SotePivots {
                            maze: Maze::Maze66,
                            overworld: Vec::new(),
                            underworld: vec![(2, 2).into(), (4, 0).into()],
                        },
                        SotePivots {
                            maze: Maze::Maze33,
                            overworld: vec![(11, 4).into(), (7, 0).into()],
                            underworld: Vec::new(),
                        },
                    ],
                ),
                client_with_pivots(
                    2,
                    TICKS,
                    vec![SotePivots {
                        maze: Maze::Maze66,
                        overworld: Vec::new(),
                        underworld: vec![(4, 0).into(), (6, 4).into()],
                    }],
                ),
            ],
        };

        merge_stage_data(&ctx, &mut timeline);

        assert_eq!(
            maze_paths(&timeline),
            vec![
                (
                    64,
                    Maze::Maze66,
                    Vec::new(),
                    vec![(4, 0).into(), (2, 2).into(), (6, 4).into()],
                ),
                (
                    124,
                    Maze::Maze33,
                    vec![(7, 0).into(), (11, 4).into()],
                    Vec::new(),
                ),
            ],
        );
    }

    #[test]
    fn missing_maze_end_does_not_emit_pivots() {
        const TICKS: u32 = 120;
        let mut timeline = fixtures::timeline(
            &PARTY,
            TICKS,
            vec![fixtures::sote_maze_proc_event(106, Maze::Maze33)],
        );
        let challenge = challenge_for(Stage::TobSotetseg, ChallengeMode::TobRegular);
        let ctx = MergeContext {
            challenge: &challenge,
            stage: Stage::TobSotetseg,
            clients: vec![client_with_pivots(
                1,
                TICKS,
                vec![SotePivots {
                    maze: Maze::Maze33,
                    overworld: vec![(7, 0).into()],
                    underworld: Vec::new(),
                }],
            )],
        };

        merge_stage_data(&ctx, &mut timeline);

        assert_eq!(maze_paths(&timeline), Vec::new());
    }

    /// A room's events with a player update on every tick.
    fn room_events(stage: Stage, ticks: u32, actors: Vec<Event>) -> Vec<Event> {
        let mut events: Vec<Event> = (0..=ticks)
            .map(|tick| fixtures::PlayerUpdateEvent::new(tick, stage, "1Ogp", (0, 0)).build())
            .collect();
        events.extend(actors);
        events.sort_by_key(|event| event.tick);
        events
    }

    fn npc_updates(stage: Stage, tick: u32, ids: &[u32]) -> Vec<Event> {
        ids.iter()
            .zip(36000u64..)
            .map(|(&npc_id, room_id)| {
                fixtures::npc_update_event(fixtures::NpcEvent {
                    tick,
                    stage,
                    npc_id,
                    room_id,
                    ..Default::default()
                })
            })
            .collect()
    }

    fn derived_nylo_events(
        timeline: &Timeline,
    ) -> Vec<(u32, event::Type, Option<event::NyloWave>, Coords)> {
        timeline
            .ticks()
            .iter()
            .flatten()
            .flat_map(|state| {
                [
                    event::Type::TobNyloWaveStall,
                    event::Type::TobNyloCleanupEnd,
                    event::Type::TobNyloBossSpawn,
                ]
                .into_iter()
                .flat_map(move |kind| state.events_of_type(kind))
            })
            .map(|event| {
                (
                    event.tick,
                    event.r#type(),
                    event.nylo_wave,
                    (event.x_coord, event.y_coord).into(),
                )
            })
            .collect()
    }

    const MELEE: u32 = npc::id::NYLOCAS_ISCHYROS_SMALL_REGULAR;

    #[test]
    fn wave_stalls_are_emitted_every_cycle_while_above_cap() {
        const TICKS: u32 = 163;
        const ROOM_CAP: u32 = 12;

        let mut events = vec![fixtures::nylo_wave_event(
            event::Type::TobNyloWaveSpawn,
            140,
            19,
            ROOM_CAP,
            ROOM_CAP,
        )];
        events.extend(npc_updates(Stage::TobNylocas, 148, &[MELEE; 13])); // nat
        events.extend(npc_updates(Stage::TobNylocas, 152, &[MELEE; 12])); // stall
        events.extend(npc_updates(Stage::TobNylocas, 156, &[MELEE; 12])); // stall
        events.extend(npc_updates(Stage::TobNylocas, 160, &[MELEE; 11])); // w20

        let mut timeline =
            fixtures::timeline(&PARTY, TICKS, room_events(Stage::TobNylocas, TICKS, events));
        let challenge = challenge_for(Stage::TobNylocas, ChallengeMode::TobRegular);
        let ctx = fixtures::merge_context(&challenge, Stage::TobNylocas).build();

        derive_events(&ctx, &mut timeline);

        assert_eq!(
            derived_nylo_events(&timeline),
            vec![
                (
                    152,
                    event::Type::TobNyloWaveStall,
                    Some(event::NyloWave {
                        wave: 19,
                        nylos_alive: 12,
                        room_cap: ROOM_CAP,
                    }),
                    (0, 0).into(),
                ),
                (
                    156,
                    event::Type::TobNyloWaveStall,
                    Some(event::NyloWave {
                        wave: 19,
                        nylos_alive: 12,
                        room_cap: ROOM_CAP,
                    }),
                    (0, 0).into(),
                ),
            ],
        );
    }

    #[test]
    fn cleanup_end_is_emitted_once_all_nylos_are_dead() {
        const TICKS: u32 = 300;
        const ROOM_CAP: u32 = 24;

        let mut events = vec![fixtures::nylo_wave_event(
            event::Type::TobNyloWaveSpawn,
            252,
            FINAL_NYLO_WAVE,
            3,
            ROOM_CAP,
        )];
        for tick in 252..=280 {
            events.extend(npc_updates(Stage::TobNylocas, tick, &[MELEE; 3]));
        }

        let mut timeline =
            fixtures::timeline(&PARTY, TICKS, room_events(Stage::TobNylocas, TICKS, events));
        let challenge = challenge_for(Stage::TobNylocas, ChallengeMode::TobRegular);
        let ctx = fixtures::merge_context(&challenge, Stage::TobNylocas).build();

        derive_events(&ctx, &mut timeline);

        assert_eq!(
            derived_nylo_events(&timeline),
            vec![(281, event::Type::TobNyloCleanupEnd, None, (0, 0).into())],
        );
    }

    #[test]
    fn boss_spawn_is_emitted_on_spawn_tick() {
        const TICKS: u32 = 30;

        let events = vec![fixtures::npc_update_event(fixtures::NpcEvent {
            tick: 12,
            stage: Stage::TobNylocas,
            coords: (3294, 4247),
            npc_id: npc::id::NYLOCAS_VASILIAS_DROPPING_REGULAR,
            room_id: 500,
            ..Default::default()
        })];

        let mut timeline =
            fixtures::timeline(&PARTY, TICKS, room_events(Stage::TobNylocas, TICKS, events));
        let challenge = challenge_for(Stage::TobNylocas, ChallengeMode::TobRegular);
        let ctx = fixtures::merge_context(&challenge, Stage::TobNylocas).build();

        derive_events(&ctx, &mut timeline);

        assert_eq!(
            derived_nylo_events(&timeline),
            vec![(12, event::Type::TobNyloBossSpawn, None, (3294, 4247).into(),)],
        );
    }

    #[test]
    fn reds_spawn_is_emitted_only_for_the_first_reds() {
        const TICKS: u32 = 260;

        let events = vec![
            fixtures::npc_spawn_event(fixtures::NpcEvent {
                tick: 0,
                stage: Stage::TobVerzik,
                coords: (3167, 4318),
                npc_id: npc::id::VERZIK_P1_REGULAR,
                room_id: 57001,
                ..Default::default()
            }),
            fixtures::npc_spawn_event(fixtures::NpcEvent {
                tick: 172,
                stage: Stage::TobVerzik,
                coords: (3170, 4320),
                npc_id: npc::id::VERZIK_MATOMENOS_REGULAR,
                room_id: 57002,
                ..Default::default()
            }),
            fixtures::npc_spawn_event(fixtures::NpcEvent {
                tick: 216,
                stage: Stage::TobVerzik,
                coords: (3172, 4322),
                npc_id: npc::id::VERZIK_MATOMENOS_REGULAR,
                room_id: 57003,
                ..Default::default()
            }),
        ];

        let mut timeline =
            fixtures::timeline(&PARTY, TICKS, room_events(Stage::TobVerzik, TICKS, events));
        let challenge = challenge_for(Stage::TobVerzik, ChallengeMode::TobRegular);
        let ctx = fixtures::merge_context(&challenge, Stage::TobVerzik).build();

        derive_events(&ctx, &mut timeline);

        assert_eq!(
            timeline
                .ticks()
                .iter()
                .flatten()
                .flat_map(|state| state.events_of_type(event::Type::TobVerzikRedsSpawn))
                .map(|event| event.tick)
                .collect::<Vec<_>>(),
            vec![172],
        );
    }
}

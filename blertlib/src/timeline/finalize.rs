//! Conversions from working state to a complete timeline.

use std::collections::BTreeMap;

use crate::actor::RoomId;
use crate::event::{Event, EventKind, NyloWave};
use crate::tick::{Tick, Ticks};
use crate::{ChallengeMode, Stage, npc};

use super::{StageNpc, TickState, Timeline};

struct FinalizeContext<'a> {
    npcs: &'a BTreeMap<RoomId, StageNpc>,
}

/// A `Finalizer` is responsible for writing some part of the finished version
/// of a working tick, such as deriving events from game state. Finalizers may
/// be run in full or incrementally. In the latter case, the finalizer is
/// initialized with the portion of the timeline that was previously finalized,
/// and will continue from the following tick.
trait Finalizer {
    /// Initializes the finalizer's state from a previously finalized prefix.
    fn initialize(&mut self, history: &[Option<TickState>]);

    /// Finalizes the state for a single tick, updating it in place.
    fn tick(&mut self, ctx: &FinalizeContext, tick: Tick, state: &mut Option<TickState>);
}

/// Runs finalizers for the timeline's stage, beginning from `start`.
pub(super) fn finalize_from(timeline: &mut Timeline, start: Tick) {
    let end = timeline.last_tick();
    let (history, states) = timeline.states.split_at_mut(start.as_usize());

    let mut finalizers: Vec<Box<dyn Finalizer>> = Vec::new();
    if timeline.stage == Stage::TobNylocas {
        finalizers.push(Box::new(NylocasFinalizer::new(timeline.mode)));
    }

    timeline.npcs.retain(|_, npc| npc.spawn < start);
    for npc in timeline.npcs.values_mut() {
        npc.death.take_if(|death| *death >= start);
    }

    for finalizer in &mut finalizers {
        finalizer.initialize(history);
    }
    for (tick, state) in start.through(end).zip(states) {
        if let Some(state) = state {
            for &room_id in state.npcs.keys() {
                timeline.npcs.entry(room_id).or_insert(StageNpc {
                    spawn: tick,
                    death: None,
                });
            }
            for event in &state.events {
                if let EventKind::NpcDeath(death) = event.kind
                    && let Some(npc) = timeline.npcs.get_mut(&death.npc)
                {
                    npc.death = Some(tick);
                }
            }
        }

        let ctx = FinalizeContext {
            npcs: &timeline.npcs,
        };
        for finalizer in &mut finalizers {
            finalizer.tick(&ctx, tick, state);
        }
    }
}

struct NylocasFinalizer {
    mode: ChallengeMode,
    current_wave: u8,
    next_spawn_check_tick: Tick,
    boss_spawned: bool,
}

impl NylocasFinalizer {
    const WAVE_CYCLE: Ticks = Ticks(4);

    fn new(mode: ChallengeMode) -> Self {
        Self {
            mode,
            current_wave: 0,
            next_spawn_check_tick: Tick(0),
            boss_spawned: false,
        }
    }

    fn nylos_alive(ctx: &FinalizeContext, tick: Tick, state: &TickState) -> u8 {
        state
            .npcs
            .iter()
            .filter(|(room_id, _)| {
                ctx.npcs
                    .get(room_id)
                    .and_then(|npc| npc.death)
                    .is_none_or(|death| death > tick)
            })
            .map(|(_, npc)| {
                if npc::is_nylocas(npc.id) {
                    1
                } else if npc::is_nylocas_prinkipas(npc.id) {
                    3
                } else {
                    0
                }
            })
            .fold(0, u8::saturating_add)
    }
}

impl Finalizer for NylocasFinalizer {
    fn initialize(&mut self, history: &[Option<TickState>]) {
        let start = Tick::from_usize(history.len());
        let events = history
            .iter()
            .enumerate()
            .rev()
            .filter_map(|(tick, state)| Some((Tick::from_usize(tick), state.as_ref()?)))
            .flat_map(|(tick, state)| state.events.iter().map(move |event| (tick, event)));

        for (tick, event) in events {
            match event.kind {
                EventKind::NyloBossSpawn => {
                    self.boss_spawned = true;
                    return;
                }
                EventKind::NyloCleanupEnd => return,
                EventKind::NyloWaveSpawn(spawn) => {
                    self.current_wave = spawn.wave;
                    self.next_spawn_check_tick =
                        tick + NyloWave::natural_stall(self.mode, spawn.wave);
                    while self.next_spawn_check_tick < start {
                        self.next_spawn_check_tick += Self::WAVE_CYCLE;
                    }
                    return;
                }
                _ => {}
            }
        }
    }

    fn tick(&mut self, ctx: &FinalizeContext, tick: Tick, state: &mut Option<TickState>) {
        if self.boss_spawned {
            return;
        }

        let spawn_check = (1..NyloWave::LAST_WAVE).contains(&self.current_wave)
            && tick == self.next_spawn_check_tick;

        let Some(state) = state else {
            if spawn_check {
                self.next_spawn_check_tick += Self::WAVE_CYCLE;
            }
            return;
        };

        if state
            .npcs
            .values()
            .any(|npc| npc::is_nylocas_vasilias(npc.id))
        {
            state
                .events
                .push(Event::synthetic(EventKind::NyloBossSpawn));
            self.boss_spawned = true;
            return;
        }

        let spawn = state.events.iter().find_map(|event| match event.kind {
            EventKind::NyloWaveSpawn(spawn) => Some(spawn),
            _ => None,
        });
        if let Some(spawn) = spawn {
            self.current_wave = spawn.wave;
            self.next_spawn_check_tick = tick + NyloWave::natural_stall(self.mode, spawn.wave);
            return;
        }

        if self.current_wave == NyloWave::LAST_WAVE {
            if Self::nylos_alive(ctx, tick, state) == 0 {
                state
                    .events
                    .push(Event::synthetic(EventKind::NyloCleanupEnd));
                self.current_wave = 0;
            }
        } else if spawn_check {
            self.next_spawn_check_tick += Self::WAVE_CYCLE;
            let nylos_alive = Self::nylos_alive(ctx, tick, state);
            if nylos_alive >= NyloWave::room_cap(self.mode, self.current_wave) {
                state
                    .events
                    .push(Event::synthetic(EventKind::NyloWaveStall(NyloWave {
                        wave: self.current_wave,
                        nylos_alive,
                    })));
            }
        }
    }
}

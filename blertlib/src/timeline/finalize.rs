//! Conversions from working state to a complete timeline.

use crate::actor::{Actor, Mokhaiotl, NpcProperties, RoomId};
use crate::event::{Event, EventKind, NyloWave};
use crate::tick::{Tick, Ticks};
use crate::{ChallengeMode, CombatStyle, NpcAttack, Stage, npc};

use super::TickState;

/// A `Finalizer` is responsible for writing some part of the finished version
/// of a working tick, such as deriving events from game state. Finalizers may
/// be run in full or incrementally. In the latter case, the finalizer is
/// initialized with the portion of the timeline that was previously finalized,
/// and will continue from the following tick.
trait Finalizer {
    /// Initializes the finalizer's state from a previously finalized prefix.
    fn initialize(&mut self, history: &[Option<TickState>]);

    /// Finalizes the state for a single tick, updating it in place.
    fn tick(&mut self, tick: Tick, state: &mut Option<TickState>);
}

/// Runs finalizers for `stage` on the given timeline, beginning from `start`.
pub(super) fn finalize_from(
    stage: Stage,
    mode: ChallengeMode,
    states: &mut [Option<TickState>],
    start: Tick,
) {
    let end = Tick::from_usize(states.len() - 1);
    let (history, states) = states.split_at_mut(start.as_usize());

    let mut finalizers: Vec<Box<dyn Finalizer>> = Vec::new();
    match stage {
        Stage::TobNylocas => finalizers.push(Box::new(NylocasFinalizer::new(mode))),
        Stage::MokhaiotlDelve1
        | Stage::MokhaiotlDelve2
        | Stage::MokhaiotlDelve3
        | Stage::MokhaiotlDelve4
        | Stage::MokhaiotlDelve5
        | Stage::MokhaiotlDelve6
        | Stage::MokhaiotlDelve7
        | Stage::MokhaiotlDelve8
        | Stage::MokhaiotlDelve8plus => finalizers.push(Box::new(MokhaiotlFinalizer::default())),
        _ => {}
    }

    for finalizer in &mut finalizers {
        finalizer.initialize(history);
    }
    for (tick, state) in start.through(end).zip(states) {
        for finalizer in &mut finalizers {
            finalizer.tick(tick, state);
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

    fn nylos_alive(state: &TickState) -> u8 {
        state
            .npcs
            .values()
            .map(|npc| {
                if npc::is_nylocas(npc.npc_id) {
                    1
                } else if npc::is_nylocas_prinkipas(npc.npc_id) {
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

    fn tick(&mut self, tick: Tick, state: &mut Option<TickState>) {
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
            .any(|npc| npc::is_nylocas_vasilias(npc.npc_id))
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
            if Self::nylos_alive(state) == 0 {
                state
                    .events
                    .push(Event::synthetic(EventKind::NyloCleanupEnd));
                self.current_wave = 0;
            }
        } else if spawn_check {
            self.next_spawn_check_tick += Self::WAVE_CYCLE;
            let nylos_alive = Self::nylos_alive(state);
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

#[derive(Default)]
struct MokhaiotlFinalizer {
    charging: bool,
}

impl MokhaiotlFinalizer {
    fn was_meleed(events: &[Event], mokhaiotl: RoomId) -> bool {
        events.iter().any(|event| {
            matches!(
                &event.kind,
                EventKind::PlayerAttack(attack)
                    if attack.target == Some(Actor::Npc(mokhaiotl))
                        && attack.attack.style() == Some(CombatStyle::Melee)
            )
        })
    }
}

impl Finalizer for MokhaiotlFinalizer {
    fn initialize(&mut self, history: &[Option<TickState>]) {
        let Some(state) = history.iter().rev().find_map(Option::as_ref) else {
            return;
        };
        let Some((&room_id, mokhaiotl)) = state
            .npcs
            .iter()
            .find(|(_, npc)| npc.npc_id == npc::id::MOKHAIOTL)
        else {
            return;
        };
        self.charging = matches!(
            mokhaiotl.properties,
            Some(NpcProperties::Mokhaiotl(Mokhaiotl { charging: true }))
        ) && !Self::was_meleed(&state.events, room_id);
    }

    fn tick(&mut self, _tick: Tick, state: &mut Option<TickState>) {
        let Some(state) = state else {
            return;
        };
        let Some((&room_id, mokhaiotl)) = state
            .npcs
            .iter_mut()
            .find(|(_, npc)| npc.npc_id == npc::id::MOKHAIOTL)
        else {
            self.charging = false;
            return;
        };

        for event in &state.events {
            if let EventKind::NpcAttack(attack) = &event.kind
                && attack.npc == room_id
            {
                self.charging = attack.attack == NpcAttack::MokhaiotlCharge;
            }
        }
        mokhaiotl.properties = Some(NpcProperties::Mokhaiotl(Mokhaiotl {
            charging: self.charging,
        }));
        if Self::was_meleed(&state.events, room_id) {
            self.charging = false;
        }
    }
}

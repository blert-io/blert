//! Conversions from working state to a complete timeline.

use std::collections::{BTreeMap, BTreeSet};

use crate::actor::{Guardian, NpcProperties, PartyIndex, RoomId, Rsn};
use crate::event::{
    Event, EventKind, Exhumed, GuardianShrooms, NyloWave, Shroom, ShroomState, XarpusExhumedEvent,
    XarpusExhumes, XarthBlast, XarthBombs, XarthFires,
};
use crate::objects::ObjectKind;
use crate::tick::{Tick, Ticks};
use crate::{ChallengeMode, NpcAttack, Point, Stage, npc};

use super::{RawActor, StageData, StageNpc, TickState, Timeline, XarpusExhumed};

struct FinalizeContext<'a> {
    party: &'a [Rsn],
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

    /// Writes the finalizer's results to the stage data after the last tick.
    fn finish(&mut self, _stage_data: &mut StageData) {}
}

/// Runs finalizers for the timeline's stage, beginning from `start`.
pub(super) fn finalize_from(timeline: &mut Timeline, start: Tick) {
    let end = timeline.last_tick();
    let (history, states) = timeline.states.split_at_mut(start.as_usize());

    let mut finalizers: Vec<Box<dyn Finalizer>> = Vec::new();
    match timeline.stage {
        Stage::TobNylocas => finalizers.push(Box::new(NylocasFinalizer::new(timeline.mode))),
        Stage::TobXarpus => {
            let legacy = history
                .iter()
                .chain(states.iter())
                .flatten()
                .flat_map(|state| &state.events)
                .any(|event| matches!(event.kind, EventKind::XarpusExhumed(_)));
            finalizers.push(Box::new(XarpusFinalizer::new(legacy)));
        }
        Stage::TfaGuardian => finalizers.push(Box::new(GuardianFinalizer::default())),
        Stage::TfaXarth => finalizers.push(Box::new(XarthFinalizer::default())),
        _ => {}
    }

    timeline.npcs.retain(|_, npc| npc.spawn < start);
    for npc in timeline.npcs.values_mut() {
        npc.dying.take_if(|dying| *dying >= start);
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
                    dying: None,
                    death: None,
                });
            }
            for event in &state.events {
                match event.kind {
                    EventKind::NpcDying(room_id) => {
                        if let Some(npc) = timeline.npcs.get_mut(&room_id) {
                            npc.dying = Some(tick);
                        }
                    }
                    EventKind::NpcDeath(death) => {
                        if let Some(npc) = timeline.npcs.get_mut(&death.npc) {
                            npc.death = Some(tick);
                        }
                    }
                    _ => {}
                }
            }
        }

        let ctx = FinalizeContext {
            party: &timeline.party,
            npcs: &timeline.npcs,
        };
        for finalizer in &mut finalizers {
            finalizer.tick(&ctx, tick, state);
        }
    }

    for finalizer in &mut finalizers {
        finalizer.finish(&mut timeline.stage_data);
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

struct XarpusFinalizer {
    legacy: bool,
    exhumes: BTreeMap<u32, XarpusExhumed>,
    next_exhumed: u32,
}

impl XarpusFinalizer {
    const HEAL_PROJECTILE: u32 = 1550;

    fn new(legacy: bool) -> Self {
        Self {
            legacy,
            exhumes: BTreeMap::new(),
            next_exhumed: 0,
        }
    }

    fn new_exhumed_id(&mut self) -> u32 {
        let id = self.next_exhumed;
        self.next_exhumed += 1;
        id
    }

    fn insert_exhumed_from_event(&mut self, tick: Tick, event: &XarpusExhumedEvent) {
        let id = self.new_exhumed_id();
        self.exhumes.insert(
            id,
            XarpusExhumed {
                position: event.position,
                spawn_tick: event.spawn_tick,
                despawn_tick: Some(tick),
                heal_count: u32::try_from(event.heal_ticks.len()).expect("heals fit in u32"),
            },
        );
    }
}

impl Finalizer for XarpusFinalizer {
    fn initialize(&mut self, history: &[Option<TickState>]) {
        for (tick, state) in history.iter().enumerate() {
            let Some(state) = state else {
                continue;
            };
            let tick = Tick::from_usize(tick);
            for event in &state.events {
                match &event.kind {
                    EventKind::XarpusExhumes(exhumes) => {
                        for id in &exhumes.despawned {
                            if let Some(exhumed) = self.exhumes.get_mut(id) {
                                exhumed.despawn_tick = Some(tick);
                            }
                        }
                        for exhumed in &exhumes.spawned {
                            self.exhumes.insert(
                                exhumed.id,
                                XarpusExhumed {
                                    position: exhumed.position,
                                    spawn_tick: tick,
                                    despawn_tick: None,
                                    heal_count: 0,
                                },
                            );
                            self.next_exhumed = self.next_exhumed.max(exhumed.id + 1);
                        }
                    }
                    EventKind::XarpusHeal(id) => {
                        if let Some(exhumed) = self.exhumes.get_mut(id) {
                            exhumed.heal_count += 1;
                        }
                    }
                    EventKind::XarpusExhumed(event) => self.insert_exhumed_from_event(tick, event),
                    _ => {}
                }
            }
        }
    }

    fn tick(&mut self, _ctx: &FinalizeContext, tick: Tick, state: &mut Option<TickState>) {
        let Some(state) = state else {
            return;
        };

        if self.legacy {
            // Old plugins sent heals in their exhumed events, so they don't
            // need to be rederived.
            for event in &state.events {
                if let EventKind::XarpusExhumed(event) = &event.kind {
                    self.insert_exhumed_from_event(tick, event);
                }
            }
            return;
        }

        let mut despawned = Vec::new();
        for (&id, exhumed) in &mut self.exhumes {
            if exhumed.despawn_tick.is_none()
                && !state
                    .objects
                    .contains(ObjectKind::XarpusExhumes, exhumed.position)
            {
                exhumed.despawn_tick = Some(tick);
                despawned.push(id);
            }
        }

        let mut spawned = Vec::new();
        for position in state.objects.iter_of(ObjectKind::XarpusExhumes) {
            if self
                .exhumes
                .values()
                .any(|exhumed| exhumed.despawn_tick.is_none() && exhumed.position == position)
            {
                continue;
            }
            let id = self.new_exhumed_id();
            self.exhumes.insert(
                id,
                XarpusExhumed {
                    position,
                    spawn_tick: tick,
                    despawn_tick: None,
                    heal_count: 0,
                },
            );
            spawned.push(Exhumed { id, position });
        }

        if !spawned.is_empty() || !despawned.is_empty() {
            state
                .events
                .push(Event::synthetic(EventKind::XarpusExhumes(XarpusExhumes {
                    spawned,
                    despawned,
                })));
        }

        let mut heals = Vec::new();
        for projectile in &state.raw_projectiles {
            if projectile.id != Self::HEAL_PROJECTILE {
                continue;
            }
            if let Some((&id, exhumed)) = self.exhumes.iter_mut().find(|(_, exhumed)| {
                exhumed.despawn_tick.is_none() && exhumed.position == projectile.source_coords
            }) {
                exhumed.heal_count += 1;
                heals.push(Event::synthetic(EventKind::XarpusHeal(id)));
            }
        }
        state.events.extend(heals);
    }

    fn finish(&mut self, stage_data: &mut StageData) {
        *stage_data = StageData::Xarpus {
            exhumes: std::mem::take(&mut self.exhumes),
        };
    }
}

#[derive(Default)]
struct GuardianFinalizer {
    guardian: Option<u32>,
    downs: u8,
    braziers: BTreeMap<RoomId, u32>,
    shrooms: BTreeMap<Point, Shroom>,
    next_shroom: u32,
}

impl GuardianFinalizer {
    const ROCK_PROJECTILE: u32 = 4201;
    const SHROOMS: [(ObjectKind, ShroomState); 3] = [
        (ObjectKind::GuardianShroomSpawning, ShroomState::Spawning),
        (ObjectKind::GuardianShroomGrown, ShroomState::Grown),
        (ObjectKind::GuardianShroomPopped, ShroomState::Popped),
    ];

    fn new_shroom_id(&mut self) -> u32 {
        let id = self.next_shroom;
        self.next_shroom += 1;
        id
    }
}

impl Finalizer for GuardianFinalizer {
    fn initialize(&mut self, history: &[Option<TickState>]) {
        for state in history.iter().flatten() {
            for (&room_id, npc) in &state.npcs {
                if npc::is_guardian(npc.id) {
                    self.guardian = Some(npc.id);
                } else if npc::is_guardian_brazier(npc.id) {
                    self.braziers.insert(room_id, npc.id);
                }
            }
            for event in &state.events {
                match &event.kind {
                    EventKind::GuardianDown(down_number) => self.downs = *down_number,
                    EventKind::GuardianShrooms(shrooms) => {
                        self.shrooms
                            .retain(|_, shroom| !shrooms.removed.contains(&shroom.id));
                        for &shroom in &shrooms.updated {
                            self.shrooms.insert(shroom.position, shroom);
                            self.next_shroom = self.next_shroom.max(shroom.id + 1);
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    fn tick(&mut self, ctx: &FinalizeContext, _tick: Tick, state: &mut Option<TickState>) {
        let Some(state) = state else {
            return;
        };

        let auto_attacked = state.events.iter().any(|event| {
            matches!(
                &event.kind,
                EventKind::NpcAttack(attack) if attack.attack == NpcAttack::TfaGuardianAuto
            )
        });
        if auto_attacked {
            let rocks = state
                .raw_projectiles
                .iter()
                .filter(|projectile| projectile.id == Self::ROCK_PROJECTILE)
                .filter_map(|projectile| match &projectile.target {
                    Some(RawActor::Player(name)) => PartyIndex::resolve(ctx.party, name),
                    Some(RawActor::Npc(_)) | None => None,
                })
                .collect::<Vec<_>>();
            if !rocks.is_empty() {
                state
                    .events
                    .push(Event::synthetic(EventKind::GuardianRocks(rocks)));
            }
        }

        for (&room_id, npc) in &state.npcs {
            if npc::is_guardian(npc.id) {
                let enraged = matches!(
                    &npc.properties,
                    Some(NpcProperties::Guardian(Guardian { enraged: true, .. }))
                );
                let previous = self.guardian.replace(npc.id);
                let event = match (previous, npc.id) {
                    (Some(npc::id::ARCHIVE_GUARDIAN), npc::id::ARCHIVE_GUARDIAN_UNSHIELDED)
                        if !enraged =>
                    {
                        self.downs += 1;
                        Some(EventKind::GuardianDown(self.downs))
                    }
                    (Some(npc::id::ARCHIVE_GUARDIAN_UNSHIELDED), npc::id::ARCHIVE_GUARDIAN) => {
                        Some(EventKind::GuardianUp)
                    }
                    _ => None,
                };
                state.events.extend(event.map(Event::synthetic));
            } else if npc::is_guardian_brazier(npc.id) {
                let previous = self.braziers.insert(room_id, npc.id);
                if matches!(
                    (previous, npc.id),
                    (
                        Some(npc::id::GUARDIAN_BATTERY),
                        npc::id::GUARDIAN_BATTERY_DESTROYED
                    )
                ) {
                    state
                        .events
                        .push(Event::synthetic(EventKind::GuardianBrazier(room_id)));
                }
            }
        }

        let mut tiles = BTreeMap::new();
        for (kind, shroom_state) in Self::SHROOMS {
            for position in state.objects.iter_of(kind) {
                tiles.insert(position, shroom_state);
            }
        }

        let mut removed = self
            .shrooms
            .extract_if(.., |position, _| !tiles.contains_key(position))
            .map(|(_, shroom)| shroom.id)
            .collect::<Vec<_>>();

        let mut updated = Vec::new();
        for (position, shroom_state) in tiles {
            let id = match self.shrooms.get(&position) {
                Some(shroom) if shroom.state == shroom_state => continue,
                Some(shroom) if shroom_state == ShroomState::Spawning => {
                    removed.push(shroom.id);
                    self.new_shroom_id()
                }
                Some(shroom) => shroom.id,
                None => self.new_shroom_id(),
            };
            let shroom = Shroom {
                id,
                position,
                state: shroom_state,
            };
            self.shrooms.insert(position, shroom);
            updated.push(shroom);
        }

        if !updated.is_empty() || !removed.is_empty() {
            state
                .events
                .push(Event::synthetic(EventKind::GuardianShrooms(
                    GuardianShrooms { updated, removed },
                )));
        }
    }
}

#[derive(Default)]
struct XarthFinalizer {
    fires: BTreeSet<Point>,
}

impl XarthFinalizer {
    const BOMB_PROJECTILE: u32 = 4378;
    const CORPSE_LEAK_ANIMATION: u32 = 15005;
}

impl Finalizer for XarthFinalizer {
    fn initialize(&mut self, history: &[Option<TickState>]) {
        if let Some(state) = history.iter().rev().flatten().next() {
            self.fires = state.objects.iter_of(ObjectKind::XarthFire).collect();
        }
    }

    fn tick(&mut self, _ctx: &FinalizeContext, tick: Tick, state: &mut Option<TickState>) {
        let Some(state) = state else {
            return;
        };

        let full = state
            .objects
            .iter_of(ObjectKind::XarthBlastFull)
            .collect::<Vec<_>>();
        let partial = state
            .objects
            .iter_of(ObjectKind::XarthBlastPartial)
            .collect::<Vec<_>>();
        if !full.is_empty() || !partial.is_empty() {
            state
                .events
                .push(Event::synthetic(EventKind::XarthBlast(XarthBlast {
                    full,
                    partial,
                })));
        }

        let fires = state
            .objects
            .iter_of(ObjectKind::XarthFire)
            .collect::<BTreeSet<_>>();
        let added = fires.difference(&self.fires).copied().collect::<Vec<_>>();
        let removed = self.fires.difference(&fires).copied().collect::<Vec<_>>();
        if !added.is_empty() || !removed.is_empty() {
            state
                .events
                .push(Event::synthetic(EventKind::XarthFires(XarthFires {
                    added,
                    removed,
                })));
        }
        self.fires = fires;

        let leaks = state
            .npcs
            .iter()
            .filter(|&(room_id, npc)| {
                npc::is_xarth_corpse(npc.id)
                    && state
                        .raw_npcs
                        .get(room_id)
                        .and_then(|raw| raw.animation(tick))
                        == Some(Self::CORPSE_LEAK_ANIMATION)
            })
            .map(|(&room_id, _)| Event::synthetic(EventKind::XarthCorpseLeak(room_id)))
            .collect::<Vec<_>>();
        state.events.extend(leaks);

        if !state.events.iter().any(|event| {
            matches!(
                &event.kind,
                EventKind::NpcAttack(attack) if attack.attack == NpcAttack::TfaXarthBind
            )
        }) {
            return;
        }

        let bombs = state
            .raw_projectiles
            .iter()
            .filter(|projectile| projectile.id == Self::BOMB_PROJECTILE)
            .collect::<Vec<_>>();
        let Some(landing_tick) = bombs.first().map(|projectile| projectile.landing_tick) else {
            return;
        };
        state
            .events
            .push(Event::synthetic(EventKind::XarthBombs(XarthBombs {
                tiles: bombs
                    .iter()
                    .map(|projectile| projectile.target_coords)
                    .collect(),
                landing_tick,
            })));
    }
}

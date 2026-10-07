//! Encoding of a timeline to proto events.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use crate::actor::{
    Actor, DataSource, NpcProperties, NpcState, NyloSpawn, PartyIndex, PlayerState, RoomId,
};
use crate::event::{EventKind, Maze, SolDust, XarpusExhumed, XarpusSplatSource};
use crate::item::{EQUIPMENT_SLOTS, Item, ItemDelta, Slot};
use crate::objects::{ObjectKind, TickObjects};
use crate::tick::Tick;
use crate::{Point, Stage, npc, proto};

use super::{TickState, Timeline};

/// Encodes every tick of `timeline` from `start` to proto events.
pub(super) fn encode_from(timeline: &Timeline, start: Tick) -> impl Iterator<Item = proto::Event> {
    Encoder::new(timeline, start)
}

struct Encoder<'a> {
    timeline: &'a Timeline,
    next: Tick,
    pending: std::vec::IntoIter<proto::Event>,
    players: Vec<Option<&'a PlayerState>>,
    off_cooldown_ticks: Vec<Tick>,
    npcs: HashMap<RoomId, &'a NpcState>,
    dead_actors: HashSet<Actor>,
    stage: StageContext,
}

impl<'a> Encoder<'a> {
    fn new(timeline: &'a Timeline, start: Tick) -> Self {
        let mut encoder = Self {
            timeline,
            next: start,
            pending: Vec::new().into_iter(),
            players: vec![None; timeline.party.len()],
            off_cooldown_ticks: vec![Tick(0); timeline.party.len()],
            npcs: HashMap::new(),
            dead_actors: HashSet::new(),
            stage: StageContext::new(timeline.stage),
        };
        for tick in start.up_to() {
            encoder.tick(tick, false);
        }
        encoder
    }

    fn tick(&mut self, tick: Tick, encode_events: bool) -> Vec<proto::Event> {
        let mut events = Vec::new();
        let Some(state) = self.timeline.get_state(tick) else {
            return events;
        };

        self.stage.tick(state);

        for (index, player) in state.players.iter() {
            if self.dead_actors.contains(&Actor::Player(index)) {
                continue;
            }
            if let Some(off_cooldown) = off_cooldown_tick(tick, state, index) {
                self.off_cooldown_ticks[index.as_usize()] = off_cooldown;
            }
            if encode_events {
                events.push(self.player_update_event(tick, index, player));
            }
            self.players[index.as_usize()] = Some(player);
        }

        for (&room_id, npc) in &state.npcs {
            if self.dead_actors.contains(&Actor::Npc(room_id)) {
                continue;
            }
            if encode_events {
                let previous = self.npcs.get(&room_id).copied();
                events.push(self.npc_state_event(tick, room_id, npc, previous));
            }
            self.npcs.insert(room_id, npc);
        }

        if encode_events {
            self.encode_object_events(tick, state, &mut events);
            for event in &state.events {
                events.extend(self.encode_event(tick, state, &event.kind));
            }
        }

        // Mark dead actors after all events are encoded so that they are dead
        // starting from the next tick.
        for event in &state.events {
            match event.kind {
                EventKind::PlayerDeath(index) => {
                    self.dead_actors.insert(Actor::Player(index));
                }
                EventKind::NpcDeath(death) => {
                    self.dead_actors.insert(Actor::Npc(death.npc));
                }
                _ => {}
            }
        }

        events
    }

    fn event(&self, kind: proto::event::Type, tick: Tick, position: Option<Point>) -> proto::Event {
        proto::Event {
            r#type: kind as i32,
            stage: self.timeline.stage as i32,
            tick: tick.0,
            x_coord: position.map_or(0, |position| i32::from(position.0)),
            y_coord: position.map_or(0, |position| i32::from(position.1)),
            ..Default::default()
        }
    }

    fn player_update_event(
        &self,
        tick: Tick,
        index: PartyIndex,
        player: &PlayerState,
    ) -> proto::Event {
        let previous = self.players[index.as_usize()];
        let stats = match player.data {
            DataSource::Primary(stats) => Some(stats),
            DataSource::Secondary => None,
        };
        let mut event = self.event(
            proto::event::Type::PlayerUpdate,
            tick,
            Some(player.position),
        );
        event.player = Some(proto::event::Player {
            name: self.timeline.party[index.as_usize()].to_string(),
            off_cooldown_tick: self.off_cooldown_ticks[index.as_usize()].0,
            hitpoints: stats.map(|stats| stats.hitpoints.to_raw()),
            prayer: stats.map(|stats| stats.prayer.to_raw()),
            attack: stats.map(|stats| stats.attack.to_raw()),
            strength: stats.map(|stats| stats.strength.to_raw()),
            defence: stats.map(|stats| stats.defence.to_raw()),
            ranged: stats.map(|stats| stats.ranged.to_raw()),
            magic: stats.map(|stats| stats.magic.to_raw()),
            equipment_deltas: encode_equipment_deltas(
                &previous.map_or([None; EQUIPMENT_SLOTS], |previous| previous.equipment),
                &player.equipment,
            ),
            active_prayers: Some(player.prayers.to_raw()),
            data_source: match player.data {
                DataSource::Primary(_) => proto::event::player::DataSource::Primary,
                DataSource::Secondary => proto::event::player::DataSource::Secondary,
            } as i32,
            party_index: u32::from(index.0),
            ..Default::default()
        });
        event
    }

    fn npc_state_event(
        &self,
        tick: Tick,
        room_id: RoomId,
        npc: &NpcState,
        previous: Option<&NpcState>,
    ) -> proto::Event {
        let kind = if previous.is_none() {
            proto::event::Type::NpcSpawn
        } else {
            proto::event::Type::NpcUpdate
        };
        let mut event = self.event(kind, tick, Some(npc.position.point));
        event.npc = Some(proto::event::Npc {
            id: npc.npc_id,
            room_id: room_id.0,
            hitpoints: npc.hitpoints.to_raw(),
            active_prayers: npc.prayers.to_raw(),
            r#type: npc
                .properties
                .as_ref()
                .filter(|&properties| {
                    previous.and_then(|previous| previous.properties.as_ref()) != Some(properties)
                })
                .and_then(npc_type),
        });
        event
    }

    #[expect(clippy::too_many_lines)]
    fn encode_object_events(&self, tick: Tick, state: &TickState, events: &mut Vec<proto::Event>) {
        let empty = TickObjects::default();
        let previous = if tick == Tick(0) {
            &empty
        } else {
            self.timeline
                .get_state(tick.pred())
                .map_or(&empty, |previous| &previous.objects)
        };

        let kinds = state.objects.kinds().chain(
            previous
                .kinds()
                .filter(|&kind| !state.objects.contains_kind(kind)),
        );
        for kind in kinds {
            let points = || {
                state
                    .objects
                    .iter_of(kind)
                    .map(proto::Coords::from)
                    .collect::<Vec<_>>()
            };

            match kind {
                ObjectKind::MaidenBloodSplats
                | ObjectKind::SoteMazeTiles
                | ObjectKind::VerzikYellows
                | ObjectKind::MokhaiotlShockwave
                    if !state.objects.contains_kind(kind) => {}
                ObjectKind::MaidenBloodSplats => {
                    let mut event =
                        self.event(proto::event::Type::TobMaidenBloodSplats, tick, None);
                    event.maiden_blood_splats = points();
                    events.push(event);
                }
                ObjectKind::SoteMazeTiles => {
                    let StageContext::Sotetseg { maze: Some(maze) } = self.stage else {
                        continue;
                    };
                    let mut event = self.event(proto::event::Type::TobSoteMazePath, tick, None);
                    event.sote_maze = Some(proto::event::SoteMaze {
                        maze: maze as i32,
                        overworld_tiles: points(),
                        ..Default::default()
                    });
                    events.push(event);
                }
                ObjectKind::VerzikYellows => {
                    let mut event = self.event(proto::event::Type::TobVerzikYellows, tick, None);
                    event.verzik_yellows = points();
                    events.push(event);
                }
                ObjectKind::ColosseumReentryPrimaryPool
                | ObjectKind::ColosseumReentrySecondaryPool => {
                    let (spawned, despawned) = diff_objects(previous, &state.objects, kind);
                    if spawned.is_empty() && despawned.is_empty() {
                        continue;
                    }
                    let mut event =
                        self.event(proto::event::Type::ColosseumReentryPools, tick, None);
                    event.colosseum_reentry_pools =
                        Some(if kind == ObjectKind::ColosseumReentryPrimaryPool {
                            proto::event::ColosseumReentryPools {
                                primary_spawned: spawned,
                                primary_despawned: despawned,
                                ..Default::default()
                            }
                        } else {
                            proto::event::ColosseumReentryPools {
                                secondary_spawned: spawned,
                                secondary_despawned: despawned,
                                ..Default::default()
                            }
                        });
                    events.push(event);
                }
                ObjectKind::MokhaiotlRock | ObjectKind::MokhaiotlSplat => {
                    let (spawned, despawned) = diff_objects(previous, &state.objects, kind);
                    if spawned.is_empty() && despawned.is_empty() {
                        continue;
                    }
                    let mut event = self.event(proto::event::Type::MokhaiotlObjects, tick, None);
                    event.mokhaiotl_objects = Some(if kind == ObjectKind::MokhaiotlRock {
                        proto::event::MokhaiotlObjects {
                            rocks_spawned: spawned,
                            rocks_despawned: despawned,
                            ..Default::default()
                        }
                    } else {
                        proto::event::MokhaiotlObjects {
                            splats_spawned: spawned,
                            splats_despawned: despawned,
                            ..Default::default()
                        }
                    });
                    events.push(event);
                }
                ObjectKind::MokhaiotlShockwave => {
                    let mut event = self.event(proto::event::Type::MokhaiotlShockwave, tick, None);
                    event.mokhaiotl_shockwave =
                        Some(proto::event::MokhaiotlShockwave { tiles: points() });
                    events.push(event);
                }
            }
        }
    }

    #[expect(clippy::too_many_lines)]
    fn encode_event(
        &self,
        tick: Tick,
        state: &TickState,
        kind: &EventKind,
    ) -> Option<proto::Event> {
        match kind {
            EventKind::PlayerDeath(index) => {
                let position = state.players.get(*index).map(|player| player.position);
                let mut event = self.event(proto::event::Type::PlayerDeath, tick, position);
                event.player = Some(proto::event::Player {
                    name: self.timeline.party[index.as_usize()].to_string(),
                    party_index: u32::from(index.0),
                    ..Default::default()
                });
                Some(event)
            }

            EventKind::PlayerAttack(attack) => {
                if self.dead_actors.contains(&Actor::Player(attack.player)) {
                    return None;
                }
                let player = state.players.get(attack.player)?;
                let target = match attack.target {
                    Some(Actor::Npc(room_id)) => Some((room_id, state.npcs.get(&room_id))),
                    Some(Actor::Player(_)) | None => None,
                };
                let mut event = self.event(
                    proto::event::Type::PlayerAttack,
                    tick,
                    Some(player.position),
                );
                event.player = Some(proto::event::Player {
                    name: self.timeline.party[attack.player.as_usize()].to_string(),
                    party_index: u32::from(attack.player.0),
                    ..Default::default()
                });
                event.player_attack = Some(proto::event::Attack {
                    r#type: attack.attack as i32,
                    weapon: attack.weapon.filter(|weapon| weapon.id > 0).map(|weapon| {
                        proto::event::player::EquippedItem {
                            slot: proto::event::player::EquipmentSlot::Weapon as i32,
                            id: weapon.id,
                            quantity: weapon.quantity,
                        }
                    }),
                    target: target.map(|(room_id, npc)| proto::event::Npc {
                        id: npc.map_or(0, |npc| npc.npc_id),
                        room_id: room_id.0,
                        ..Default::default()
                    }),
                    distance_to_target: target
                        .and_then(|(_, npc)| npc)
                        .map_or(-1, |npc| i32::from(npc.position.distance(player.position))),
                });
                Some(event)
            }

            EventKind::PlayerSpell(cast) => {
                if self.dead_actors.contains(&Actor::Player(cast.player)) {
                    return None;
                }
                let player = state.players.get(cast.player)?;
                let target = match cast.target {
                    Some(Actor::Player(target)) => proto::event::spell::Target::TargetPlayer(
                        self.timeline.party[target.as_usize()].to_string(),
                    ),
                    Some(Actor::Npc(room_id)) => {
                        proto::event::spell::Target::TargetNpc(proto::event::Npc {
                            id: state.npcs.get(&room_id).map_or(0, |npc| npc.npc_id),
                            room_id: room_id.0,
                            ..Default::default()
                        })
                    }
                    None => proto::event::spell::Target::NoTarget(()),
                };
                let mut event =
                    self.event(proto::event::Type::PlayerSpell, tick, Some(player.position));
                event.player = Some(proto::event::Player {
                    name: self.timeline.party[cast.player.as_usize()].to_string(),
                    party_index: u32::from(cast.player.0),
                    ..Default::default()
                });
                event.player_spell = Some(proto::event::Spell {
                    r#type: cast.spell as i32,
                    target: Some(target),
                });
                Some(event)
            }

            EventKind::NpcDeath(death) => {
                let npc = self.npcs.get(&death.npc);
                let mut event =
                    self.event(proto::event::Type::NpcDeath, tick, Some(death.position));
                event.npc = Some(proto::event::Npc {
                    id: death
                        .npc_id
                        .unwrap_or_else(|| npc.map_or(0, |npc| npc.npc_id)),
                    room_id: death.npc.0,
                    hitpoints: npc.map_or(0, |npc| npc.hitpoints.to_raw()),
                    active_prayers: npc.map_or(0, |npc| npc.prayers.to_raw()),
                    r#type: None,
                });
                Some(event)
            }

            EventKind::NpcAttack(attack) => {
                if self.dead_actors.contains(&Actor::Npc(attack.npc)) {
                    return None;
                }
                let npc = state.npcs.get(&attack.npc)?;
                let mut event = self.event(
                    proto::event::Type::NpcAttack,
                    tick,
                    Some(npc.position.point),
                );
                event.npc = Some(proto::event::Npc {
                    id: npc.npc_id,
                    room_id: attack.npc.0,
                    ..Default::default()
                });
                event.npc_attack = Some(proto::event::NpcAttacked {
                    attack: attack.attack as i32,
                    target: match attack.target {
                        Some(Actor::Player(target)) => {
                            Some(self.timeline.party[target.as_usize()].to_string())
                        }
                        Some(Actor::Npc(_)) | None => None,
                    },
                });
                Some(event)
            }

            EventKind::MaidenCrabLeak(room_id) => {
                let npc = self.npcs.get(room_id)?;
                let mut event = self.event(
                    proto::event::Type::TobMaidenCrabLeak,
                    tick,
                    Some(npc.position.point),
                );
                event.npc = Some(proto::event::Npc {
                    id: npc.npc_id,
                    room_id: room_id.0,
                    hitpoints: npc.hitpoints.to_raw(),
                    active_prayers: npc.prayers.to_raw(),
                    r#type: npc.properties.as_ref().and_then(npc_type),
                });
                Some(event)
            }

            EventKind::BloatDown(down) => {
                let position = state
                    .npcs
                    .values()
                    .find(|npc| npc::is_bloat(npc.npc_id))
                    .map(|bloat| bloat.position.point);
                let mut event = self.event(proto::event::Type::TobBloatDown, tick, position);
                event.bloat_down = Some(proto::event::BloatDown {
                    down_number: down.down_number,
                    up_ticks: down.up_ticks.0,
                });
                Some(event)
            }

            EventKind::BloatUp => Some(self.event(proto::event::Type::TobBloatUp, tick, None)),

            EventKind::BloatHandsDrop(hands) => {
                let mut event = self.event(proto::event::Type::TobBloatHandsDrop, tick, None);
                event.bloat_hands = hands.iter().copied().map(proto::Coords::from).collect();
                Some(event)
            }

            EventKind::BloatHandsSplat(hands) => {
                let mut event = self.event(proto::event::Type::TobBloatHandsSplat, tick, None);
                event.bloat_hands = hands.iter().copied().map(proto::Coords::from).collect();
                Some(event)
            }

            EventKind::NyloWaveSpawn(wave) => {
                let mut event = self.event(proto::event::Type::TobNyloWaveSpawn, tick, None);
                event.nylo_wave = Some(proto::event::NyloWave {
                    wave: u32::from(wave.wave),
                    nylos_alive: u32::from(wave.nylos_alive),
                    room_cap: u32::from(wave.current_cap(self.timeline.mode)),
                });
                Some(event)
            }

            EventKind::NyloWaveStall(wave) => {
                let mut event = self.event(proto::event::Type::TobNyloWaveStall, tick, None);
                event.nylo_wave = Some(proto::event::NyloWave {
                    wave: u32::from(wave.wave),
                    nylos_alive: u32::from(wave.nylos_alive),
                    room_cap: u32::from(wave.current_cap(self.timeline.mode)),
                });
                Some(event)
            }

            EventKind::NyloCleanupEnd => {
                Some(self.event(proto::event::Type::TobNyloCleanupEnd, tick, None))
            }

            EventKind::NyloBossSpawn => {
                Some(self.event(proto::event::Type::TobNyloBossSpawn, tick, None))
            }

            EventKind::SoteMazeProc(maze) => {
                let mut event = self.event(proto::event::Type::TobSoteMazeProc, tick, None);
                event.sote_maze = Some(proto::event::SoteMaze {
                    maze: *maze as i32,
                    ..Default::default()
                });
                Some(event)
            }

            EventKind::XarpusPhase(phase) => {
                let mut event = self.event(proto::event::Type::TobXarpusPhase, tick, None);
                event.xarpus_phase = Some(*phase as i32);
                Some(event)
            }

            EventKind::XarpusExhumed(exhumed) => {
                let mut event = self.event(
                    proto::event::Type::TobXarpusExhumed,
                    tick,
                    Some(exhumed.position),
                );
                event.xarpus_exhumed = Some(proto::event::XarpusExhumed {
                    spawn_tick: exhumed.spawn_tick.0,
                    heal_amount: XarpusExhumed::heal_amount(
                        self.timeline.mode,
                        self.timeline.party.len(),
                    ),
                    heal_ticks: exhumed.heal_ticks.iter().map(|tick| tick.0).collect(),
                });
                Some(event)
            }

            EventKind::XarpusSplat(splat) => {
                let mut event = self.event(
                    proto::event::Type::TobXarpusSplat,
                    tick,
                    Some(splat.position),
                );
                event.xarpus_splat = Some(match splat.source {
                    XarpusSplatSource::Unknown => proto::event::XarpusSplat {
                        source: proto::event::xarpus_splat::Source::Unknown as i32,
                        bounce_from: None,
                    },
                    XarpusSplatSource::Xarpus => proto::event::XarpusSplat {
                        source: proto::event::xarpus_splat::Source::Xarpus as i32,
                        bounce_from: None,
                    },
                    XarpusSplatSource::Bounce(from) => proto::event::XarpusSplat {
                        source: proto::event::xarpus_splat::Source::Bounce as i32,
                        bounce_from: Some(proto::Coords::from(from)),
                    },
                });
                Some(event)
            }

            EventKind::VerzikPhase(phase) => {
                let mut event = self.event(proto::event::Type::TobVerzikPhase, tick, None);
                event.verzik_phase = Some(*phase as i32);
                Some(event)
            }

            EventKind::VerzikDawnDropped(point) => {
                let mut event =
                    self.event(proto::event::Type::TobVerzikDawnDrop, tick, Some(*point));
                event.verzik_dawn_drop = Some(proto::event::VerzikDawnDrop { dropped: true });
                Some(event)
            }

            EventKind::VerzikDawnPickedUp(point) => {
                let mut event =
                    self.event(proto::event::Type::TobVerzikDawnDrop, tick, Some(*point));
                event.verzik_dawn_drop = Some(proto::event::VerzikDawnDrop { dropped: false });
                Some(event)
            }

            EventKind::VerzikDawnHit(hit) => {
                let mut event = self.event(proto::event::Type::TobVerzikDawn, tick, None);
                event.verzik_dawn = Some(proto::event::VerzikDawn {
                    attack_tick: hit.attack_tick.0,
                    damage: hit.damage,
                    player: self.timeline.party[hit.player.as_usize()].to_string(),
                });
                Some(event)
            }

            EventKind::VerzikBounce(bounce) => {
                let players_alive = (0..self.timeline.party.len())
                    .map(PartyIndex::from_usize)
                    .filter(|&index| !self.dead_actors.contains(&Actor::Player(index)))
                    .count();
                let not_in_range =
                    players_alive.saturating_sub(usize::from(bounce.players_in_range));
                let mut event = self.event(proto::event::Type::TobVerzikBounce, tick, None);
                event.verzik_bounce = Some(proto::event::VerzikBounce {
                    npc_attack_tick: bounce.attack_tick.0.cast_signed(),
                    players_in_range: u32::from(bounce.players_in_range),
                    players_not_in_range: u32::try_from(not_in_range).expect("party is small"),
                    bounced_player: bounce
                        .bounced
                        .map(|player| self.timeline.party[player.as_usize()].to_string()),
                });
                Some(event)
            }

            EventKind::VerzikHeal(heal) => {
                let position = state.players.get(heal.player).map(|player| player.position);
                let mut event = self.event(proto::event::Type::TobVerzikHeal, tick, position);
                event.verzik_heal = Some(proto::event::VerzikHeal {
                    player: self.timeline.party[heal.player.as_usize()].to_string(),
                    heal_amount: heal.amount.map_or(-1, u32::cast_signed),
                });
                Some(event)
            }

            EventKind::DoomApplied => {
                Some(self.event(proto::event::Type::ColosseumDoomApplied, tick, None))
            }

            EventKind::TotemHeal(heal) => {
                let mut event = self.event(proto::event::Type::ColosseumTotemHeal, tick, None);
                event.colosseum_totem_heal = Some(proto::event::ColosseumTotemHeal {
                    source: Some(proto::event::Npc {
                        id: self.npcs.get(&heal.totem).map_or(0, |npc| npc.npc_id),
                        room_id: heal.totem.0,
                        ..Default::default()
                    }),
                    target: Some(proto::event::Npc {
                        id: self.npcs.get(&heal.target).map_or(0, |npc| npc.npc_id),
                        room_id: heal.target.0,
                        ..Default::default()
                    }),
                    start_tick: heal.start_tick.0,
                    heal_amount: heal.amount,
                });
                Some(event)
            }

            EventKind::SolDust(dust) => {
                let mut event = self.event(proto::event::Type::ColosseumSolDust, tick, None);
                event.colosseum_sol_dust = Some(match *dust {
                    SolDust::Trident1(direction) => proto::event::ColosseumSolDust {
                        pattern: proto::event::colosseum_sol_dust::Pattern::Trident1 as i32,
                        direction: Some(direction as i32),
                    },
                    SolDust::Trident2(direction) => proto::event::ColosseumSolDust {
                        pattern: proto::event::colosseum_sol_dust::Pattern::Trident2 as i32,
                        direction: Some(direction as i32),
                    },
                    SolDust::Shield1 => proto::event::ColosseumSolDust {
                        pattern: proto::event::colosseum_sol_dust::Pattern::Shield1 as i32,
                        direction: None,
                    },
                    SolDust::Shield2 => proto::event::ColosseumSolDust {
                        pattern: proto::event::colosseum_sol_dust::Pattern::Shield2 as i32,
                        direction: None,
                    },
                });
                Some(event)
            }

            EventKind::SolGrapple(grapple) => {
                let mut event = self.event(proto::event::Type::ColosseumSolGrapple, tick, None);
                event.colosseum_sol_grapple = Some(proto::event::ColosseumSolGrapple {
                    attack_tick: grapple.attack_tick.0,
                    target: grapple.target as i32,
                    outcome: grapple.outcome as i32,
                });
                Some(event)
            }

            EventKind::SolPools(pools) => {
                let mut event = self.event(proto::event::Type::ColosseumSolPools, tick, None);
                event.colosseum_sol_pools = Some(proto::event::ColosseumSolPools {
                    pools: pools.iter().copied().map(proto::Coords::from).collect(),
                });
                Some(event)
            }

            EventKind::SolLasers(phase) => {
                let mut event = self.event(proto::event::Type::ColosseumSolLasers, tick, None);
                event.colosseum_sol_lasers = Some(proto::event::ColosseumSolLasers {
                    phase: *phase as i32,
                });
                Some(event)
            }

            EventKind::MokhaiotlOrb(orb) => {
                let mut event = self.event(proto::event::Type::MokhaiotlOrb, tick, None);
                event.mokhaiotl_orb = Some(proto::event::MokhaiotlOrb {
                    source: orb.source as i32,
                    source_point: Some(proto::Coords::from(orb.source_point)),
                    style: proto::event::attack_style::Style::from(orb.style) as i32,
                    start_tick: orb.spawn_tick.0,
                    end_tick: orb.end_tick.0,
                });
                Some(event)
            }

            EventKind::MokhaiotlLarvaLeak(leak) => {
                let mut event = self.event(proto::event::Type::MokhaiotlLarvaLeak, tick, None);
                event.mokhaiotl_larva_leak = Some(proto::event::MokhaiotlLarvaLeak {
                    room_id: leak.larva.0,
                    heal_amount: leak.heal_amount,
                });
                Some(event)
            }

            // Deliberately omitted from the wire.
            EventKind::SoteMazePivots(_)
            | EventKind::SoteMazeEnd(_)
            | EventKind::HandicapChoice(_)
            | EventKind::InfernoWaveStart(_) => None,
        }
    }
}

impl Iterator for Encoder<'_> {
    type Item = proto::Event;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            if let Some(event) = self.pending.next() {
                return Some(event);
            }
            if self.next > self.timeline.last_tick() {
                return None;
            }
            let tick = self.next;
            self.next = tick.succ();
            self.pending = self.tick(tick, true).into_iter();
        }
    }
}

enum StageContext {
    None,
    Sotetseg { maze: Option<Maze> },
}

impl StageContext {
    fn new(stage: Stage) -> Self {
        match stage {
            Stage::TobSotetseg => Self::Sotetseg { maze: None },
            _ => Self::None,
        }
    }

    /// Updates stage state based on what happened on a tick.
    fn tick(&mut self, state: &TickState) {
        match self {
            Self::Sotetseg { maze } => {
                for event in &state.events {
                    match event.kind {
                        EventKind::SoteMazeProc(proc) => *maze = Some(proc),
                        EventKind::SoteMazeEnd(_) => *maze = None,
                        _ => {}
                    }
                }
            }
            Self::None => {}
        }
    }
}

fn off_cooldown_tick(tick: Tick, state: &TickState, player: PartyIndex) -> Option<Tick> {
    state.events.iter().find_map(|event| {
        let EventKind::PlayerAttack(attack) = &event.kind else {
            return None;
        };
        if attack.player != player {
            return None;
        }
        if let Some(Actor::Npc(room_id)) = attack.target
            && let Some(target) = state.npcs.get(&room_id)
            && !target.attack_applies_cooldown(attack.attack)
        {
            return None;
        }
        Some(tick + attack.attack.cooldown())
    })
}

fn npc_type(properties: &NpcProperties) -> Option<proto::event::npc::Type> {
    let npc_type = match properties {
        NpcProperties::MaidenCrab(crab) => {
            proto::event::npc::Type::MaidenCrab(proto::event::npc::MaidenCrab {
                spawn: crab.spawn as i32,
                position: crab.position as i32,
                scuffed: crab.scuffed,
            })
        }
        NpcProperties::Nylo(nylo) => {
            let (spawn_type, parent_room_id) = match nylo.spawn {
                NyloSpawn::Split(parent) => (
                    proto::event::npc::nylo::SpawnType::Split,
                    parent.map_or(0, |parent| parent.0),
                ),
                NyloSpawn::West => (proto::event::npc::nylo::SpawnType::West, 0),
                NyloSpawn::South => (proto::event::npc::nylo::SpawnType::South, 0),
                NyloSpawn::East => (proto::event::npc::nylo::SpawnType::East, 0),
                NyloSpawn::Unknown => (proto::event::npc::nylo::SpawnType::Unknown, 0),
            };
            proto::event::npc::Type::Nylo(proto::event::npc::Nylo {
                wave: nylo.wave,
                parent_room_id,
                big: nylo.big,
                style: proto::event::npc::nylo::Style::from(nylo.style) as i32,
                spawn_type: spawn_type as i32,
            })
        }
        NpcProperties::VerzikCrab(crab) => {
            proto::event::npc::Type::VerzikCrab(proto::event::npc::VerzikCrab {
                phase: crab.phase as i32,
                spawn: crab.spawn as i32,
            })
        }
        NpcProperties::Mokhaiotl(_) => return None,
    };
    Some(npc_type)
}

fn encode_equipment_deltas(
    previous: &[Option<Item>; EQUIPMENT_SLOTS],
    current: &[Option<Item>; EQUIPMENT_SLOTS],
) -> Vec<u64> {
    let mut deltas = Vec::new();
    for (slot, (previous, current)) in previous.iter().zip(current).enumerate() {
        let slot = Slot(u8::try_from(slot).expect("equipment has few slots"));
        let delta = match (previous, current) {
            (Some(previous), Some(current)) if previous.id == current.id => {
                match current.quantity.cmp(&previous.quantity) {
                    Ordering::Greater => ItemDelta::Add(
                        slot,
                        Item {
                            id: current.id,
                            quantity: current.quantity - previous.quantity,
                        },
                    ),
                    Ordering::Less => ItemDelta::Remove(
                        slot,
                        Item {
                            id: current.id,
                            quantity: previous.quantity - current.quantity,
                        },
                    ),
                    Ordering::Equal => continue,
                }
            }
            (_, Some(current)) => ItemDelta::Add(slot, *current),
            (Some(previous), None) => ItemDelta::Remove(slot, *previous),
            (None, None) => continue,
        };
        deltas.push(delta.to_raw());
    }
    deltas
}

fn diff_objects(
    previous: &TickObjects,
    current: &TickObjects,
    kind: ObjectKind,
) -> (Vec<proto::Coords>, Vec<proto::Coords>) {
    let spawned = current
        .iter_of(kind)
        .filter(|&point| !previous.contains(kind, point))
        .map(proto::Coords::from)
        .collect();
    let despawned = previous
        .iter_of(kind)
        .filter(|&point| !current.contains(kind, point))
        .map(proto::Coords::from)
        .collect();
    (spawned, despawned)
}

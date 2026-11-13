use std::collections::BTreeMap;

use crate::actor::{Actor, PartyIndex, Rsn};
use crate::event::{Event, EventKind, NpcAttacked, NpcDeath};
use crate::objects::ObjectKind;
use crate::proto::event::object_update;
use crate::tick::Tick;
use crate::timeline::RawActor;
use crate::{NpcAttack, Point, Recording, RoomId, Source, TickState, npc};

use super::{HitpointsVarbits, InterpretContext, Interpreter, ObjectDef, SpotAnimPlacement};

const HITPOINTS_VARBIT: u32 = 6099;
const MAX_HITPOINTS_VARBIT: u32 = 6100;

const MAGE_ANIMATION: u32 = 14984;
const RANGE_ANIMATION: u32 = 14985;
const MELEE_ANIMATION: u32 = 14983;
const BIND_ANIMATION: u32 = 14992;
const BLAST_ANIMATION: u32 = 14989;

const MAGE_PROJECTILE: u32 = 4034;
const RANGE_PROJECTILE: u32 = 4374;

const FULL_BLAST_SPOT_ANIM: u32 = 3310;
const PARTIAL_BLAST_SPOT_ANIM: u32 = 4030;

const FIRE_OBJECT: ObjectDef = ObjectDef(object_update::Type::Game, 62713);

struct Pillar {
    room_id: RoomId,
    destroyed: Option<(Tick, RoomId)>,
    absent_since: Option<Tick>,
}

pub(super) struct XarthInterpreter<'a> {
    ctx: &'a InterpretContext,
    room_id: RoomId,
    phase_two: bool,
    varbits: HitpointsVarbits,
    pillars: BTreeMap<Point, Pillar>,
    events: BTreeMap<Tick, Vec<EventKind>>,
}

impl<'a> XarthInterpreter<'a> {
    pub(super) fn new(ctx: &'a InterpretContext, recording: &Recording) -> Option<Self> {
        let room_id = recording.states().find_map(|(_, state)| {
            state
                .npcs
                .iter()
                .find_map(|(&room_id, npc)| (npc.id == npc::id::XARTH).then_some(room_id))
        })?;

        Some(Self {
            ctx,
            room_id,
            varbits: HitpointsVarbits::new(room_id, HITPOINTS_VARBIT, MAX_HITPOINTS_VARBIT),
            pillars: BTreeMap::new(),
            phase_two: false,
            events: BTreeMap::new(),
        })
    }

    fn decide_attacks(&mut self, tick: Tick, state: &TickState, party: &[Rsn]) {
        let Some((_, raw)) = state.generic_npc(self.room_id) else {
            return;
        };
        let projectile_target = |id| {
            state
                .raw_projectiles
                .iter()
                .find_map(|projectile| match &projectile.target {
                    Some(RawActor::Player(name)) if projectile.id == id => Some(name),
                    _ => None,
                })
                .and_then(|name| PartyIndex::resolve(party, name))
                .map(Actor::Player)
        };

        let (attack, target) = match raw.animation(tick) {
            Some(MAGE_ANIMATION) if !self.phase_two => {
                (NpcAttack::TfaXarthMage, projectile_target(MAGE_PROJECTILE))
            }
            Some(RANGE_ANIMATION) => (
                NpcAttack::TfaXarthRange,
                projectile_target(RANGE_PROJECTILE),
            ),
            Some(MELEE_ANIMATION) => (
                NpcAttack::TfaXarthMelee,
                match &raw.target {
                    Some(RawActor::Player(name)) => {
                        PartyIndex::resolve(party, name).map(Actor::Player)
                    }
                    _ => None,
                },
            ),
            Some(BIND_ANIMATION) => (NpcAttack::TfaXarthBind, None),
            _ => {
                if raw.animation_id == Some(BLAST_ANIMATION)
                    && state.raw_spot_anims.contains_key(&FULL_BLAST_SPOT_ANIM)
                {
                    (NpcAttack::TfaXarthBlast, None)
                } else if self.phase_two
                    && state
                        .raw_projectiles
                        .iter()
                        .any(|projectile| projectile.id == MAGE_PROJECTILE)
                {
                    (NpcAttack::TfaXarthCorpse, None)
                } else {
                    return;
                }
            }
        };
        self.events
            .entry(tick)
            .or_default()
            .push(EventKind::NpcAttack(NpcAttacked {
                npc: self.room_id,
                attack,
                target,
            }));
    }

    fn apply_pillars(&self, state: &mut TickState) -> bool {
        let mut changed = false;
        for pillar in self.pillars.values() {
            if let Some((_, destroyed_room_id)) = pillar.destroyed
                && destroyed_room_id != pillar.room_id
                && let Some(npc) = state.npcs.remove(&destroyed_room_id)
            {
                state.npcs.insert(pillar.room_id, npc);
                if let Some(raw) = state.raw_npcs.remove(&destroyed_room_id) {
                    state.raw_npcs.insert(pillar.room_id, raw);
                }
                changed = true;
            }
        }
        changed
    }

    fn apply_objects(&self, state: &mut TickState) {
        for (id, kind) in [
            (FULL_BLAST_SPOT_ANIM, ObjectKind::XarthBlastFull),
            (PARTIAL_BLAST_SPOT_ANIM, ObjectKind::XarthBlastPartial),
        ] {
            state.objects.clear(kind);
            state.objects.insert(
                kind,
                Source::Client(self.ctx.client_id),
                state
                    .raw_spot_anims
                    .get(&id)
                    .into_iter()
                    .flatten()
                    .filter_map(|spot_anim| match spot_anim.placement {
                        SpotAnimPlacement::Tile(point) => Some(point),
                        SpotAnimPlacement::Actor(_) => None,
                    }),
            );
        }

        state.objects.clear(ObjectKind::XarthFire);
        state.objects.insert(
            ObjectKind::XarthFire,
            Source::Client(self.ctx.client_id),
            state
                .raw_objects
                .get(FIRE_OBJECT)
                .into_iter()
                .flatten()
                .copied(),
        );
    }
}

impl Interpreter for XarthInterpreter<'_> {
    fn decide(&mut self, recording: &Recording) {
        for (tick, state) in recording.states() {
            self.varbits.decide(tick, state);

            for pillar in self.pillars.values_mut() {
                pillar.absent_since.get_or_insert(tick);
            }

            for (&room_id, npc) in &state.npcs {
                if !npc::is_xarth_pillar(npc.id) {
                    continue;
                }
                let pillar = self.pillars.entry(npc.position.point).or_insert(Pillar {
                    room_id,
                    destroyed: None,
                    absent_since: None,
                });
                if npc.id == npc::id::XARTH_PILLAR_BREAKING && pillar.destroyed.is_none() {
                    pillar.destroyed = Some((tick, room_id));
                }
                pillar.absent_since = None;
            }
            self.phase_two |= self
                .pillars
                .values()
                .all(|pillar| pillar.absent_since.is_some());

            self.decide_attacks(tick, state, recording.party());
        }

        for (&point, pillar) in &self.pillars {
            let Some((destroyed, _)) = pillar.destroyed else {
                continue;
            };
            self.events
                .entry(destroyed)
                .or_default()
                .push(EventKind::NpcDying(pillar.room_id));
            if let Some(death) = pillar.absent_since {
                self.events
                    .entry(death)
                    .or_default()
                    .push(EventKind::NpcDeath(NpcDeath {
                        position: point,
                        npc: pillar.room_id,
                        npc_id: Some(npc::id::XARTH_PILLAR_BREAKING),
                    }));
            }
        }
    }

    fn apply(mut self, recording: &mut Recording) -> Option<Tick> {
        for pillar in self.pillars.values() {
            if let Some((_, destroyed_room_id)) = pillar.destroyed
                && destroyed_room_id != pillar.room_id
            {
                recording.map_room_id(destroyed_room_id, pillar.room_id);
            }
        }

        let mut changed = None;
        for (tick, state) in recording.states_mut() {
            if self.apply_pillars(state) && changed.is_none() {
                changed = Some(tick);
            }
            self.apply_objects(state);

            let is_pillar = |room_id: &RoomId| {
                self.pillars
                    .values()
                    .any(|pillar| pillar.room_id == *room_id)
            };
            let removed = state
                .events
                .extract_if(.., |event| match &event.kind {
                    EventKind::NpcAttack(attack) => attack.npc == self.room_id,
                    EventKind::NpcDying(room_id) => is_pillar(room_id),
                    EventKind::NpcDeath(death) => is_pillar(&death.npc),
                    _ => false,
                })
                .collect::<Vec<_>>();
            let added = self
                .events
                .remove(&tick)
                .into_iter()
                .flatten()
                .map(|kind| Event::recorded(self.ctx.client_id, kind))
                .collect::<Vec<_>>();
            if changed.is_none() && removed != added {
                changed = Some(tick);
            }
            state.events.extend(added);

            let Some(hitpoints) = self.varbits.hitpoints(tick, &state.vars) else {
                continue;
            };
            let Some(xarth) = state.npcs.get_mut(&self.room_id) else {
                continue;
            };
            if changed.is_none() && xarth.hitpoints != hitpoints {
                changed = Some(tick);
            }
            xarth.hitpoints = hitpoints;
        }
        changed
    }
}

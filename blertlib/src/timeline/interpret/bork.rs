use std::cmp::Reverse;
use std::collections::BTreeMap;

use crate::actor::{Actor, NpcProperties, PartyIndex, RoomId, Rsn};
use crate::event::{BorkBomb, BorkCannonAuto, BorkSpeed, Event, EventKind, NpcAttacked};
use crate::objects::ObjectKind;
use crate::proto::event::object_update;
use crate::tick::{Tick, Ticks};
use crate::timeline::{ConfigVersion, RawActor};
use crate::{NpcAttack, Recording, SkillLevel, Source, TickState, npc};

use super::{
    HitpointsVarbits, InterpretContext, Interpreter, ObjectDef, RawNpc, SPOT_ANIMS_PLUGIN_VERSION,
    SpotAnimPlacement,
};

const BORK_HITPOINTS_VARBIT: u32 = 6099;
const BORK_MAX_HITPOINTS_VARBIT: u32 = 6100;
const SMORKS_HITPOINTS_VARBIT: u32 = 16570;
const SMORKS_MAX_HITPOINTS_VARBIT: u32 = 16571;

const BORK_MELEE_ANIMATION: u32 = 14542;
const BORK_STOMP_ANIMATION: u32 = 14550;
const BORK_STOMP_CYCLE_ANIMATION: u32 = 14551;
const SMORKS_CANNON_ANIMATION: u32 = 14554;
const SMORKS_BIG_CANNON_ANIMATION: u32 = 14555;

const SMORKS_RANGE_PROJECTILE: u32 = 4056;
const SMORKS_MAGE_PROJECTILE: u32 = 4057;
const SMORKS_NAPALM_PROJECTILE: u32 = 4045;
const SMORKS_CANNONBALL_PROJECTILE: u32 = 4440;

const DUST_SPOT_ANIM: u32 = 4395;
const DUST_CONFIG_VERSION: ConfigVersion = ConfigVersion(8);

const NAPALM_OBJECT: ObjectDef = ObjectDef(object_update::Type::Game, 62544);

const SPEEDUPS: [(BorkSpeed, u32, &str, &str); 3] = [
    (
        BorkSpeed::BorkFastest,
        26,
        "Smorks go fastest!",
        "Bork maximum crush!",
    ),
    (
        BorkSpeed::BorkFaster,
        51,
        "Smorks feeling drum beat now!",
        "Bork make fast drum!",
    ),
    (
        BorkSpeed::BorkFast,
        76,
        "Smorks go faster!",
        "Bork get into it!",
    ),
];

fn speed_for_hitpoints(hitpoints: SkillLevel) -> BorkSpeed {
    for (speed, threshold, _, _) in &SPEEDUPS {
        if u32::from(hitpoints.current) * 100 < u32::from(hitpoints.base) * threshold {
            return *speed;
        }
    }
    BorkSpeed::BorkRegular
}

pub(super) struct BorkInterpreter<'a> {
    ctx: &'a InterpretContext,
    bork: Option<HitpointsVarbits>,
    smorks: Option<HitpointsVarbits>,
    events: BTreeMap<Tick, Vec<EventKind>>,
    speeds: BTreeMap<Tick, BorkSpeed>,
}

impl<'a> BorkInterpreter<'a> {
    pub(super) fn new(ctx: &'a InterpretContext, recording: &Recording) -> Option<Self> {
        let find = |id: u32| {
            recording.states().find_map(|(_, state)| {
                state
                    .npcs
                    .iter()
                    .find_map(|(&room_id, npc)| (npc.id == id).then_some(room_id))
            })
        };
        let bork = find(npc::id::BORK).map(|room_id| {
            HitpointsVarbits::new(room_id, BORK_HITPOINTS_VARBIT, BORK_MAX_HITPOINTS_VARBIT)
        });
        let smorks = find(npc::id::THE_SMORKS).map(|room_id| {
            HitpointsVarbits::new(
                room_id,
                SMORKS_HITPOINTS_VARBIT,
                SMORKS_MAX_HITPOINTS_VARBIT,
            )
        });
        if bork.is_none() && smorks.is_none() {
            return None;
        }

        Some(Self {
            ctx,
            bork,
            smorks,
            events: BTreeMap::new(),
            speeds: BTreeMap::new(),
        })
    }

    fn is_stomp(&self, tick: Tick, raw: &RawNpc, next_state: Option<&TickState>) -> bool {
        if !matches!(
            raw.animation_id,
            Some(BORK_STOMP_ANIMATION | BORK_STOMP_CYCLE_ANIMATION)
        ) {
            return false;
        }
        if self
            .bork
            .as_ref()
            .is_some_and(|bork| bork.death_tick == Some(tick + Ticks(1)))
        {
            return false;
        }
        if self.ctx.plugin_version >= SPOT_ANIMS_PLUGIN_VERSION
            && self.ctx.config_version >= DUST_CONFIG_VERSION
            && let Some(next_state) = next_state
        {
            next_state.raw_spot_anims.contains_key(&DUST_SPOT_ANIM)
        } else {
            matches!(tick - raw.animation_start_tick, Ticks(0 | 3))
        }
    }

    fn decide_bork_attacks(
        &mut self,
        tick: Tick,
        state: &TickState,
        next_state: Option<&TickState>,
        party: &[Rsn],
    ) {
        if let Some(bork) = &self.bork
            && let Some(raw) = state.raw_npcs.get(&bork.room_id)
        {
            if raw.animation(tick) == Some(BORK_MELEE_ANIMATION) {
                self.events
                    .entry(tick)
                    .or_default()
                    .push(EventKind::NpcAttack(NpcAttacked {
                        npc: bork.room_id,
                        attack: NpcAttack::TfaBorkMelee,
                        target: match &raw.target {
                            Some(RawActor::Player(name)) => {
                                PartyIndex::resolve(party, name).map(Actor::Player)
                            }
                            _ => None,
                        },
                    }));
            } else if self.is_stomp(tick, raw, next_state) {
                self.events
                    .entry(tick)
                    .or_default()
                    .push(EventKind::NpcAttack(NpcAttacked {
                        npc: bork.room_id,
                        attack: NpcAttack::TfaBorkStomp,
                        target: None,
                    }));
            }
        }
    }

    fn decide_smorks_attacks(&mut self, tick: Tick, state: &TickState, party: &[Rsn]) {
        if let Some(smorks) = &self.smorks
            && let Some(raw) = state.raw_npcs.get(&smorks.room_id)
        {
            let mut projectiles = state
                .raw_projectiles
                .iter()
                .filter_map(|projectile| {
                    let attack = match projectile.id {
                        SMORKS_RANGE_PROJECTILE => NpcAttack::TfaSmorksRange,
                        SMORKS_MAGE_PROJECTILE => NpcAttack::TfaSmorksMage,
                        SMORKS_NAPALM_PROJECTILE => NpcAttack::TfaSmorksNapalm,
                        _ => return None,
                    };
                    Some((attack, projectile))
                })
                .collect::<Vec<_>>();
            projectiles.sort_by_key(|(_, projectile)| Reverse(projectile.landing_tick));
            let attack_projectiles = projectiles
                .iter()
                .take_while(|(_, projectile)| {
                    projectile.landing_tick == projectiles[0].1.landing_tick
                })
                .collect::<Vec<_>>();

            let attack = if raw.animation(tick) == Some(SMORKS_BIG_CANNON_ANIMATION) {
                NpcAttack::TfaSmorksCannonball
            } else if raw.animation_id == Some(SMORKS_CANNON_ANIMATION)
                && let Some(&&(attack, _)) = attack_projectiles.first()
            {
                attack
            } else {
                return;
            };

            let events = self.events.entry(tick).or_default();
            events.push(EventKind::NpcAttack(NpcAttacked {
                npc: smorks.room_id,
                attack,
                target: match (attack, &raw.target) {
                    (NpcAttack::TfaSmorksNapalm, Some(RawActor::Player(name))) => {
                        PartyIndex::resolve(party, name).map(Actor::Player)
                    }
                    _ => None,
                },
            }));

            match attack {
                NpcAttack::TfaSmorksRange | NpcAttack::TfaSmorksMage => {
                    let targets = attack_projectiles
                        .iter()
                        .filter_map(|(_, projectile)| match &projectile.target {
                            Some(RawActor::Player(name)) => PartyIndex::resolve(party, name),
                            Some(RawActor::Npc(_)) | None => None,
                        })
                        .collect::<Vec<_>>();
                    if let Some((_, projectile)) = attack_projectiles.first()
                        && !targets.is_empty()
                    {
                        events.push(EventKind::BorkCannonAuto(BorkCannonAuto {
                            targets,
                            landing_tick: projectile.landing_tick,
                        }));
                    }
                }
                NpcAttack::TfaSmorksCannonball => {
                    if let Some(projectile) = state
                        .raw_projectiles
                        .iter()
                        .find(|projectile| projectile.id == SMORKS_CANNONBALL_PROJECTILE)
                    {
                        events.push(EventKind::BorkBomb(BorkBomb {
                            target: projectile.target_coords,
                            landing_tick: projectile.landing_tick,
                        }));
                    }
                }
                _ => {}
            }
        }
    }

    fn decide_speed(&mut self, tick: Tick, state: &TickState) {
        let (Some(bork), Some(smorks)) = (&self.bork, &self.smorks) else {
            return;
        };
        // If Bork is no longer alive, the Smorks are enraged.
        if !state.npcs.contains_key(&bork.room_id) {
            return;
        }
        let Some(hitpoints) = smorks.hitpoints(tick, &state.vars) else {
            return;
        };

        let Some(&current_speed) = self.speeds.values().max() else {
            self.speeds.insert(tick, speed_for_hitpoints(hitpoints));
            return;
        };

        let has_overhead_text = |room_id: RoomId, text: &str| {
            state
                .raw_npcs
                .get(&room_id)
                .is_some_and(|raw| raw.overhead_text.as_deref() == Some(text))
        };
        for &(speed, threshold, smorks_quote, bork_quote) in SPEEDUPS.iter().rev() {
            if speed <= current_speed
                || u32::from(hitpoints.current) * 100 >= u32::from(hitpoints.base) * threshold
            {
                continue;
            }
            let speedup_tick = if has_overhead_text(smorks.room_id, smorks_quote)
                || has_overhead_text(bork.room_id, bork_quote)
            {
                tick
            } else {
                tick + Ticks(1)
            };
            self.speeds.insert(speedup_tick, speed);
        }
    }

    fn apply_hitpoints(varbits: &HitpointsVarbits, tick: Tick, state: &mut TickState) -> bool {
        let Some(hitpoints) = varbits.hitpoints(tick, &state.vars) else {
            return false;
        };
        let Some(npc) = state.npcs.get_mut(&varbits.room_id) else {
            return false;
        };
        let changed = npc.hitpoints != hitpoints;
        npc.hitpoints = hitpoints;
        changed
    }

    fn apply_speed(&self, tick: Tick, state: &mut TickState) -> bool {
        let speed = self.speeds.range(..=tick).map(|(_, speed)| *speed).max();

        let mut changed = false;
        let mut bork_alive = false;
        if let Some(bork) = &self.bork
            && let Some(npc) = state.npcs.get_mut(&bork.room_id)
        {
            bork_alive = true;
            let properties = speed.map(NpcProperties::Bork);
            changed |= npc.properties != properties;
            npc.properties = properties;
        }
        if let Some(smorks) = &self.smorks
            && let Some(npc) = state.npcs.get_mut(&smorks.room_id)
        {
            let properties = if bork_alive {
                speed.map(NpcProperties::Smorks)
            } else {
                Some(NpcProperties::Smorks(BorkSpeed::BorkEnrage))
            };
            changed |= npc.properties != properties;
            npc.properties = properties;
        }
        changed
    }

    fn apply_objects(&self, state: &mut TickState) {
        state.objects.clear(ObjectKind::BorkDust);
        state.objects.insert(
            ObjectKind::BorkDust,
            Source::Client(self.ctx.client_id),
            state
                .raw_spot_anims
                .get(&DUST_SPOT_ANIM)
                .into_iter()
                .flatten()
                .filter_map(|spot_anim| match spot_anim.placement {
                    SpotAnimPlacement::Tile(point) => Some(point),
                    SpotAnimPlacement::Actor(_) => None,
                }),
        );

        state.objects.clear(ObjectKind::BorkNapalm);
        state.objects.insert(
            ObjectKind::BorkNapalm,
            Source::Client(self.ctx.client_id),
            state
                .raw_objects
                .get(NAPALM_OBJECT)
                .into_iter()
                .flatten()
                .copied(),
        );
    }
}

impl Interpreter for BorkInterpreter<'_> {
    fn decide(&mut self, recording: &Recording) {
        for (tick, state) in recording.states() {
            if let Some(bork) = &mut self.bork {
                bork.decide(tick, state);
            }
            if let Some(smorks) = &mut self.smorks {
                smorks.decide(tick, state);
            }
        }
        for (tick, state) in recording.states() {
            let next_state = recording.get_state(tick + Ticks(1));
            self.decide_bork_attacks(tick, state, next_state, recording.party());
            self.decide_smorks_attacks(tick, state, recording.party());
            self.decide_speed(tick, state);
        }
    }

    fn apply(mut self, recording: &mut Recording) -> Option<Tick> {
        let mut changed = None;
        for (tick, state) in recording.states_mut() {
            if let Some(bork) = &self.bork
                && Self::apply_hitpoints(bork, tick, state)
            {
                changed.get_or_insert(tick);
            }
            if let Some(smorks) = &self.smorks
                && Self::apply_hitpoints(smorks, tick, state)
            {
                changed.get_or_insert(tick);
            }
            if self.apply_speed(tick, state) {
                changed.get_or_insert(tick);
            }
            self.apply_objects(state);

            let removed = state
                .events
                .extract_if(.., |event| match &event.kind {
                    EventKind::NpcAttack(attack) => {
                        self.bork
                            .as_ref()
                            .is_some_and(|bork| bork.room_id == attack.npc)
                            || self
                                .smorks
                                .as_ref()
                                .is_some_and(|smorks| smorks.room_id == attack.npc)
                    }
                    EventKind::BorkCannonAuto(_) | EventKind::BorkBomb(_) => true,
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
            if removed != added {
                changed.get_or_insert(tick);
            }
            state.events.extend(added);
        }
        changed
    }
}

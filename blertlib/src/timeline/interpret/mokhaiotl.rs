use std::collections::BTreeMap;

use crate::proto::event::object_update;
use crate::skill::SkillLevel;
use crate::tick::{Tick, Ticks};
use crate::{
    Actor, CombatStyle, Event, EventKind, Mokhaiotl, MokhaiotlOrb, MokhaiotlOrbSource, NpcAttack,
    NpcAttacked, NpcProperties, ObjectKind, PartyIndex, PluginVersion, RawActor, Recording, RoomId,
    Source, TickState, npc,
};

use super::{HitpointsVarbits, InterpretContext, Interpreter, ObjectDef};

pub(super) const MIN_SUPPORTED_VERSION: PluginVersion = PluginVersion::new(0, 10, 0);
pub(super) const GENERIC_VERSION: PluginVersion = PluginVersion::new(0, 10, 6);

const HITPOINTS_VARBIT: u32 = 6099;
const MAX_HITPOINTS_VARBIT: u32 = 6100;

const AUTO_ANIMATION: u32 = 12406;
const BALL_ANIMATION: u32 = 12407;
const CHARGE_ANIMATION: u32 = 12409;
const BLAST_ANIMATION: u32 = 12411;
const MELEE_ANIMATION: u32 = 12416;
const RACECAR_ANIMATION: u32 = 12417;
const EMERGE_ANIMATION: u32 = 12418;
const DEATH_ANIMATION: u32 = 12422;

const ORB_PROJECTILES: [(u32, CombatStyle); 3] = [
    (3378, CombatStyle::Melee),
    (3379, CombatStyle::Magic),
    (3380, CombatStyle::Ranged),
];
const RANGED_BALL_PROJECTILE: u32 = 3384;
const MAGE_BALL_PROJECTILE: u32 = 3385;

const RACECAR_REPEAT_WINDOW: Ticks = Ticks(5);

const ROCK: ObjectDef = ObjectDef(object_update::Type::Game, 57286);
const ACID_SPLAT: ObjectDef = ObjectDef(object_update::Type::Game, 57283);
const SHOCKWAVE: [ObjectDef; 3] = [
    ObjectDef(object_update::Type::Graphics, 3405),
    ObjectDef(object_update::Type::Graphics, 3406),
    ObjectDef(object_update::Type::Graphics, 3407),
];

const OBJECTS: [(ObjectDef, ObjectKind); 5] = [
    (ROCK, ObjectKind::MokhaiotlRock),
    (ACID_SPLAT, ObjectKind::MokhaiotlSplat),
    (SHOCKWAVE[0], ObjectKind::MokhaiotlShockwave),
    (SHOCKWAVE[1], ObjectKind::MokhaiotlShockwave),
    (SHOCKWAVE[2], ObjectKind::MokhaiotlShockwave),
];

#[derive(Debug, Clone, Copy)]
enum Phase {
    Up,
    Shielded,
    Burrowed { last_racecar: Option<Tick> },
    Emerging,
}

pub(super) struct MokhaiotlInterpreter<'a> {
    ctx: &'a InterpretContext,
    room_id: RoomId,
    varbits: HitpointsVarbits,
    events: BTreeMap<Tick, Vec<EventKind>>,
    charging: bool,
    hitpoints: Option<SkillLevel>,
}

impl<'a> MokhaiotlInterpreter<'a> {
    pub(super) fn new(ctx: &'a InterpretContext, recording: &Recording) -> Option<Self> {
        let room_id = recording.states().find_map(|(_, state)| {
            state
                .npcs
                .iter()
                .find_map(|(&room_id, npc)| npc::is_mokhaiotl(npc.id).then_some(room_id))
        })?;

        Some(Self {
            ctx,
            room_id,
            varbits: HitpointsVarbits::new(
                room_id,
                HITPOINTS_VARBIT,
                MAX_HITPOINTS_VARBIT,
                DEATH_ANIMATION,
            ),
            events: BTreeMap::new(),
            charging: false,
            hitpoints: None,
        })
    }

    fn apply_objects(&self, state: &mut TickState) {
        for &(_, kind) in &OBJECTS {
            state.objects.clear(kind);
        }
        for &(def, kind) in &OBJECTS {
            if let Some(points) = state.raw_objects.get(def) {
                state.objects.insert(
                    kind,
                    Source::Client(self.ctx.client_id),
                    points.iter().copied(),
                );
            }
        }
    }

    fn apply_events(&mut self, tick: Tick, state: &mut TickState) -> bool {
        let room_id = self.room_id;
        let removed = state
            .events
            .extract_if(.., |event| match &event.kind {
                EventKind::NpcAttack(attack) => attack.npc == room_id,
                EventKind::MokhaiotlOrb(_) => true,
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
        let changed = removed != added;
        state.events.extend(added);
        changed
    }

    fn apply_mokhaiotl(&mut self, tick: Tick, state: &mut TickState) -> bool {
        let room_id = self.room_id;
        let Some(mokhaiotl) = state.npcs.get_mut(&room_id) else {
            self.charging = false;
            return false;
        };

        let properties = match mokhaiotl.id {
            npc::id::MOKHAIOTL => {
                if let Some(attack) = state.events.iter().find_map(|event| match &event.kind {
                    EventKind::NpcAttack(attack) if attack.npc == room_id => Some(attack.attack),
                    _ => None,
                }) {
                    self.charging = attack == NpcAttack::MokhaiotlCharge;
                }
                let properties = Mokhaiotl {
                    charging: self.charging,
                    shield: None,
                };

                let meleed = state.events.iter().any(|event| {
                    matches!(
                        &event.kind,
                        EventKind::PlayerAttack(attack)
                            if attack.target == Some(Actor::Npc(room_id))
                                && attack.attack.style() == Some(CombatStyle::Melee)
                    )
                });
                if meleed {
                    self.charging = false;
                }

                self.hitpoints = self.varbits.hitpoints(tick, &state.vars).or(self.hitpoints);
                properties
            }
            npc::id::MOKHAIOTL_SHIELDED => {
                self.charging = false;
                Mokhaiotl {
                    charging: false,
                    shield: self.varbits.hitpoints(tick, &state.vars),
                }
            }
            npc::id::MOKHAIOTL_BURROWED => {
                self.charging = false;
                self.hitpoints = self.varbits.hitpoints(tick, &state.vars).or(self.hitpoints);
                Mokhaiotl {
                    charging: false,
                    shield: None,
                }
            }
            _ => {
                self.charging = false;
                return false;
            }
        };
        let properties = Some(NpcProperties::Mokhaiotl(properties));
        let mut changed = properties != mokhaiotl.properties;
        mokhaiotl.properties = properties;
        if let Some(hitpoints) = self.hitpoints {
            changed |= hitpoints != mokhaiotl.hitpoints;
            mokhaiotl.hitpoints = hitpoints;
        }
        changed
    }
}

impl Interpreter for MokhaiotlInterpreter<'_> {
    fn decide(&mut self, recording: &Recording) {
        for (tick, state) in recording.states() {
            self.varbits.decide(tick, state);
        }
        if self.ctx.plugin_version < GENERIC_VERSION {
            return;
        }

        let mut phase = Phase::Up;
        for (tick, state) in recording.states() {
            let (Some(mokhaiotl), Some(raw)) = (
                state.npcs.get(&self.room_id),
                state.raw_npcs.get(&self.room_id),
            ) else {
                continue;
            };

            phase = match (phase, mokhaiotl.id) {
                (_, npc::id::MOKHAIOTL_SHIELDED) => Phase::Shielded,
                (Phase::Shielded, npc::id::MOKHAIOTL) => Phase::Up,
                (Phase::Burrowed { .. }, npc::id::MOKHAIOTL_BURROWED) => phase,
                (_, npc::id::MOKHAIOTL_BURROWED) => Phase::Burrowed { last_racecar: None },
                _ => phase,
            };

            let animation = raw.animation.filter(|_| raw.animation_start_tick == tick);

            // When Doom performs an auto attack, its projectile is created on
            // the same tick within its body. The auto always lands after any
            // other active projectiles from boulders.
            let potential_auto_orb = state
                .raw_projectiles
                .iter()
                .filter_map(|projectile| {
                    let style = ORB_PROJECTILES
                        .iter()
                        .find_map(|&(id, style)| (id == projectile.id).then_some(style))?;
                    mokhaiotl
                        .position
                        .contains(projectile.source_coords)
                        .then_some((projectile, style))
                })
                .max_by_key(|(projectile, _)| projectile.landing_tick);

            let attack = decide_attack(
                phase,
                animation,
                tick,
                state,
                potential_auto_orb.map(|(_, style)| style),
            );

            let target = raw.target.as_ref().and_then(|target| match target {
                RawActor::Player(name) => {
                    PartyIndex::resolve(recording.party(), name).map(Actor::Player)
                }
                RawActor::Npc(room_id) => Some(Actor::Npc(RoomId(*room_id))),
            });
            self.events
                .entry(tick)
                .or_default()
                .extend(attack.map(|attack| {
                    EventKind::NpcAttack(NpcAttacked {
                        npc: self.room_id,
                        attack,
                        target,
                    })
                }));

            // Create orb events for every new orb.
            for projectile in &state.raw_projectiles {
                let Some(style) = ORB_PROJECTILES
                    .iter()
                    .find_map(|&(id, style)| (id == projectile.id).then_some(style))
                else {
                    continue;
                };

                let source = match phase {
                    Phase::Up
                        if animation == Some(AUTO_ANIMATION)
                            && potential_auto_orb
                                .is_some_and(|(orb, _)| std::ptr::eq(orb, projectile)) =>
                    {
                        MokhaiotlOrbSource::Mokhaiotl
                    }
                    Phase::Up | Phase::Shielded => MokhaiotlOrbSource::Ball,
                    Phase::Burrowed { .. } | Phase::Emerging => MokhaiotlOrbSource::Mokhaiotl,
                };
                self.events
                    .entry(projectile.landing_tick)
                    .or_default()
                    .push(EventKind::MokhaiotlOrb(MokhaiotlOrb {
                        source,
                        source_point: projectile.source_coords,
                        style,
                        spawn_tick: tick,
                        end_tick: projectile.landing_tick,
                    }));
            }

            phase = match (phase, attack) {
                _ if animation == Some(EMERGE_ANIMATION) => Phase::Emerging,
                (Phase::Burrowed { .. }, Some(NpcAttack::MokhaiotlRacecar)) => Phase::Burrowed {
                    last_racecar: Some(tick),
                },
                (Phase::Emerging, Some(_)) => Phase::Up,
                _ => phase,
            };
        }
    }

    fn apply(mut self, recording: &mut Recording) -> Option<Tick> {
        let mut changed = None;
        for (tick, state) in recording.states_mut() {
            if self.ctx.plugin_version >= MIN_SUPPORTED_VERSION {
                self.apply_objects(state);
            }
            if self.ctx.plugin_version >= GENERIC_VERSION
                && self.apply_events(tick, state)
                && changed.is_none()
            {
                changed = Some(tick);
            }
            if self.apply_mokhaiotl(tick, state) && changed.is_none() {
                changed = Some(tick);
            }
        }
        changed
    }
}

fn decide_attack(
    phase: Phase,
    animation: Option<u32>,
    tick: Tick,
    state: &TickState,
    auto_orb_style: Option<CombatStyle>,
) -> Option<NpcAttack> {
    let has_shockwave = SHOCKWAVE
        .iter()
        .any(|&def| state.raw_objects.get(def).is_some());

    match (phase, animation) {
        (Phase::Up, Some(AUTO_ANIMATION)) => auto_orb_style.map(|style| match style {
            CombatStyle::Melee => NpcAttack::MokhaiotlMeleeAuto,
            CombatStyle::Ranged => NpcAttack::MokhaiotlRangedAuto,
            CombatStyle::Magic => NpcAttack::MokhaiotlMageAuto,
        }),
        (Phase::Up, Some(BALL_ANIMATION)) => {
            state
                .raw_projectiles
                .iter()
                .find_map(|projectile| match projectile.id {
                    RANGED_BALL_PROJECTILE => Some(NpcAttack::MokhaiotlRangedBall),
                    MAGE_BALL_PROJECTILE => Some(NpcAttack::MokhaiotlMageBall),
                    _ => None,
                })
        }
        (Phase::Up | Phase::Shielded, Some(CHARGE_ANIMATION)) => Some(NpcAttack::MokhaiotlCharge),
        (Phase::Up, Some(BLAST_ANIMATION)) => Some(NpcAttack::MokhaiotlBlast),
        (Phase::Up, Some(MELEE_ANIMATION)) => Some(NpcAttack::MokhaiotlMelee),
        (Phase::Up, _) if has_shockwave => Some(NpcAttack::MokhaiotlShockwave),
        (Phase::Burrowed { last_racecar }, Some(RACECAR_ANIMATION))
            if last_racecar.is_none_or(|last| tick - last >= RACECAR_REPEAT_WINDOW) =>
        {
            Some(NpcAttack::MokhaiotlRacecar)
        }
        (Phase::Burrowed { .. }, _) if has_shockwave => Some(NpcAttack::MokhaiotlSlam),

        // Doom either autos or throws a ball immediately after emerging
        // from burrowed, without an animation.
        (Phase::Emerging, _) => auto_orb_style
            .map(|style| match style {
                CombatStyle::Melee => NpcAttack::MokhaiotlMeleeAuto,
                CombatStyle::Ranged => NpcAttack::MokhaiotlRangedAuto,
                CombatStyle::Magic => NpcAttack::MokhaiotlMageAuto,
            })
            .or_else(|| {
                state
                    .raw_projectiles
                    .iter()
                    .find_map(|projectile| match projectile.id {
                        RANGED_BALL_PROJECTILE => Some(NpcAttack::MokhaiotlRangedBall),
                        MAGE_BALL_PROJECTILE => Some(NpcAttack::MokhaiotlMageBall),
                        _ => None,
                    })
            }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::timeline::interpret::{RawObjects, Vars};
    use crate::{
        ChallengeMode, ClientId, ConfigVersion, Event, Item, NpcAttacked, NpcState, PartyIndex,
        PlayerAttack, PlayerAttacked, Players, Point, PrayerBook, PrayerSet, Rect, RoomId, Rsn,
        SkillLevel, Stage, TickObjects, item,
    };

    #[test]
    fn interpret_mokhaiotl_charge_until_melee_hit() {
        let ctx = InterpretContext {
            client_id: ClientId(31),
            plugin_version: PluginVersion::new(0, 10, 2),
            config_version: ConfigVersion::LATEST,
        };
        let doom = |events: Vec<Event>| TickState {
            players: Players::empty(1),
            npcs: BTreeMap::from([(
                RoomId(47491),
                NpcState {
                    source: Source::Client(ClientId(31)),
                    id: npc::id::MOKHAIOTL,
                    position: Rect::square(Point(3421, 6435), 5),
                    hitpoints: SkillLevel::from_raw(29_557_336),
                    prayers: PrayerSet::empty(PrayerBook::Normal),
                    properties: None,
                },
            )]),
            objects: TickObjects::default(),
            raw_objects: RawObjects::default(),
            raw_npcs: BTreeMap::new(),
            raw_projectiles: Vec::new(),
            vars: Vars::default(),
            events,
        };

        let mut recording = Recording::vacant(
            Stage::MokhaiotlDelve4,
            ChallengeMode::NoMode,
            vec![Rsn::try_from("1Ogp").unwrap()],
            Tick(24),
        );
        recording.set_state(Tick(20), doom(Vec::new()));
        recording.set_state(
            Tick(21),
            doom(vec![Event::recorded(
                ClientId(31),
                EventKind::NpcAttack(NpcAttacked {
                    npc: RoomId(47491),
                    attack: NpcAttack::MokhaiotlCharge,
                    target: None,
                }),
            )]),
        );
        recording.set_state(Tick(22), doom(Vec::new()));
        recording.set_state(
            Tick(23),
            doom(vec![Event::recorded(
                ClientId(31),
                EventKind::PlayerAttack(PlayerAttacked {
                    player: PartyIndex::from_usize(0),
                    attack: PlayerAttack::NoxiousHalberd,
                    weapon: Some(Item {
                        id: item::id::NOXIOUS_HALBERD,
                        quantity: 1,
                    }),
                    target: Some(Actor::Npc(RoomId(47491))),
                }),
            )]),
        );
        recording.set_state(Tick(24), doom(Vec::new()));

        assert_eq!(
            MokhaiotlInterpreter::new(&ctx, &recording)
                .unwrap()
                .interpret(&mut recording),
            Some(Tick(20))
        );
        assert_eq!(
            recording
                .states()
                .map(|(tick, state)| (tick, state.npcs[&RoomId(47491)].properties.clone()))
                .collect::<Vec<_>>(),
            [
                (
                    Tick(20),
                    Some(NpcProperties::Mokhaiotl(Mokhaiotl {
                        charging: false,
                        shield: None,
                    }))
                ),
                (
                    Tick(21),
                    Some(NpcProperties::Mokhaiotl(Mokhaiotl {
                        charging: true,
                        shield: None,
                    }))
                ),
                (
                    Tick(22),
                    Some(NpcProperties::Mokhaiotl(Mokhaiotl {
                        charging: true,
                        shield: None,
                    }))
                ),
                (
                    Tick(23),
                    Some(NpcProperties::Mokhaiotl(Mokhaiotl {
                        charging: true,
                        shield: None,
                    }))
                ),
                (
                    Tick(24),
                    Some(NpcProperties::Mokhaiotl(Mokhaiotl {
                        charging: false,
                        shield: None,
                    }))
                ),
            ]
        );
    }

    #[test]
    fn interpret_mokhaiotl_reports_earlier_shield_change() {
        let ctx = InterpretContext {
            client_id: ClientId(31),
            plugin_version: PluginVersion::new(0, 10, 2),
            config_version: ConfigVersion::LATEST,
        };
        let doom = |varbits: BTreeMap<u32, i32>| TickState {
            players: Players::empty(1),
            npcs: BTreeMap::from([(
                RoomId(47491),
                NpcState {
                    source: Source::Client(ClientId(31)),
                    id: npc::id::MOKHAIOTL_SHIELDED,
                    position: Rect::square(Point(3421, 6435), 5),
                    hitpoints: SkillLevel::from_raw(32_768_500),
                    prayers: PrayerSet::empty(PrayerBook::Normal),
                    properties: None,
                },
            )]),
            objects: TickObjects::default(),
            raw_objects: RawObjects::default(),
            raw_npcs: BTreeMap::new(),
            raw_projectiles: Vec::new(),
            vars: Vars {
                varbits,
                varps: BTreeMap::new(),
            },
            events: Vec::new(),
        };

        let mut recording = Recording::vacant(
            Stage::MokhaiotlDelve8,
            ChallengeMode::NoMode,
            vec![Rsn::try_from("1Ogp").unwrap()],
            Tick(1),
        );
        recording.set_state(Tick(0), doom(BTreeMap::new()));
        assert_eq!(
            MokhaiotlInterpreter::new(&ctx, &recording)
                .unwrap()
                .interpret(&mut recording),
            Some(Tick(0))
        );

        recording.set_state(
            Tick(1),
            doom(BTreeMap::from([
                (HITPOINTS_VARBIT, 500),
                (MAX_HITPOINTS_VARBIT, 500),
            ])),
        );
        assert_eq!(
            MokhaiotlInterpreter::new(&ctx, &recording)
                .unwrap()
                .interpret(&mut recording),
            Some(Tick(0))
        );
        assert_eq!(
            recording
                .states()
                .map(|(tick, state)| (tick, state.npcs[&RoomId(47491)].properties.clone()))
                .collect::<Vec<_>>(),
            [
                (
                    Tick(0),
                    Some(NpcProperties::Mokhaiotl(Mokhaiotl {
                        charging: false,
                        shield: Some(SkillLevel::from_raw(32_768_500)),
                    }))
                ),
                (
                    Tick(1),
                    Some(NpcProperties::Mokhaiotl(Mokhaiotl {
                        charging: false,
                        shield: Some(SkillLevel::from_raw(32_768_500)),
                    }))
                ),
            ]
        );
    }
}

use crate::proto::event::object_update;
use crate::skill::SkillLevel;
use crate::tick::Tick;
use crate::{
    Actor, CombatStyle, EventKind, Mokhaiotl, NpcAttack, NpcProperties, ObjectKind, PluginVersion,
    Recording, RoomId, Source, TickState, npc,
};

use super::{HitpointsVarbits, InterpretContext, Interpreter, ObjectDef};

pub(super) const MIN_SUPPORTED_VERSION: PluginVersion = PluginVersion::new(0, 10, 0);

const HITPOINTS_VARBIT: u32 = 6099;
const MAX_HITPOINTS_VARBIT: u32 = 6100;
const DEATH_ANIMATION: u32 = 12422;

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

pub(super) struct MokhaiotlInterpreter<'a> {
    ctx: &'a InterpretContext,
    room_id: RoomId,
    varbits: HitpointsVarbits,
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
    }

    fn apply(mut self, recording: &mut Recording) -> Option<Tick> {
        let mut changed = None;
        for (tick, state) in recording.states_mut() {
            if self.ctx.plugin_version >= MIN_SUPPORTED_VERSION {
                self.apply_objects(state);
            }
            if self.apply_mokhaiotl(tick, state) && changed.is_none() {
                changed = Some(tick);
            }
        }
        changed
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

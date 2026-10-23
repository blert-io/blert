use crate::proto::event::object_update;
use crate::tick::Tick;
use crate::{
    Actor, CombatStyle, EventKind, Mokhaiotl, NpcAttack, NpcProperties, ObjectKind, PluginVersion,
    Recording, Source, TickState, npc,
};

use super::{InterpretContext, Interpreter, ObjectDef};

pub(super) const MIN_SUPPORTED_VERSION: PluginVersion = PluginVersion::new(0, 10, 0);

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
    charging: bool,
}

impl<'a> MokhaiotlInterpreter<'a> {
    pub(super) fn new(ctx: &'a InterpretContext) -> Self {
        Self {
            ctx,
            charging: false,
        }
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

    fn apply_charge(&mut self, state: &mut TickState) {
        let Some((&room_id, mokhaiotl)) = state
            .npcs
            .iter_mut()
            .find(|(_, npc)| npc.id == npc::id::MOKHAIOTL)
        else {
            self.charging = false;
            return;
        };

        if let Some(attack) = state.events.iter().find_map(|event| match &event.kind {
            EventKind::NpcAttack(attack) if attack.npc == room_id => Some(attack.attack),
            _ => None,
        }) {
            self.charging = attack == NpcAttack::MokhaiotlCharge;
        }
        mokhaiotl.properties = Some(NpcProperties::Mokhaiotl(Mokhaiotl {
            charging: self.charging,
        }));

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
    }
}

impl Interpreter for MokhaiotlInterpreter<'_> {
    fn apply(mut self, recording: &mut Recording) -> Option<Tick> {
        for (_, state) in recording.states_mut() {
            if self.ctx.plugin_version >= MIN_SUPPORTED_VERSION {
                self.apply_objects(state);
            }
            self.apply_charge(state);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::timeline::interpret::RawObjects;
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
            MokhaiotlInterpreter::new(&ctx).interpret(&mut recording),
            None
        );
        assert_eq!(
            recording
                .states()
                .map(|(tick, state)| (tick, state.npcs[&RoomId(47491)].properties.clone()))
                .collect::<Vec<_>>(),
            [
                (
                    Tick(20),
                    Some(NpcProperties::Mokhaiotl(Mokhaiotl { charging: false }))
                ),
                (
                    Tick(21),
                    Some(NpcProperties::Mokhaiotl(Mokhaiotl { charging: true }))
                ),
                (
                    Tick(22),
                    Some(NpcProperties::Mokhaiotl(Mokhaiotl { charging: true }))
                ),
                (
                    Tick(23),
                    Some(NpcProperties::Mokhaiotl(Mokhaiotl { charging: true }))
                ),
                (
                    Tick(24),
                    Some(NpcProperties::Mokhaiotl(Mokhaiotl { charging: false }))
                ),
            ]
        );
    }
}

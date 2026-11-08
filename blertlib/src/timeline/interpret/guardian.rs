use std::collections::BTreeMap;

use crate::actor::{Guardian, GuardianBrazier, GuardianBrazierPosition};
use crate::proto::event::object_update;
use crate::tick::Tick;
use crate::{
    Actor, Event, EventKind, NpcAttack, NpcAttacked, NpcProperties, ObjectKind, PartyIndex, Point,
    RawActor, Recording, RoomId, Source, npc,
};

use super::{HitpointsVarbits, InterpretContext, Interpreter, ObjectDef};

const HITPOINTS_VARBIT: u32 = 6099;
const MAX_HITPOINTS_VARBIT: u32 = 6100;

const LEAP_ANIMATION: u32 = 14750;
const AUTO_ANIMATION: u32 = 14751;
const MELEE_ANIMATION: u32 = 14752;
const SHROOMS_ANIMATION: u32 = 14753;
const BREATH_ANIMATION: u32 = 14754;
const DEATH_ANIMATION: u32 = 14749;

const ENRAGE_PERCENT: f32 = 1f32 / 3f32;

const OBJECTS: [(ObjectDef, ObjectKind); 3] = [
    (
        ObjectDef(object_update::Type::Game, 62578),
        ObjectKind::GuardianShroomSpawning,
    ),
    (
        ObjectDef(object_update::Type::Game, 62579),
        ObjectKind::GuardianShroomGrown,
    ),
    (
        ObjectDef(object_update::Type::Game, 62580),
        ObjectKind::GuardianShroomPopped,
    ),
];

const BRAZIERS: [(Point, GuardianBrazierPosition); 4] = [
    (Point(4139, 5605), GuardianBrazierPosition::Northeast),
    (Point(4139, 5592), GuardianBrazierPosition::Southeast),
    (Point(4114, 5592), GuardianBrazierPosition::Southwest),
    (Point(4114, 5605), GuardianBrazierPosition::Northwest),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Up(Tick),
    Down,
    Reshielded(Tick),
    Enraged,
}

pub(super) struct GuardianInterpreter<'a> {
    ctx: &'a InterpretContext,
    varbits: HitpointsVarbits,
    room_id: RoomId,
    enraged: Option<Tick>,
    events: BTreeMap<Tick, Vec<EventKind>>,
}

impl<'a> GuardianInterpreter<'a> {
    pub(super) fn new(ctx: &'a InterpretContext, recording: &Recording) -> Option<Self> {
        let room_id = recording.states().find_map(|(_, state)| {
            state
                .npcs
                .iter()
                .find_map(|(&room_id, npc)| npc::is_guardian(npc.id).then_some(room_id))
        })?;

        Some(Self {
            ctx,
            varbits: HitpointsVarbits::new(
                room_id,
                HITPOINTS_VARBIT,
                MAX_HITPOINTS_VARBIT,
                DEATH_ANIMATION,
            ),
            room_id,
            enraged: None,
            events: BTreeMap::new(),
        })
    }
}

impl Interpreter for GuardianInterpreter<'_> {
    fn decide(&mut self, recording: &Recording) {
        let mut phase = match recording
            .states()
            .find_map(|(_, state)| state.generic_npc(self.room_id))
        {
            Some((guardian, _)) if guardian.id == npc::id::ARCHIVE_GUARDIAN_UNSHIELDED => {
                Phase::Down
            }
            _ => Phase::Up(Tick(0)),
        };

        let mut below_33 = false;
        let mut breath_target = None;

        for (tick, state) in recording.states() {
            self.varbits.decide(tick, state);
            let Some((guardian, raw)) = state.generic_npc(self.room_id) else {
                continue;
            };

            let animation = raw.animation(tick);
            let target = raw.target.as_ref().and_then(|target| match target {
                RawActor::Player(name) => {
                    PartyIndex::resolve(recording.party(), name).map(Actor::Player)
                }
                RawActor::Npc(room_id) => Some(Actor::Npc(RoomId(*room_id))),
            });

            phase = match (phase, guardian.id) {
                (Phase::Up(up) | Phase::Reshielded(up), _)
                    if animation == Some(BREATH_ANIMATION) =>
                {
                    self.enraged = Some(up);
                    Phase::Enraged
                }
                // If the recording started late into the fight where guardian was
                // initially unshielded, it is either down or enraged. The down
                // phase doesn't do anything, so an attack must mean it's enraged.
                (Phase::Down, _)
                    if matches!(
                        animation,
                        Some(SHROOMS_ANIMATION | BREATH_ANIMATION | LEAP_ANIMATION)
                    ) =>
                {
                    self.enraged = Some(Tick(0));
                    Phase::Enraged
                }
                (Phase::Up(_) | Phase::Reshielded(_), npc::id::ARCHIVE_GUARDIAN_UNSHIELDED) => {
                    Phase::Down
                }
                (Phase::Down, npc::id::ARCHIVE_GUARDIAN_UNSHIELDED) => {
                    if let Some(hitpoints) = self.varbits.hitpoints(tick, &state.vars) {
                        below_33 = f32::from(hitpoints.current)
                            < f32::from(hitpoints.base) * ENRAGE_PERCENT;
                    }
                    Phase::Down
                }
                (Phase::Down, npc::id::ARCHIVE_GUARDIAN) if below_33 => {
                    self.enraged = Some(tick);
                    Phase::Enraged
                }
                (Phase::Down, npc::id::ARCHIVE_GUARDIAN) => Phase::Reshielded(tick),
                (Phase::Reshielded(up), _) if animation == Some(SHROOMS_ANIMATION) => {
                    self.enraged = Some(up);
                    Phase::Enraged
                }
                (Phase::Reshielded(up), _) if animation.is_some() => Phase::Up(up),
                _ => phase,
            };

            if raw.animation_id != Some(BREATH_ANIMATION) {
                breath_target = None;
            }

            let attack = match (phase, animation) {
                (Phase::Up(_), Some(AUTO_ANIMATION)) => Some((NpcAttack::TfaGuardianAuto, target)),
                (Phase::Up(_), Some(MELEE_ANIMATION)) => {
                    Some((NpcAttack::TfaGuardianMelee, target))
                }
                (Phase::Up(_) | Phase::Enraged, Some(SHROOMS_ANIMATION)) => {
                    Some((NpcAttack::TfaGuardianMushrooms, None))
                }
                (Phase::Up(_) | Phase::Enraged, Some(LEAP_ANIMATION)) => {
                    Some((NpcAttack::TfaGuardianLeap, None))
                }
                (Phase::Enraged, Some(BREATH_ANIMATION)) => {
                    breath_target = target;
                    Some((NpcAttack::TfaGuardianBreathFocus, target))
                }
                (Phase::Enraged, _) if target.is_none() && breath_target.is_some() => breath_target
                    .take()
                    .filter(|&target| state.has_actor(target))
                    .map(|target| (NpcAttack::TfaGuardianBreath, Some(target))),
                _ => None,
            };
            if let Some((attack, target)) = attack {
                self.events
                    .entry(tick)
                    .or_default()
                    .push(EventKind::NpcAttack(NpcAttacked {
                        npc: self.room_id,
                        attack,
                        target,
                    }));
            }
        }
    }

    fn apply(mut self, recording: &mut Recording) -> Option<Tick> {
        let mut changed = None;
        let mut hitpoints = None;
        for (tick, state) in recording.states_mut() {
            let removed = state
                .events
                .extract_if(.., |event| {
                    matches!(
                        &event.kind,
                        EventKind::NpcAttack(attack) if attack.npc == self.room_id
                    )
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

            for brazier in state
                .npcs
                .values_mut()
                .filter(|npc| npc::is_guardian_brazier(npc.id))
            {
                if let Some(&(_, position)) = BRAZIERS
                    .iter()
                    .find(|&&(point, _)| point == brazier.position.point)
                {
                    brazier.properties =
                        Some(NpcProperties::GuardianBrazier(GuardianBrazier { position }));
                }
            }

            let Some(guardian) = state.npcs.get_mut(&self.room_id) else {
                continue;
            };
            let shield = match guardian.id {
                npc::id::ARCHIVE_GUARDIAN => self.varbits.hitpoints(tick, &state.vars),
                npc::id::ARCHIVE_GUARDIAN_UNSHIELDED => {
                    hitpoints = self.varbits.hitpoints(tick, &state.vars);
                    None
                }
                _ => continue,
            };
            let properties = Some(NpcProperties::Guardian(Guardian {
                enraged: self.enraged.is_some_and(|enraged| tick >= enraged),
                shield,
            }));
            if changed.is_none() && properties != guardian.properties {
                changed = Some(tick);
            }
            guardian.properties = properties;
            if let Some(hitpoints) = hitpoints {
                guardian.hitpoints = hitpoints;
            }
        }
        changed
    }
}

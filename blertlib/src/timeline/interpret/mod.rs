//! Interpreters to convert raw game signals into structured events.

mod bloat;
mod colosseum;
mod maiden;
mod mokhaiotl;
mod ocellus;
mod player_attack;
mod sotetseg;
mod verzik;

use std::collections::{BTreeMap, BTreeSet};

use bloat::BloatInterpreter;
use colosseum::ColosseumInterpreter;
use maiden::MaidenInterpreter;
use mokhaiotl::MokhaiotlInterpreter;
use ocellus::OcellusInterpreter;
use player_attack::PlayerAttackInterpreter;
use sotetseg::SotetsegInterpreter;
use verzik::VerzikInterpreter;

pub(crate) use ocellus::OcellusProperties;

use crate::event::{Event, EventKind, NpcDeath};
use crate::objects::ObjectKind;
use crate::proto::event::object_update;
use crate::skill::SkillLevel;
use crate::timeline::{BuildMismatch, BuildWarning, ConfigVersion, RawActor, Recording, TickState};
use crate::{
    AncientCurse, ClientId, PluginVersion, Point, Prayer, RoomId, Stage, StandardPrayer, Tick, npc,
    proto,
};

const GENERIC_DEATHS: [(PluginVersion, &[u32]); 2] = [
    (
        bloat::MIN_SUPPORTED_VERSION,
        &[
            npc::id::BLOAT_ENTRY,
            npc::id::BLOAT_REGULAR,
            npc::id::BLOAT_HARD,
        ],
    ),
    (
        mokhaiotl::GENERIC_VERSION,
        &[
            npc::id::MOKHAIOTL,
            npc::id::MOKHAIOTL_SHIELDED,
            npc::id::MOKHAIOTL_BURROWED,
            npc::id::DEMONIC_LARVA,
            npc::id::DEMONIC_RANGE_LARVA,
            npc::id::DEMONIC_MAGIC_LARVA,
            npc::id::DEMONIC_MELEE_LARVA,
            npc::id::VOLATILE_EARTH,
            npc::id::EARTHEN_SHIELD,
            npc::id::GIANT_DEMONIC_RANGE_LARVA,
            npc::id::GIANT_DEMONIC_MAGIC_LARVA,
        ],
    ),
];

const HEADICONS_PRAYER: u16 = 440;

struct InterpretContext {
    client_id: ClientId,
    plugin_version: PluginVersion,
    #[expect(dead_code)]
    config_version: ConfigVersion,
}

/// An `Interpreter` is responsible for converting raw signals recorded by a
/// plugin into events. Interpreters run in two phases: `decide` performs the
/// interpretation without modifying the recording, and `apply` later updates
/// the recording's state based on the decisions made.
trait Interpreter: Sized {
    fn decide(&mut self, _recording: &Recording) {}

    /// Writes any planned updates to the recording's state and events.
    /// Returns the earliest tick that changed that would not otherwise have
    /// been modified by ingesting the same raw state.
    ///
    /// For example, if an interpreter reads raw signals from a particular tick
    /// and inserts events on that same tick, it can return `None`, as the
    /// addition of new raw signals would already have marked the tick as
    /// modified. However, if it reaches back into earlier ticks in response
    /// to those signals, it should return that tick.
    fn apply(self, recording: &mut Recording) -> Option<Tick>;

    fn interpret(mut self, recording: &mut Recording) -> Option<Tick> {
        self.decide(recording);
        self.apply(recording)
    }
}

// TODO(frolv): Temporary until bespoke events are removed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum InterpretMode {
    Write,
    Compare,
}

pub(super) fn interpret(
    recording: &mut Recording,
    warnings: &mut BTreeMap<Tick, Vec<BuildWarning>>,
    client_id: ClientId,
    plugin_version: PluginVersion,
    config_version: ConfigVersion,
    mode: InterpretMode,
) -> Option<Tick> {
    if config_version == ConfigVersion::NONE {
        return None;
    }

    let ctx = InterpretContext {
        client_id,
        plugin_version,
        config_version,
    };

    if mode == InterpretMode::Compare {
        return match recording.stage() {
            Stage::TobMaiden => MaidenInterpreter::new(&ctx).interpret(recording),
            Stage::TobSotetseg => SotetsegInterpreter::new(&ctx).interpret(recording),
            Stage::TobVerzik => VerzikInterpreter::new(&ctx).interpret(recording),
            stage if (Stage::ColosseumWave1..=Stage::ColosseumWave12).contains(&stage) => {
                ColosseumInterpreter::new(&ctx).interpret(recording)
            }
            _ => None,
        };
    }

    let deaths = NpcDeathInterpreter::new(&ctx).interpret(recording);
    let stage = match recording.stage() {
        Stage::TobBloat => BloatInterpreter::new(&ctx).interpret(recording),
        stage if (Stage::MokhaiotlDelve1..=Stage::MokhaiotlDelve8plus).contains(&stage) => {
            MokhaiotlInterpreter::new(&ctx, recording)
                .and_then(|mokhaiotl| mokhaiotl.interpret(recording))
        }
        Stage::TfaOcellus => {
            OcellusInterpreter::new(recording).and_then(|ocellus| ocellus.interpret(recording))
        }
        _ => None,
    };
    let cooldowns = PlayerAttackInterpreter::new(warnings).interpret(recording);
    deaths.into_iter().chain(stage).chain(cooldowns).min()
}

struct NpcDeathInterpreter<'a> {
    ctx: &'a InterpretContext,
    last_seen: BTreeMap<RoomId, Tick>,
}

impl<'a> NpcDeathInterpreter<'a> {
    fn new(ctx: &'a InterpretContext) -> Self {
        Self {
            ctx,
            last_seen: BTreeMap::new(),
        }
    }
}

impl Interpreter for NpcDeathInterpreter<'_> {
    fn decide(&mut self, recording: &Recording) {
        let ids = GENERIC_DEATHS
            .iter()
            .filter(|(version, _)| self.ctx.plugin_version >= *version)
            .flat_map(|(_, ids)| ids.iter().copied())
            .collect::<BTreeSet<_>>();
        for (tick, state) in recording.states() {
            for (&room_id, npc) in &state.npcs {
                if ids.contains(&npc.id) {
                    self.last_seen.insert(room_id, tick);
                }
            }
        }
    }

    fn apply(self, recording: &mut Recording) -> Option<Tick> {
        let mut last_seen = self
            .last_seen
            .iter()
            .map(|(&room_id, &tick)| (tick, room_id))
            .collect::<Vec<_>>();
        last_seen.sort();
        let mut last_seen = last_seen.into_iter().peekable();
        let mut pending_deaths = Vec::new();
        let mut changed = None;

        for (tick, state) in recording.states_mut() {
            let removed = state
                .events
                .extract_if(.., |event| {
                    matches!(
                        event.kind,
                        EventKind::NpcDeath(death) if self.last_seen.contains_key(&death.npc)
                    )
                })
                .collect::<Vec<_>>();
            let added = pending_deaths
                .drain(..)
                .map(|death| Event::recorded(self.ctx.client_id, EventKind::NpcDeath(death)))
                .collect::<Vec<_>>();
            if changed.is_none() && removed != added {
                changed = Some(tick);
            }
            state.events.extend(added);

            while let Some((_, room_id)) = last_seen.next_if(|&(seen_tick, _)| seen_tick == tick) {
                let npc = &state.npcs[&room_id];
                pending_deaths.push(NpcDeath {
                    position: npc.position.point,
                    npc: room_id,
                    npc_id: Some(npc.id),
                });
            }
        }

        changed
    }
}

/// An object recorded by a plugin and fed through an interpreter.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct ObjectDef(pub(super) object_update::Type, pub(super) u32);

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct RawObjects(BTreeMap<ObjectDef, BTreeSet<Point>>);

impl RawObjects {
    /// Returns the recorded points for the given object definition, if any.
    pub(super) fn get(&self, def: ObjectDef) -> Option<&BTreeSet<Point>> {
        self.0.get(&def)
    }

    pub(super) fn insert(
        &mut self,
        def: ObjectDef,
        points: impl IntoIterator<Item = Point>,
    ) -> Vec<Point> {
        let mut duplicates = Vec::new();
        for point in points {
            if !self.0.entry(def).or_default().insert(point) {
                duplicates.push(point);
            }
        }
        duplicates
    }

    pub(super) fn remove(
        &mut self,
        def: ObjectDef,
        points: impl IntoIterator<Item = Point>,
    ) -> Vec<Point> {
        let mut unknown = Vec::new();
        for point in points {
            if !self.0.get_mut(&def).is_some_and(|held| held.remove(&point)) {
                unknown.push(point);
            }
        }
        if self.0.get(&def).is_some_and(BTreeSet::is_empty) {
            self.0.remove(&def);
        }
        unknown
    }

    pub(super) fn replace(&mut self, def: ObjectDef, points: impl IntoIterator<Item = Point>) {
        let points = points.into_iter().collect::<BTreeSet<_>>();
        if points.is_empty() {
            self.0.remove(&def);
        } else {
            self.0.insert(def, points);
        }
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct Vars {
    pub(super) varbits: BTreeMap<u32, i32>,
    pub(super) varps: BTreeMap<u32, i32>,
}

struct HitpointsVarbits {
    room_id: RoomId,
    current_varbit: u32,
    max_varbit: u32,
    death_animation: u32,
    start_value: Option<(Tick, SkillLevel)>,
    death_tick: Option<Tick>,
}

impl HitpointsVarbits {
    fn new(room_id: RoomId, current_varbit: u32, max_varbit: u32, death_animation: u32) -> Self {
        Self {
            room_id,
            current_varbit,
            max_varbit,
            death_animation,
            start_value: None,
            death_tick: None,
        }
    }

    fn decide(&mut self, tick: Tick, state: &TickState) {
        if self.start_value.is_none() {
            self.start_value = self
                .read(&state.vars)
                .filter(|hitpoints| hitpoints.current > 0)
                .map(|hitpoints| (tick, hitpoints));
        }
        let dying = state
            .raw_npcs
            .get(&self.room_id)
            .is_some_and(|npc| npc.animation == Some(self.death_animation));
        if self.start_value.is_some() && self.death_tick.is_none() && dying {
            self.death_tick = Some(tick);
        }
    }

    fn hitpoints(&self, tick: Tick, vars: &Vars) -> Option<SkillLevel> {
        let (start, hitpoints) = self.start_value?;
        if tick < start {
            return Some(hitpoints);
        }
        let hitpoints = self.read(vars)?;
        if self.death_tick.is_some_and(|death| tick >= death) {
            return Some(SkillLevel {
                current: 0,
                ..hitpoints
            });
        }
        Some(hitpoints)
    }

    fn read(&self, vars: &Vars) -> Option<SkillLevel> {
        let current = u16::try_from(*vars.varbits.get(&self.current_varbit)?).ok()?;
        let base = u16::try_from(*vars.varbits.get(&self.max_varbit)?).ok()?;
        Some(SkillLevel { current, base })
    }
}

/// An NPC as recorded by a plugin.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct RawNpc {
    pub(super) animation: Option<u32>,
    pub(super) animation_start_tick: Tick,
    pub(super) target: Option<RawActor>,
    pub(super) spot_anims: Vec<u32>,
    pub(super) overheads: Vec<Overhead>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Overhead {
    pub(super) archive: u16,
    pub(super) sprite: u16,
}

impl Overhead {
    pub(crate) fn from_raw(raw: u32) -> Self {
        Self {
            archive: (raw >> 16) as u16,
            sprite: (raw & 0xffff) as u16,
        }
    }

    pub(crate) fn to_prayers(self) -> &'static [Prayer] {
        if self.archive != HEADICONS_PRAYER {
            return &[];
        }
        match self.sprite {
            0 => &[Prayer::Standard(StandardPrayer::ProtectFromMelee)],
            1 => &[Prayer::Standard(StandardPrayer::ProtectFromMissiles)],
            2 => &[Prayer::Standard(StandardPrayer::ProtectFromMagic)],
            6 => &[
                Prayer::Standard(StandardPrayer::ProtectFromMissiles),
                Prayer::Standard(StandardPrayer::ProtectFromMagic),
            ],
            7 => &[
                Prayer::Standard(StandardPrayer::ProtectFromMissiles),
                Prayer::Standard(StandardPrayer::ProtectFromMelee),
            ],
            8 => &[
                Prayer::Standard(StandardPrayer::ProtectFromMagic),
                Prayer::Standard(StandardPrayer::ProtectFromMelee),
            ],
            9 => &[
                Prayer::Standard(StandardPrayer::ProtectFromMissiles),
                Prayer::Standard(StandardPrayer::ProtectFromMagic),
                Prayer::Standard(StandardPrayer::ProtectFromMelee),
            ],
            10 => &[Prayer::Curse(AncientCurse::Wrath)],
            11 => &[Prayer::Curse(AncientCurse::SoulSplit)],
            15 => &[Prayer::Curse(AncientCurse::DeflectMelee)],
            16 => &[Prayer::Curse(AncientCurse::DeflectRanged)],
            17 => &[Prayer::Curse(AncientCurse::DeflectMagic)],
            _ => &[],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RawProjectile {
    pub(super) id: u32,
    pub(super) source: Option<RawActor>,
    pub(super) source_coords: Point,
    pub(super) target: Option<RawActor>,
    pub(super) target_coords: Point,
    pub(super) landing_tick: Tick,
}

/// Returns each tick where `interpretation` differs from the bespoke events
/// sent by the plugin in `recording`.
// TODO(frolv): Temporary until bespoke object events are removed.
pub(super) fn compare(recording: &Recording, interpretation: &Recording) -> Vec<BuildMismatch> {
    let (objects, events): (&[ObjectKind], &[proto::event::Type]) = match recording.stage() {
        Stage::TobMaiden => (&[ObjectKind::MaidenBloodSplats], &[]),
        Stage::TobSotetseg => (&[ObjectKind::SoteMazeTiles], &[]),
        Stage::TobVerzik => (&[ObjectKind::VerzikYellows], &[]),
        stage if (Stage::ColosseumWave1..=Stage::ColosseumWave12).contains(&stage) => (
            &[
                ObjectKind::ColosseumReentryPrimaryPool,
                ObjectKind::ColosseumReentrySecondaryPool,
            ],
            &[
                proto::event::Type::ColosseumSolPools,
                proto::event::Type::ColosseumSolLasers,
                proto::event::Type::ColosseumSolDust,
            ],
        ),
        _ => return Vec::new(),
    };

    let object_values = |state: &TickState, kind: ObjectKind| -> BTreeSet<String> {
        state
            .objects
            .iter_of(kind)
            .map(|point| point.to_string())
            .collect()
    };
    let state_values = |state: &TickState, kind: proto::event::Type| -> BTreeSet<String> {
        state
            .events
            .iter()
            .filter_map(event_values)
            .filter(|(event_kind, _)| *event_kind == kind)
            .flat_map(|(_, values)| values)
            .collect()
    };

    let mut mismatches = Vec::new();
    for ((tick, bespoke_state), (_, interpreted_state)) in
        recording.states().zip(interpretation.states())
    {
        let compared_objects = objects.iter().map(|&kind| {
            (
                format!("{kind:?}"),
                object_values(bespoke_state, kind),
                object_values(interpreted_state, kind),
            )
        });
        let compared_events = events.iter().map(|&kind| {
            (
                format!("{kind:?}"),
                state_values(bespoke_state, kind),
                state_values(interpreted_state, kind),
            )
        });
        for (kind, bespoke, interpreted) in compared_objects.chain(compared_events) {
            if bespoke != interpreted {
                mismatches.push(BuildMismatch {
                    tick,
                    kind,
                    bespoke: bespoke.difference(&interpreted).cloned().collect(),
                    interpreted: interpreted.difference(&bespoke).cloned().collect(),
                });
            }
        }
    }
    mismatches
}

// TODO(frolv): Temporary until bespoke object events are removed.
fn event_values(event: &Event) -> Option<(proto::event::Type, Vec<String>)> {
    let positions =
        |points: &[Point]| -> Vec<String> { points.iter().map(Point::to_string).collect() };
    match &event.kind {
        EventKind::SolPools(points) => {
            Some((proto::event::Type::ColosseumSolPools, positions(points)))
        }
        EventKind::SolLasers(phase) => Some((
            proto::event::Type::ColosseumSolLasers,
            vec![format!("{phase:?}")],
        )),
        EventKind::SolDust(dust) => Some((
            proto::event::Type::ColosseumSolDust,
            vec![format!("{dust:?}")],
        )),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        ChallengeMode, NpcState, Players, PrayerBook, PrayerSet, Rect, Rsn, SkillLevel, Source,
        TickObjects,
    };

    #[test]
    fn npc_death_interpreter_replaces_earlier_death_on_later_state() {
        let ctx = InterpretContext {
            client_id: ClientId(2),
            plugin_version: PluginVersion::new(0, 10, 1),
            config_version: ConfigVersion::LATEST,
        };
        let bloat = |position: Point| TickState {
            players: Players::empty(1),
            npcs: BTreeMap::from([(
                RoomId(58490),
                NpcState {
                    source: Source::Client(ClientId(2)),
                    id: 8359,
                    position: Rect::square(position, 5),
                    hitpoints: SkillLevel {
                        current: 1500,
                        base: 1500,
                    },
                    prayers: PrayerSet::empty(PrayerBook::Normal),
                    properties: None,
                },
            )]),
            objects: TickObjects::default(),
            raw_objects: RawObjects::default(),
            raw_npcs: BTreeMap::from([(RoomId(58490), RawNpc::default())]),
            raw_projectiles: Vec::new(),
            vars: Vars::default(),
            events: Vec::new(),
        };

        let mut recording = Recording::vacant(
            Stage::TobBloat,
            ChallengeMode::TobRegular,
            vec![Rsn::try_from("WWWWWWWWWWQQ").unwrap()],
            Tick(1),
        );
        recording.set_state(Tick(0), bloat(Point(3292, 4440)));
        recording.set_state(
            Tick(1),
            TickState {
                players: Players::empty(1),
                npcs: BTreeMap::new(),
                objects: TickObjects::default(),
                raw_objects: RawObjects::default(),
                raw_npcs: BTreeMap::new(),
                raw_projectiles: Vec::new(),
                vars: Vars::default(),
                events: Vec::new(),
            },
        );

        assert_eq!(
            NpcDeathInterpreter::new(&ctx).interpret(&mut recording),
            Some(Tick(1))
        );
        assert_eq!(
            recording
                .states()
                .flat_map(|(tick, state)| state.events.iter().map(move |event| (tick, event)))
                .collect::<Vec<_>>(),
            [(
                Tick(1),
                &Event::recorded(
                    ClientId(2),
                    EventKind::NpcDeath(NpcDeath {
                        position: Point(3292, 4440),
                        npc: RoomId(58490),
                        npc_id: Some(8359),
                    })
                )
            )]
        );

        recording.extend_to(Tick(2));
        recording.set_state(Tick(2), bloat(Point(3290, 4440)));

        assert_eq!(
            NpcDeathInterpreter::new(&ctx).interpret(&mut recording),
            Some(Tick(1))
        );
        assert_eq!(
            recording
                .states()
                .flat_map(|(tick, state)| state.events.iter().map(move |event| (tick, event)))
                .collect::<Vec<_>>(),
            []
        );
    }
}

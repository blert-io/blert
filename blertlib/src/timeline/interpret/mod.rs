//! Interpreters to convert raw game signals into structured events.

mod bloat;
mod colosseum;
mod maiden;
mod mokhaiotl;
mod sotetseg;
mod verzik;

use std::collections::{BTreeMap, BTreeSet};

use bloat::BloatInterpreter;
use colosseum::ColosseumInterpreter;
use maiden::MaidenInterpreter;
use mokhaiotl::MokhaiotlInterpreter;
use sotetseg::SotetsegInterpreter;
use verzik::VerzikInterpreter;

use crate::proto::event::object_update;
use crate::{
    Actor, BuildMismatch, BuildWarning, ClientId, ConfigVersion, Event, EventKind, NpcDeath,
    ObjectKind, PartyIndex, PluginVersion, Point, RawActor, Recording, RoomId, Stage, Tick,
    TickState, WarningReason, npc, proto,
};

use super::off_cooldown_tick;

const GENERIC_DEATHS: [(PluginVersion, &[u32]); 1] = [(
    bloat::MIN_SUPPORTED_VERSION,
    &[
        npc::id::BLOAT_ENTRY,
        npc::id::BLOAT_REGULAR,
        npc::id::BLOAT_HARD,
    ],
)];

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
            MokhaiotlInterpreter::new(&ctx).interpret(recording)
        }
        _ => None,
    };
    let cooldowns = CooldownInterpreter::new(warnings).interpret(recording);
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

struct CooldownInterpreter<'a> {
    warnings: &'a mut BTreeMap<Tick, Vec<BuildWarning>>,
    attacks_to_drop: Vec<(Tick, PartyIndex)>,
}

impl<'a> CooldownInterpreter<'a> {
    fn new(warnings: &'a mut BTreeMap<Tick, Vec<BuildWarning>>) -> Self {
        Self {
            warnings,
            attacks_to_drop: Vec::new(),
        }
    }
}

impl Interpreter for CooldownInterpreter<'_> {
    fn decide(&mut self, recording: &Recording) {
        let mut off_cooldown_on = BTreeMap::new();
        for (tick, state) in recording.states() {
            for event in &state.events {
                let EventKind::PlayerAttack(attack) = &event.kind else {
                    continue;
                };
                let checks_cooldown = match attack.target {
                    Some(Actor::Npc(room_id)) => state
                        .npcs
                        .get(&room_id)
                        .is_none_or(|target| target.attack_checks_cooldown(attack.attack)),
                    _ => true,
                };
                if checks_cooldown
                    && off_cooldown_on
                        .get(&attack.player)
                        .is_some_and(|&off_cooldown| tick < off_cooldown)
                {
                    self.attacks_to_drop.push((tick, attack.player));
                } else if let Some(until) = off_cooldown_tick(tick, state, attack) {
                    off_cooldown_on.insert(attack.player, until);
                }
            }
        }
    }

    fn apply(self, recording: &mut Recording) -> Option<Tick> {
        for attacks in self.attacks_to_drop.chunk_by(|a, b| a.0 == b.0) {
            let (tick, _) = attacks[0];
            if let Some(state) = recording.get_state_mut(tick) {
                state.events.retain(|event| {
                    !matches!(
                        &event.kind,
                        EventKind::PlayerAttack(attack)
                            if attacks.iter().any(|&(_, player)| player == attack.player)
                    )
                });
            }
            self.warnings
                .entry(tick)
                .or_default()
                .extend(attacks.iter().map(|_| BuildWarning {
                    tick,
                    kind: proto::event::Type::PlayerAttack,
                    reason: WarningReason::OnCooldown,
                }));
        }
        None
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

/// An NPC as recorded by a plugin.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct RawNpc {
    pub(super) animation: Option<u32>,
    pub(super) target: Option<RawActor>,
    pub(super) spot_anims: Vec<u32>,
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
        ChallengeMode, Item, Mokhaiotl, NpcProperties, NpcState, PlayerAttack, PlayerAttacked,
        Players, PrayerBook, PrayerSet, Rect, Rsn, SkillLevel, Source, TickObjects, item,
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

    #[test]
    fn cooldown_interpreter_drops_attacks_made_on_cooldown() {
        let doom = RoomId(47491);
        let larva = RoomId(47520);
        let state = |charging: bool, attack: PlayerAttack, weapon: u32, target: RoomId| TickState {
            players: Players::empty(1),
            npcs: BTreeMap::from([
                (
                    doom,
                    NpcState {
                        source: Source::Client(ClientId(31)),
                        id: npc::id::MOKHAIOTL,
                        position: Rect::square(Point(3421, 6435), 5),
                        hitpoints: SkillLevel::from_raw(29_557_336),
                        prayers: PrayerSet::empty(PrayerBook::Normal),
                        properties: Some(NpcProperties::Mokhaiotl(Mokhaiotl { charging })),
                    },
                ),
                (
                    larva,
                    NpcState {
                        source: Source::Client(ClientId(31)),
                        id: npc::id::DEMONIC_LARVA,
                        position: Rect::square(Point(3418, 6438), 1),
                        hitpoints: SkillLevel::from_raw(131_074),
                        prayers: PrayerSet::empty(PrayerBook::Normal),
                        properties: None,
                    },
                ),
            ]),
            objects: TickObjects::default(),
            raw_objects: RawObjects::default(),
            raw_npcs: BTreeMap::new(),
            events: vec![Event::recorded(
                ClientId(31),
                EventKind::PlayerAttack(PlayerAttacked {
                    player: PartyIndex::from_usize(0),
                    attack,
                    weapon: Some(Item {
                        id: weapon,
                        quantity: 1,
                    }),
                    target: Some(Actor::Npc(target)),
                }),
            )],
        };

        let mut recording = Recording::vacant(
            Stage::MokhaiotlDelve4,
            ChallengeMode::NoMode,
            vec![Rsn::try_from("1Ogp").unwrap()],
            Tick(28),
        );
        let bow = (PlayerAttack::TwistedBow, item::id::TWISTED_BOW);
        let blowpipe = (PlayerAttack::Blowpipe, item::id::TOXIC_BLOWPIPE);
        let emberlight = (PlayerAttack::EmberlightAuto, item::id::EMBERLIGHT);
        let halberd = (PlayerAttack::NoxiousHalberd, item::id::NOXIOUS_HALBERD);
        for (tick, charging, (attack, weapon), target) in [
            (20, false, bow, doom),
            (22, false, bow, doom),
            (23, false, blowpipe, larva),
            (25, false, emberlight, larva),
            (26, false, bow, doom),
            (27, true, halberd, doom),
            (28, true, bow, doom),
        ] {
            recording.set_state(Tick(tick), state(charging, attack, weapon, target));
        }

        let mut warnings = BTreeMap::new();
        assert_eq!(
            CooldownInterpreter::new(&mut warnings).interpret(&mut recording),
            None
        );
        assert_eq!(
            recording
                .states()
                .flat_map(|(tick, state)| {
                    state
                        .events
                        .iter()
                        .filter_map(move |event| match &event.kind {
                            EventKind::PlayerAttack(attack) => Some((tick, attack.attack)),
                            _ => None,
                        })
                })
                .collect::<Vec<_>>(),
            [
                (Tick(20), PlayerAttack::TwistedBow),
                (Tick(23), PlayerAttack::Blowpipe),
                (Tick(25), PlayerAttack::EmberlightAuto),
                (Tick(26), PlayerAttack::TwistedBow),
                (Tick(27), PlayerAttack::NoxiousHalberd),
            ]
        );
        assert_eq!(
            warnings,
            BTreeMap::from([
                (
                    Tick(22),
                    vec![BuildWarning {
                        tick: Tick(22),
                        kind: proto::event::Type::PlayerAttack,
                        reason: WarningReason::OnCooldown,
                    }]
                ),
                (
                    Tick(28),
                    vec![BuildWarning {
                        tick: Tick(28),
                        kind: proto::event::Type::PlayerAttack,
                        reason: WarningReason::OnCooldown,
                    }]
                ),
            ])
        );
    }
}

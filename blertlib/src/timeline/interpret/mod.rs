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
    BuildMismatch, ClientId, Event, EventKind, ObjectKind, Point, Recording, Stage, TickState,
    proto,
};

/// An `Interpreter` is responsible for converting raw signals recorded by a
/// plugin into events. Interpreters run in two phases: `decide` performs the
/// interpretation without modifying the recording, and `apply` later updates
/// the recording's state based on the decisions made.
trait Interpreter: Sized {
    fn decide(&mut self, _recording: &Recording) {}

    fn apply(self, recording: &mut Recording);

    fn interpret(mut self, recording: &mut Recording) {
        self.decide(recording);
        self.apply(recording);
    }
}

fn interpret(recording: &mut Recording, client_id: ClientId) {
    match recording.stage() {
        Stage::TobMaiden => MaidenInterpreter::new(client_id).interpret(recording),
        Stage::TobBloat => BloatInterpreter::new(client_id).interpret(recording),
        Stage::TobSotetseg => SotetsegInterpreter::new(client_id).interpret(recording),
        Stage::TobVerzik => VerzikInterpreter::new(client_id).interpret(recording),
        stage if (Stage::ColosseumWave1..=Stage::ColosseumWave12).contains(&stage) => {
            ColosseumInterpreter::new(client_id).interpret(recording);
        }
        stage if (Stage::MokhaiotlDelve1..=Stage::MokhaiotlDelve8plus).contains(&stage) => {
            MokhaiotlInterpreter::new(client_id).interpret(recording);
        }
        _ => {}
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

/// Returns each tick where output from an interpreter differs from that of the
/// bespoke events sent by the plugin.
// TODO(frolv): Temporary until bespoke object events are removed.
pub(super) fn compare(recording: &Recording, client_id: ClientId) -> Vec<BuildMismatch> {
    let (objects, events): (&[ObjectKind], &[proto::event::Type]) = match recording.stage() {
        Stage::TobMaiden => (&[ObjectKind::MaidenBloodSplats], &[]),
        Stage::TobBloat => (
            &[],
            &[
                proto::event::Type::TobBloatHandsDrop,
                proto::event::Type::TobBloatHandsSplat,
            ],
        ),
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
        stage if (Stage::MokhaiotlDelve1..=Stage::MokhaiotlDelve8plus).contains(&stage) => (
            &[
                ObjectKind::MokhaiotlRock,
                ObjectKind::MokhaiotlSplat,
                ObjectKind::MokhaiotlShockwave,
            ],
            &[],
        ),
        _ => return Vec::new(),
    };

    let mut interpretation = recording.clone();
    interpret(&mut interpretation, client_id);

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
        EventKind::BloatHandsDrop(points) => {
            Some((proto::event::Type::TobBloatHandsDrop, positions(points)))
        }
        EventKind::BloatHandsSplat(points) => {
            Some((proto::event::Type::TobBloatHandsSplat, positions(points)))
        }
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

use crate::proto::event::object_update;
use crate::tick::Tick;
use crate::{ObjectKind, Recording, Source};

use super::{InterpretContext, Interpreter, ObjectDef};

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
}

impl<'a> MokhaiotlInterpreter<'a> {
    pub(super) fn new(ctx: &'a InterpretContext) -> Self {
        Self { ctx }
    }
}

impl Interpreter for MokhaiotlInterpreter<'_> {
    fn apply(self, recording: &mut Recording) -> Option<Tick> {
        for (_, state) in recording.states_mut() {
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
        None
    }
}

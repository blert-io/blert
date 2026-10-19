use crate::proto::event::object_update;
use crate::tick::Tick;
use crate::{ObjectKind, Recording, Source};

use super::{InterpretContext, Interpreter, ObjectDef};

const BLOOD_TRAIL: ObjectDef = ObjectDef(object_update::Type::Game, 32984);
const BLOOD_SPLAT: ObjectDef = ObjectDef(object_update::Type::Graphics, 1579);

const OBJECTS: [(ObjectDef, ObjectKind); 2] = [
    (BLOOD_TRAIL, ObjectKind::MaidenBloodSplats),
    (BLOOD_SPLAT, ObjectKind::MaidenBloodSplats),
];

pub(super) struct MaidenInterpreter<'a> {
    ctx: &'a InterpretContext,
}

impl<'a> MaidenInterpreter<'a> {
    pub(super) fn new(ctx: &'a InterpretContext) -> Self {
        Self { ctx }
    }
}

impl Interpreter for MaidenInterpreter<'_> {
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

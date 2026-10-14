use crate::proto::event::object_update;
use crate::{ClientId, ObjectKind, Recording, Source};

use super::{Interpreter, ObjectDef};

const BLOOD_TRAIL: ObjectDef = ObjectDef(object_update::Type::Game, 32984);
const BLOOD_SPLAT: ObjectDef = ObjectDef(object_update::Type::Graphics, 1579);

const OBJECTS: [(ObjectDef, ObjectKind); 2] = [
    (BLOOD_TRAIL, ObjectKind::MaidenBloodSplats),
    (BLOOD_SPLAT, ObjectKind::MaidenBloodSplats),
];

pub(super) struct MaidenInterpreter {
    client_id: ClientId,
}

impl MaidenInterpreter {
    pub(super) fn new(client_id: ClientId) -> Self {
        Self { client_id }
    }
}

impl Interpreter for MaidenInterpreter {
    fn apply(self, recording: &mut Recording) {
        for (_, state) in recording.states_mut() {
            for &(_, kind) in &OBJECTS {
                state.objects.clear(kind);
            }
            for &(def, kind) in &OBJECTS {
                if let Some(points) = state.raw_objects.get(def) {
                    state.objects.insert(
                        kind,
                        Source::Client(self.client_id),
                        points.iter().copied(),
                    );
                }
            }
        }
    }
}

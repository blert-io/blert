use crate::proto::event::object_update;
use crate::{ClientId, ObjectKind, Recording, Source};

use super::{Interpreter, ObjectDef};

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

pub(super) struct MokhaiotlInterpreter {
    client_id: ClientId,
}

impl MokhaiotlInterpreter {
    pub(super) fn new(client_id: ClientId) -> Self {
        Self { client_id }
    }
}

impl Interpreter for MokhaiotlInterpreter {
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

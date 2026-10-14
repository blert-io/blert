use crate::proto::event::object_update;
use crate::{ClientId, ObjectKind, Recording, Source};

use super::{Interpreter, ObjectDef};

const YELLOW: ObjectDef = ObjectDef(object_update::Type::Graphics, 1595);

pub(super) struct VerzikInterpreter {
    client_id: ClientId,
}

impl VerzikInterpreter {
    pub(super) fn new(client_id: ClientId) -> Self {
        Self { client_id }
    }
}

impl Interpreter for VerzikInterpreter {
    fn apply(self, recording: &mut Recording) {
        for (_, state) in recording.states_mut() {
            state.objects.clear(ObjectKind::VerzikYellows);
            if let Some(points) = state.raw_objects.get(YELLOW) {
                state.objects.insert(
                    ObjectKind::VerzikYellows,
                    Source::Client(self.client_id),
                    points.iter().copied(),
                );
            }
        }
    }
}

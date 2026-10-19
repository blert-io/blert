use crate::proto::event::object_update;
use crate::tick::Tick;
use crate::{ObjectKind, Recording, Source};

use super::{InterpretContext, Interpreter, ObjectDef};

const YELLOW: ObjectDef = ObjectDef(object_update::Type::Graphics, 1595);

pub(super) struct VerzikInterpreter<'a> {
    ctx: &'a InterpretContext,
}

impl<'a> VerzikInterpreter<'a> {
    pub(super) fn new(ctx: &'a InterpretContext) -> Self {
        Self { ctx }
    }
}

impl Interpreter for VerzikInterpreter<'_> {
    fn apply(self, recording: &mut Recording) -> Option<Tick> {
        for (_, state) in recording.states_mut() {
            state.objects.clear(ObjectKind::VerzikYellows);
            if let Some(points) = state.raw_objects.get(YELLOW) {
                state.objects.insert(
                    ObjectKind::VerzikYellows,
                    Source::Client(self.ctx.client_id),
                    points.iter().copied(),
                );
            }
        }
        None
    }
}

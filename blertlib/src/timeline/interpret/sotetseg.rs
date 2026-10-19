use crate::proto::event::object_update;
use crate::tick::Tick;
use crate::{ObjectKind, Point, Recording, Rect, Source};

use super::{InterpretContext, Interpreter, ObjectDef};

const MAZE_TILE: ObjectDef = ObjectDef(object_update::Type::Ground, 33035);

const OVERWORLD_MAZE: Rect = Rect {
    point: Point(3273, 4310),
    width: 14,
    height: 15,
};

pub(super) struct SotetsegInterpreter<'a> {
    ctx: &'a InterpretContext,
}

impl<'a> SotetsegInterpreter<'a> {
    pub(super) fn new(ctx: &'a InterpretContext) -> Self {
        Self { ctx }
    }
}

impl Interpreter for SotetsegInterpreter<'_> {
    fn apply(self, recording: &mut Recording) -> Option<Tick> {
        let Point(x, y) = OVERWORLD_MAZE.point;
        for (_, state) in recording.states_mut() {
            state.objects.clear(ObjectKind::SoteMazeTiles);
            if let Some(points) = state.raw_objects.get(MAZE_TILE) {
                state.objects.insert(
                    ObjectKind::SoteMazeTiles,
                    Source::Client(self.ctx.client_id),
                    points
                        .iter()
                        .filter(|&&point| OVERWORLD_MAZE.contains(point))
                        .map(|point| Point(point.0 - x, point.1 - y)),
                );
            }
        }
        None
    }
}

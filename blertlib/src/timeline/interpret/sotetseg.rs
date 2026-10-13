use crate::proto::event::object_update;
use crate::{ClientId, ObjectKind, Point, Recording, Rect, Source};

use super::{Interpreter, ObjectDef};

const MAZE_TILE: ObjectDef = ObjectDef(object_update::Type::Ground, 33035);

const OVERWORLD_MAZE: Rect = Rect {
    point: Point(3273, 4310),
    width: 14,
    height: 15,
};

pub(super) struct SotetsegInterpreter {
    client_id: ClientId,
}

impl SotetsegInterpreter {
    pub(super) fn new(client_id: ClientId) -> Self {
        Self { client_id }
    }
}

impl Interpreter for SotetsegInterpreter {
    fn apply(self, recording: &mut Recording) {
        let Point(x, y) = OVERWORLD_MAZE.point;
        for (_, state) in recording.states_mut() {
            state.objects.clear(ObjectKind::SoteMazeTiles);
            if let Some(points) = state.raw_objects.get(MAZE_TILE) {
                state.objects.insert(
                    ObjectKind::SoteMazeTiles,
                    Source::Client(self.client_id),
                    points
                        .iter()
                        .filter(|&&point| OVERWORLD_MAZE.contains(point))
                        .map(|point| Point(point.0 - x, point.1 - y)),
                );
            }
        }
    }
}

use crate::proto::event::object_update;
use crate::{ClientId, Event, EventKind, Recording};

use super::{Interpreter, ObjectDef};

const HANDS_DROP: [ObjectDef; 4] = [
    ObjectDef(object_update::Type::Graphics, 1570),
    ObjectDef(object_update::Type::Graphics, 1571),
    ObjectDef(object_update::Type::Graphics, 1572),
    ObjectDef(object_update::Type::Graphics, 1573),
];
const HANDS_SPLAT: ObjectDef = ObjectDef(object_update::Type::Graphics, 1576);

pub(super) struct BloatInterpreter {
    client_id: ClientId,
}

impl BloatInterpreter {
    pub(super) fn new(client_id: ClientId) -> Self {
        Self { client_id }
    }
}

impl Interpreter for BloatInterpreter {
    fn apply(self, recording: &mut Recording) {
        for (_, state) in recording.states_mut() {
            let drops = HANDS_DROP
                .iter()
                .filter_map(|&def| state.raw_objects.get(def))
                .flatten()
                .copied()
                .collect::<Vec<_>>();
            let splats = state
                .raw_objects
                .get(HANDS_SPLAT)
                .into_iter()
                .flatten()
                .copied()
                .collect::<Vec<_>>();
            state.events.retain(|event| {
                !matches!(
                    event.kind,
                    EventKind::BloatHandsDrop(_) | EventKind::BloatHandsSplat(_)
                )
            });
            if !drops.is_empty() {
                state.events.push(Event::recorded(
                    self.client_id,
                    EventKind::BloatHandsDrop(drops),
                ));
            }
            if !splats.is_empty() {
                state.events.push(Event::recorded(
                    self.client_id,
                    EventKind::BloatHandsSplat(splats),
                ));
            }
        }
    }
}

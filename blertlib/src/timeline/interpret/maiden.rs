use std::collections::BTreeMap;

use crate::proto::event::object_update;
use crate::tick::Tick;
use crate::{ObjectKind, Point, Recording, Source};

use super::{InterpretContext, Interpreter, ObjectDef, SpotAnimPlacement};

const BLOOD_TRAIL: ObjectDef = ObjectDef(object_update::Type::Game, 32984);
const BLOOD_SPLAT: u32 = 1579;

pub(super) struct MaidenInterpreter<'a> {
    ctx: &'a InterpretContext,
    splats: BTreeMap<Tick, Vec<Point>>,
}

impl<'a> MaidenInterpreter<'a> {
    pub(super) fn new(ctx: &'a InterpretContext) -> Self {
        Self {
            ctx,
            splats: BTreeMap::new(),
        }
    }
}

impl Interpreter for MaidenInterpreter<'_> {
    fn decide(&mut self, recording: &Recording) {
        for (_, state) in recording.states() {
            for spot_anim in state.raw_spot_anims.get(&BLOOD_SPLAT).into_iter().flatten() {
                let SpotAnimPlacement::Tile(point) = spot_anim.placement else {
                    continue;
                };
                for tick in spot_anim.draw_tick.0..spot_anim.end_tick.0 {
                    self.splats.entry(Tick(tick)).or_default().push(point);
                }
            }
        }
    }

    fn apply(mut self, recording: &mut Recording) -> Option<Tick> {
        for (tick, state) in recording.states_mut() {
            state.objects.clear(ObjectKind::MaidenBloodSplats);
            if let Some(points) = state.raw_objects.get(BLOOD_TRAIL) {
                state.objects.insert(
                    ObjectKind::MaidenBloodSplats,
                    Source::Client(self.ctx.client_id),
                    points.iter().copied(),
                );
            }
            state.objects.insert(
                ObjectKind::MaidenBloodSplats,
                Source::Client(self.ctx.client_id),
                self.splats.remove(&tick).into_iter().flatten(),
            );
        }
        None
    }
}

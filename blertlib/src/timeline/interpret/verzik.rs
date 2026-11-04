use std::collections::BTreeMap;

use crate::tick::Tick;
use crate::{ObjectKind, Point, Recording, Source};

use super::{InterpretContext, Interpreter, SpotAnimPlacement};

const YELLOW: u32 = 1595;

pub(super) struct VerzikInterpreter<'a> {
    ctx: &'a InterpretContext,
    yellows: BTreeMap<Tick, Vec<Point>>,
}

impl<'a> VerzikInterpreter<'a> {
    pub(super) fn new(ctx: &'a InterpretContext) -> Self {
        Self {
            ctx,
            yellows: BTreeMap::new(),
        }
    }
}

impl Interpreter for VerzikInterpreter<'_> {
    fn decide(&mut self, recording: &Recording) {
        for (_, state) in recording.states() {
            for spot_anim in state.raw_spot_anims.get(&YELLOW).into_iter().flatten() {
                let SpotAnimPlacement::Tile(point) = spot_anim.placement else {
                    continue;
                };
                for tick in spot_anim.draw_tick.0..spot_anim.end_tick.0 {
                    self.yellows.entry(Tick(tick)).or_default().push(point);
                }
            }
        }
    }

    fn apply(mut self, recording: &mut Recording) -> Option<Tick> {
        for (tick, state) in recording.states_mut() {
            state.objects.clear(ObjectKind::VerzikYellows);
            state.objects.insert(
                ObjectKind::VerzikYellows,
                Source::Client(self.ctx.client_id),
                self.yellows.remove(&tick).into_iter().flatten(),
            );
        }
        None
    }
}

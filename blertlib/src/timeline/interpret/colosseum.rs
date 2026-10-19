use crate::proto::event::object_update;
use crate::tick::Tick;
use crate::{
    Event, EventKind, ObjectKind, Point, Recording, Rect, SolDust, SolDustDirection, SolLaserPhase,
    Source, TickState, npc,
};

use super::{InterpretContext, Interpreter, ObjectDef};

const REENTRY_PRIMARY_POOL: ObjectDef = ObjectDef(object_update::Type::Game, 50743);
const REENTRY_SECONDARY_POOL: ObjectDef = ObjectDef(object_update::Type::Ground, 50744);
const SOL_POOL: ObjectDef = ObjectDef(object_update::Type::Graphics, 2698);
const SOL_LASER_SCAN: [ObjectDef; 3] = [
    ObjectDef(object_update::Type::Graphics, 2689),
    ObjectDef(object_update::Type::Graphics, 2690),
    ObjectDef(object_update::Type::Graphics, 2691),
];
const SOL_LASER_SHOT: [ObjectDef; 3] = [
    ObjectDef(object_update::Type::Graphics, 2693),
    ObjectDef(object_update::Type::Graphics, 2694),
    ObjectDef(object_update::Type::Graphics, 2695),
];
const SOL_DUST: [ObjectDef; 3] = [
    ObjectDef(object_update::Type::Graphics, 2669),
    ObjectDef(object_update::Type::Graphics, 2670),
    ObjectDef(object_update::Type::Graphics, 2671),
];

const OBJECTS: [(ObjectDef, ObjectKind); 2] = [
    (
        REENTRY_PRIMARY_POOL,
        ObjectKind::ColosseumReentryPrimaryPool,
    ),
    (
        REENTRY_SECONDARY_POOL,
        ObjectKind::ColosseumReentrySecondaryPool,
    ),
];

pub(super) struct ColosseumInterpreter<'a> {
    ctx: &'a InterpretContext,
}

impl Interpreter for ColosseumInterpreter<'_> {
    fn apply(self, recording: &mut Recording) -> Option<Tick> {
        for (_, state) in recording.states_mut() {
            let events = [
                self.sol_pools(state),
                self.sol_lasers(state),
                self.sol_dust(state),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();

            for &(_, kind) in &OBJECTS {
                state.objects.clear(kind);
            }

            for &(def, kind) in &OBJECTS {
                if let Some(raw) = state.raw_objects.get(def) {
                    state.objects.insert(
                        kind,
                        Source::Client(self.ctx.client_id),
                        raw.iter().copied(),
                    );
                }
            }

            state.events.retain(|event| {
                !matches!(
                    event.kind,
                    EventKind::SolPools(_) | EventKind::SolLasers(_) | EventKind::SolDust(_)
                )
            });
            state.events.extend(events);
        }

        None
    }
}

impl<'a> ColosseumInterpreter<'a> {
    pub(super) fn new(ctx: &'a InterpretContext) -> Self {
        Self { ctx }
    }

    fn sol_pools(&self, state: &TickState) -> Option<Event> {
        let pools = state
            .raw_objects
            .get(SOL_POOL)?
            .iter()
            .copied()
            .collect::<Vec<_>>();
        Some(Event::recorded(
            self.ctx.client_id,
            EventKind::SolPools(pools),
        ))
    }

    fn sol_lasers(&self, state: &TickState) -> Option<Event> {
        let any_present =
            |defs: &[ObjectDef]| defs.iter().any(|&def| state.raw_objects.get(def).is_some());
        let phase = if any_present(&SOL_LASER_SHOT) {
            SolLaserPhase::Shot
        } else if any_present(&SOL_LASER_SCAN) {
            SolLaserPhase::Scan
        } else {
            return None;
        };
        Some(Event::recorded(
            self.ctx.client_id,
            EventKind::SolLasers(phase),
        ))
    }

    fn sol_dust(&self, state: &TickState) -> Option<Event> {
        let sol = state
            .npcs
            .values()
            .find(|npc| npc.id == npc::id::SOL_HEREDIT)?;
        let mut dust = SOL_DUST
            .iter()
            .filter_map(|&def| state.raw_objects.get(def))
            .flatten()
            .copied()
            .peekable();
        dust.peek()?;

        // Pattern can be identified by counting how many dusts are 2 tiles away from Sol.
        let two_away = dust
            .filter(|&point| sol.position.distance(point) == 2)
            .collect::<Vec<_>>();
        let direction = |Point(x, y): Point| {
            let Rect {
                point: Point(west, south),
                width,
                height,
            } = sol.position;
            if x < west {
                SolDustDirection::West
            } else if x >= west + width {
                SolDustDirection::East
            } else if y >= south + height {
                SolDustDirection::North
            } else {
                SolDustDirection::South
            }
        };

        let dust = match two_away[..] {
            // Safe ring 2 tiles away: first shield.
            [] => SolDust::Shield1,
            // Two trident prongs: first trident.
            [first, _] => SolDust::Trident1(direction(first)),
            // Three trident prongs: first trident.
            [first, _, _] => SolDust::Trident2(direction(first)),
            // Safe ring 3 tiles away, everything else is dust: second shield.
            _ => SolDust::Shield2,
        };
        Some(Event::recorded(
            self.ctx.client_id,
            EventKind::SolDust(dust),
        ))
    }
}

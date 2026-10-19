use std::collections::BTreeMap;

use crate::event::{BloatDown, Event, EventKind, NpcAttacked};
use crate::proto::event::object_update;
use crate::tick::{Tick, Ticks};
use crate::timeline::{Recording, TickState};
use crate::{NpcAttack, PluginVersion, RoomId, npc};

use super::{InterpretContext, Interpreter, ObjectDef};

pub(super) const MIN_SUPPORTED_VERSION: PluginVersion = PluginVersion::new(0, 10, 1);

#[expect(dead_code, reason = "captured and sent; not currently used")]
const HANDS_DROP: [ObjectDef; 4] = [
    ObjectDef(object_update::Type::Graphics, 1570),
    ObjectDef(object_update::Type::Graphics, 1571),
    ObjectDef(object_update::Type::Graphics, 1572),
    ObjectDef(object_update::Type::Graphics, 1573),
];

const HANDS_SPLAT: ObjectDef = ObjectDef(object_update::Type::Graphics, 1576);

const DOWN_ANIMATION: u32 = 8082;
const DEATH_ANIMATION: u32 = 8085;
const DOWN_CYCLE_TICKS: Ticks = Ticks(32);
const STOMP_TICK: Ticks = Ticks(3);

pub(super) struct BloatInterpreter<'a> {
    ctx: &'a InterpretContext,
    events: BTreeMap<Tick, EventKind>,
}

impl<'a> BloatInterpreter<'a> {
    pub(super) fn new(ctx: &'a InterpretContext) -> Self {
        Self {
            ctx,
            events: BTreeMap::new(),
        }
    }
}

impl Interpreter for BloatInterpreter<'_> {
    fn decide(&mut self, recording: &Recording) {
        if self.ctx.plugin_version < MIN_SUPPORTED_VERSION {
            return;
        }

        let Some(id) = recording.states().find_map(|(_, state)| {
            state
                .npcs
                .iter()
                .find_map(|(&id, npc)| npc::is_bloat(npc.id).then_some(id))
        }) else {
            return;
        };
        let mut bloat = BloatState::new(id);

        for (tick, state) in recording.states() {
            if let Some(kind) = bloat.update(tick, state) {
                self.events.insert(tick, kind);
            }
        }
    }

    fn apply(mut self, recording: &mut Recording) -> Option<Tick> {
        if self.ctx.plugin_version < MIN_SUPPORTED_VERSION {
            return None;
        }

        for (tick, state) in recording.states_mut() {
            let splats = state
                .raw_objects
                .get(HANDS_SPLAT)
                .into_iter()
                .flatten()
                .copied()
                .collect::<Vec<_>>();

            // The plugin's hands drop events are kept because they encode the
            // order in which the server spawned the hands, which a generic
            // objects event can't easily do.
            state.events.retain(|event| {
                !matches!(
                    event.kind,
                    EventKind::BloatHandsSplat(_)
                        | EventKind::BloatDown(_)
                        | EventKind::BloatUp
                        | EventKind::NpcAttack(NpcAttacked {
                            attack: NpcAttack::TobBloatStomp,
                            ..
                        })
                )
            });
            if !splats.is_empty() {
                state.events.push(Event::recorded(
                    self.ctx.client_id,
                    EventKind::BloatHandsSplat(splats),
                ));
            }
            if let Some(kind) = self.events.remove(&tick) {
                state.events.push(Event::recorded(self.ctx.client_id, kind));
            }
        }

        None
    }
}

#[derive(Debug)]
struct BloatState {
    id: RoomId,
    downs: u32,
    last_down: Option<Tick>,
    last_up: Option<Tick>,
    previous_animation: Option<(Tick, Option<u32>)>,
}

impl BloatState {
    fn new(id: RoomId) -> Self {
        Self {
            id,
            downs: 0,
            last_down: None,
            last_up: None,
            previous_animation: None,
        }
    }

    fn update(&mut self, tick: Tick, state: &TickState) -> Option<EventKind> {
        let animation = state.raw_npcs.get(&self.id)?.animation;
        if animation == Some(DEATH_ANIMATION) {
            self.last_down = None;
            return None;
        }

        let went_down = animation == Some(DOWN_ANIMATION)
            && self
                .previous_animation
                .is_some_and(|(previous_tick, previous)| {
                    previous_tick == tick.pred() && previous != Some(DOWN_ANIMATION)
                });
        self.previous_animation = Some((tick, animation));

        if went_down {
            self.downs += 1;
            let up_ticks = self.last_up.map_or(tick.duration().inc(), |up| tick - up);
            self.last_down = Some(tick);
            return Some(EventKind::BloatDown(BloatDown {
                down_number: self.downs,
                up_ticks,
            }));
        }

        let down = self.last_down?;
        if animation.is_none() || tick == down + DOWN_CYCLE_TICKS.inc() {
            self.last_down = None;
            self.last_up = Some(tick);
            Some(EventKind::BloatUp)
        } else if tick == down + (DOWN_CYCLE_TICKS - STOMP_TICK) {
            Some(EventKind::NpcAttack(NpcAttacked {
                npc: self.id,
                attack: NpcAttack::TobBloatStomp,
                target: None,
            }))
        } else {
            None
        }
    }
}

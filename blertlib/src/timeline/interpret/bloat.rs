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
            bloat.update(&mut self.events, tick, state);
        }
        bloat.finish(&mut self.events);
    }

    fn apply(mut self, recording: &mut Recording) -> Option<Tick> {
        if self.ctx.plugin_version < MIN_SUPPORTED_VERSION {
            return None;
        }

        let mut changed = None;

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
            let removed = state
                .events
                .extract_if(.., |event| {
                    matches!(
                        event.kind,
                        EventKind::BloatHandsSplat(_)
                            | EventKind::BloatDown(_)
                            | EventKind::BloatUp
                            | EventKind::NpcAttack(NpcAttacked {
                                attack: NpcAttack::TobBloatStomp,
                                ..
                            })
                    )
                })
                .collect::<Vec<_>>();
            let mut added = Vec::new();
            if !splats.is_empty() {
                added.push(Event::recorded(
                    self.ctx.client_id,
                    EventKind::BloatHandsSplat(splats),
                ));
            }
            let kind = self.events.remove(&tick).filter(|kind| match kind {
                EventKind::NpcAttack(attack) => state.npcs.contains_key(&attack.npc),
                _ => true,
            });
            if let Some(kind) = kind {
                added.push(Event::recorded(self.ctx.client_id, kind));
            }
            if changed.is_none() && removed != added {
                changed = Some(tick);
            }
            state.events.extend(added);
        }

        changed
    }
}

#[derive(Debug, Clone, Copy)]
enum Phase {
    Start,
    Up { last_up: Option<Tick> },
    Down(Tick),
    Dead,
}

#[derive(Debug)]
struct BloatState {
    id: RoomId,
    downs: u32,
    phase: Phase,
}

impl BloatState {
    fn new(id: RoomId) -> Self {
        Self {
            id,
            downs: 0,
            phase: Phase::Start,
        }
    }

    /// Advances Bloat's state machine for a tick.
    fn update(&mut self, events: &mut BTreeMap<Tick, EventKind>, tick: Tick, state: &TickState) {
        let Some(npc) = state.raw_npcs.get(&self.id) else {
            return;
        };
        let animation = npc.animation;

        if animation == Some(DEATH_ANIMATION) {
            if let Phase::Down(down) = self.phase {
                let stomp = down + (DOWN_CYCLE_TICKS - STOMP_TICK);
                if stomp < tick {
                    events.insert(stomp, bloat_stomp_attack(self.id));
                }
            }
            self.phase = Phase::Dead;
            return;
        }

        match self.phase {
            Phase::Start => {
                if animation != Some(DOWN_ANIMATION) {
                    self.phase = Phase::Up { last_up: None };
                }
            }
            Phase::Up { last_up } => {
                if animation == Some(DOWN_ANIMATION) {
                    self.downs += 1;
                    let up_ticks = last_up.map_or(tick.duration().inc(), |up| tick - up);
                    events.insert(
                        tick,
                        EventKind::BloatDown(BloatDown {
                            down_number: self.downs,
                            up_ticks,
                        }),
                    );
                    self.phase = Phase::Down(tick);
                }
            }
            Phase::Down(down) => {
                let latest_up = down + DOWN_CYCLE_TICKS.inc();
                if animation.is_none() || tick >= latest_up {
                    events.insert(tick, EventKind::BloatUp);
                    let stomp = tick.min(latest_up) - STOMP_TICK.inc();
                    if stomp > down {
                        events.insert(stomp, bloat_stomp_attack(self.id));
                    }
                    self.phase = Phase::Up {
                        last_up: Some(tick),
                    };
                }
            }
            Phase::Dead => {}
        }
    }

    fn finish(&self, events: &mut BTreeMap<Tick, EventKind>) {
        if let Phase::Down(down) = self.phase {
            events.insert(
                down + (DOWN_CYCLE_TICKS - STOMP_TICK),
                bloat_stomp_attack(self.id),
            );
        }
    }
}

fn bloat_stomp_attack(bloat: RoomId) -> EventKind {
    EventKind::NpcAttack(NpcAttacked {
        npc: bloat,
        attack: NpcAttack::TobBloatStomp,
        target: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::timeline::interpret::{RawNpc, RawObjects, Vars};
    use crate::{
        ChallengeMode, ClientId, ConfigVersion, NpcState, Players, Point, PrayerBook, PrayerSet,
        Rect, Rsn, SkillLevel, Source, Stage, TickObjects,
    };

    #[test]
    fn interpret_bloat_down_after_tick_gap() {
        let ctx = InterpretContext {
            client_id: ClientId(2),
            plugin_version: PluginVersion::new(0, 10, 1),
            config_version: ConfigVersion::LATEST,
        };
        let bloat = |animation: Option<u32>| TickState {
            players: Players::empty(1),
            npcs: BTreeMap::from([(
                RoomId(58490),
                NpcState {
                    source: Source::Client(ClientId(2)),
                    id: 8359,
                    position: Rect::square(Point(3292, 4440), 5),
                    hitpoints: SkillLevel {
                        current: 1500,
                        base: 1500,
                    },
                    prayers: PrayerSet::empty(PrayerBook::Normal),
                    properties: None,
                },
            )]),
            objects: TickObjects::default(),
            raw_objects: RawObjects::default(),
            raw_npcs: BTreeMap::from([(
                RoomId(58490),
                RawNpc {
                    animation,
                    ..Default::default()
                },
            )]),
            vars: Vars::default(),
            events: Vec::new(),
        };

        let mut recording = Recording::vacant(
            Stage::TobBloat,
            ChallengeMode::TobRegular,
            vec![Rsn::try_from("Yieldofin").unwrap()],
            Tick(150),
        );
        recording.set_state(Tick(45), bloat(None));
        recording.set_state(
            Tick(46),
            TickState {
                players: Players::empty(1),
                npcs: BTreeMap::new(),
                objects: TickObjects::default(),
                raw_objects: RawObjects::default(),
                raw_npcs: BTreeMap::new(),
                vars: Vars::default(),
                events: Vec::new(),
            },
        );
        for tick in 47..=79 {
            recording.set_state(Tick(tick), bloat(Some(8082)));
        }
        for tick in 80..=114 {
            recording.set_state(Tick(tick), bloat(None));
        }
        for tick in 116..=148 {
            recording.set_state(Tick(tick), bloat(Some(8082)));
        }
        recording.set_state(Tick(150), bloat(None));

        assert_eq!(
            BloatInterpreter::new(&ctx).interpret(&mut recording),
            Some(Tick(47))
        );
        let stomp = Event::recorded(
            ClientId(2),
            EventKind::NpcAttack(NpcAttacked {
                npc: RoomId(58490),
                attack: NpcAttack::TobBloatStomp,
                target: None,
            }),
        );
        let up = Event::recorded(ClientId(2), EventKind::BloatUp);
        assert_eq!(
            recording
                .states()
                .flat_map(|(tick, state)| state.events.iter().map(move |event| (tick, event)))
                .collect::<Vec<_>>(),
            [
                (
                    Tick(47),
                    &Event::recorded(
                        ClientId(2),
                        EventKind::BloatDown(BloatDown {
                            down_number: 1,
                            up_ticks: Ticks(48),
                        })
                    )
                ),
                (Tick(76), &stomp),
                (Tick(80), &up),
                (
                    Tick(116),
                    &Event::recorded(
                        ClientId(2),
                        EventKind::BloatDown(BloatDown {
                            down_number: 2,
                            up_ticks: Ticks(36),
                        })
                    )
                ),
                (Tick(145), &stomp),
                (Tick(150), &up),
            ]
        );
    }

    #[test]
    fn interpret_bloat_up_before_countdown_ends() {
        let ctx = InterpretContext {
            client_id: ClientId(2),
            plugin_version: PluginVersion::new(0, 10, 1),
            config_version: ConfigVersion::LATEST,
        };
        let bloat = |animation: Option<u32>| TickState {
            players: Players::empty(1),
            npcs: BTreeMap::from([(
                RoomId(58490),
                NpcState {
                    source: Source::Client(ClientId(2)),
                    id: 8359,
                    position: Rect::square(Point(3292, 4440), 5),
                    hitpoints: SkillLevel {
                        current: 1500,
                        base: 1500,
                    },
                    prayers: PrayerSet::empty(PrayerBook::Normal),
                    properties: None,
                },
            )]),
            objects: TickObjects::default(),
            raw_objects: RawObjects::default(),
            raw_npcs: BTreeMap::from([(
                RoomId(58490),
                RawNpc {
                    animation,
                    ..Default::default()
                },
            )]),
            vars: Vars::default(),
            events: Vec::new(),
        };
        let down = Event::recorded(
            ClientId(2),
            EventKind::BloatDown(BloatDown {
                down_number: 1,
                up_ticks: Ticks(48),
            }),
        );
        let stomp = Event::recorded(
            ClientId(2),
            EventKind::NpcAttack(NpcAttacked {
                npc: RoomId(58490),
                attack: NpcAttack::TobBloatStomp,
                target: None,
            }),
        );

        let mut recording = Recording::vacant(
            Stage::TobBloat,
            ChallengeMode::TobRegular,
            vec![Rsn::try_from("Yieldofin").unwrap()],
            Tick(77),
        );
        recording.set_state(Tick(46), bloat(None));
        for tick in 47..=77 {
            recording.set_state(Tick(tick), bloat(Some(8082)));
        }

        assert_eq!(
            BloatInterpreter::new(&ctx).interpret(&mut recording),
            Some(Tick(47))
        );
        assert_eq!(
            recording
                .states()
                .flat_map(|(tick, state)| state.events.iter().map(move |event| (tick, event)))
                .collect::<Vec<_>>(),
            [(Tick(47), &down), (Tick(76), &stomp)]
        );

        recording.extend_to(Tick(79));
        recording.set_state(Tick(78), bloat(Some(8082)));
        recording.set_state(Tick(79), bloat(None));

        assert_eq!(
            BloatInterpreter::new(&ctx).interpret(&mut recording),
            Some(Tick(75))
        );
        assert_eq!(
            recording
                .states()
                .flat_map(|(tick, state)| state.events.iter().map(move |event| (tick, event)))
                .collect::<Vec<_>>(),
            [
                (Tick(47), &down),
                (Tick(75), &stomp),
                (Tick(79), &Event::recorded(ClientId(2), EventKind::BloatUp)),
            ]
        );
    }

    #[test]
    fn interpret_does_not_insert_attacks_on_ticks_without_bloat() {
        let ctx = InterpretContext {
            client_id: ClientId(2),
            plugin_version: PluginVersion::new(0, 10, 1),
            config_version: ConfigVersion::LATEST,
        };
        let bloat = |animation: Option<u32>| TickState {
            players: Players::empty(1),
            npcs: BTreeMap::from([(
                RoomId(58490),
                NpcState {
                    source: Source::Client(ClientId(2)),
                    id: 8359,
                    position: Rect::square(Point(3292, 4440), 5),
                    hitpoints: SkillLevel {
                        current: 1500,
                        base: 1500,
                    },
                    prayers: PrayerSet::empty(PrayerBook::Normal),
                    properties: None,
                },
            )]),
            objects: TickObjects::default(),
            raw_objects: RawObjects::default(),
            raw_npcs: BTreeMap::from([(
                RoomId(58490),
                RawNpc {
                    animation,
                    ..Default::default()
                },
            )]),
            vars: Vars::default(),
            events: Vec::new(),
        };

        let mut recording = Recording::vacant(
            Stage::TobBloat,
            ChallengeMode::TobRegular,
            vec![Rsn::try_from("Yieldofin").unwrap()],
            Tick(80),
        );
        recording.set_state(Tick(46), bloat(None));
        for tick in 47..=60 {
            recording.set_state(Tick(tick), bloat(Some(8082)));
        }
        for tick in 61..=80 {
            recording.set_state(
                Tick(tick),
                TickState {
                    players: Players::empty(1),
                    npcs: BTreeMap::new(),
                    objects: TickObjects::default(),
                    raw_objects: RawObjects::default(),
                    raw_npcs: BTreeMap::new(),
                    vars: Vars::default(),
                    events: Vec::new(),
                },
            );
        }

        BloatInterpreter::new(&ctx).interpret(&mut recording);
        assert_eq!(
            recording
                .states()
                .flat_map(|(tick, state)| {
                    state
                        .events
                        .iter()
                        .filter(move |event| {
                            matches!(
                                &event.kind,
                                EventKind::NpcAttack(attack)
                                    if !state.npcs.contains_key(&attack.npc)
                            )
                        })
                        .map(move |event| (tick, event))
                })
                .collect::<Vec<_>>(),
            []
        );
    }
}

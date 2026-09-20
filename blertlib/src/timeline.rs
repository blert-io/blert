//! State representation and operations on a recording of a challenge stage.

use std::collections::BTreeMap;

use crate::actor::{NpcState, Players, RoomId};
use crate::event::Event;
use crate::objects::TickObjects;
use crate::tick::{Tick, Ticks};

/// A `Timeline` represents a challenge stage as observed by one or more clients.
/// It is a nonempty, chronological sequence of ticks, each storing the state of
/// the world on that tick alongside the events that occurred.
#[derive(Debug, Clone)]
pub struct Timeline {
    states: Vec<Option<TickState>>,
}

impl Timeline {
    /// Creates a timeline spanning to `last_tick` without any state or events.
    ///
    /// # Panics
    ///
    /// Panics if `last_tick` is 0.
    #[must_use]
    pub fn vacant(last_tick: Tick) -> Self {
        assert!(last_tick.0 > 0);
        Self {
            states: vec![None; last_tick.as_usize() + 1],
        }
    }

    /// Returns the highest tick number represented by the timeline.
    #[must_use]
    pub fn last_tick(&self) -> Tick {
        Tick::from_usize(self.states.len() - 1)
    }

    /// Returns the state on a given tick, or `None` if the tick is absent.
    #[must_use]
    pub fn get_state(&self, tick: Tick) -> Option<&TickState> {
        self.states.get(tick.as_usize())?.as_ref()
    }

    /// Returns a mutable reference to the state on a given tick, or `None`
    /// if the tick is absent.
    #[must_use]
    pub fn get_state_mut(&mut self, tick: Tick) -> Option<&mut TickState> {
        self.states.get_mut(tick.as_usize())?.as_mut()
    }

    /// Sets the state on `tick`, replacing any existing state.
    ///
    /// # Panics
    ///
    /// Panics if `tick` is beyond the timeline's last tick.
    pub fn set_state(&mut self, tick: Tick, state: TickState) {
        self.states[tick.as_usize()] = Some(state);
    }

    /// Returns an iterator over each present tick and its state, in order.
    pub fn states(&self) -> impl Iterator<Item = (Tick, &TickState)> {
        self.states
            .iter()
            .enumerate()
            .filter_map(|(tick, state)| Some((Tick::from_usize(tick), state.as_ref()?)))
    }

    /// Returns a mutable iterator over each present tick and its state, in order.
    pub fn states_mut(&mut self) -> impl Iterator<Item = (Tick, &mut TickState)> {
        self.states
            .iter_mut()
            .enumerate()
            .filter_map(|(tick, state)| Some((Tick::from_usize(tick), state.as_mut()?)))
    }

    /// Moves every recorded tick and its events forward by `offset` ticks,
    /// growing the timeline by that length and leaving vacant ticks at the
    /// start.
    pub fn shift(&mut self, offset: Ticks) {
        let mut shifted = vec![None; offset.0 as usize];
        shifted.append(&mut self.states);
        self.states = shifted;

        for (_, state) in self.states_mut() {
            for event in &mut state.events {
                event.kind.remap_ticks(|tick| tick + offset);
            }
        }
    }
}

/// The state of the world on a single tick alongside the events that occurred.
#[derive(Debug, Clone)]
pub struct TickState {
    pub players: Players,
    pub npcs: BTreeMap<RoomId, NpcState>,
    pub objects: TickObjects,
    pub events: Vec<Event>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        Actor, BloatDown, ClientId, EventKind, NpcAttack, NpcAttacked, PartyIndex, Point,
        PrayerBook, PrayerSet, SkillLevel, Source, VerzikBounce,
    };

    #[test]
    fn timeline_tick_access() {
        let mut timeline = Timeline::vacant(Tick(3));
        assert_eq!(timeline.last_tick(), Tick(3));
        assert!(
            Tick(3)
                .up_to_inclusive()
                .all(|t| timeline.get_state(t).is_none())
        );
        assert!(timeline.get_state(Tick(4)).is_none());

        timeline.set_state(
            Tick(1),
            TickState {
                players: Players::empty(1),
                npcs: BTreeMap::new(),
                objects: TickObjects::default(),
                events: Vec::new(),
            },
        );
        assert!(timeline.get_state(Tick(0)).is_none());
        assert!(timeline.get_state(Tick(1)).is_some());
        assert!(timeline.get_state(Tick(2)).is_none());
        assert_eq!(timeline.last_tick(), Tick(3));

        assert!(timeline.get_state_mut(Tick(0)).is_none());
        assert!(timeline.get_state_mut(Tick(4)).is_none());
        timeline
            .get_state_mut(Tick(1))
            .unwrap()
            .events
            .push(Event::synthetic(EventKind::BloatUp));
        assert!(matches!(
            timeline.get_state(Tick(1)).unwrap().events.as_slice(),
            [Event {
                source: Source::Synthetic,
                kind: EventKind::BloatUp,
            }]
        ));

        timeline.set_state(
            Tick(3),
            TickState {
                players: Players::empty(1),
                npcs: BTreeMap::new(),
                objects: TickObjects::default(),
                events: Vec::new(),
            },
        );
        assert_eq!(
            timeline
                .states()
                .map(|(tick, state)| (tick, state.events.len()))
                .collect::<Vec<_>>(),
            [(Tick(1), 1), (Tick(3), 0)]
        );

        for (tick, state) in timeline.states_mut() {
            if tick == Tick(3) {
                state
                    .events
                    .push(Event::synthetic(EventKind::BloatDown(BloatDown {
                        down_number: 1,
                        up_ticks: Ticks(2),
                    })));
            }
        }
        assert_eq!(
            timeline
                .states()
                .map(|(tick, state)| (tick, state.events.len()))
                .collect::<Vec<_>>(),
            [(Tick(1), 1), (Tick(3), 1)]
        );
    }

    #[test]
    #[should_panic(expected = "index out of bounds")]
    fn timeline_set_beyond_last_tick() {
        let mut timeline = Timeline::vacant(Tick(3));
        timeline.set_state(
            Tick(4),
            TickState {
                players: Players::empty(1),
                npcs: BTreeMap::new(),
                objects: TickObjects::default(),
                events: Vec::new(),
            },
        );
    }

    #[test]
    fn timeline_shift() {
        let mut timeline = Timeline::vacant(Tick(5));
        timeline.set_state(
            Tick(2),
            TickState {
                players: Players::empty(1),
                npcs: BTreeMap::from([(
                    RoomId(1),
                    NpcState {
                        source: Source::Client(ClientId(1)),
                        npc_id: 8372,
                        position: Point(3166, 4324),
                        hitpoints: SkillLevel {
                            current: 1180,
                            base: 1500,
                        },
                        prayers: PrayerSet::empty(PrayerBook::Normal),
                        properties: None,
                    },
                )]),
                objects: TickObjects::default(),
                events: vec![Event::recorded(
                    ClientId(1),
                    EventKind::NpcAttack(NpcAttacked {
                        npc: RoomId(1),
                        attack: NpcAttack::TobVerzikP2Bounce,
                        target: Some(Actor::Player(PartyIndex::from_usize(0))),
                    }),
                )],
            },
        );
        timeline.set_state(
            Tick(3),
            TickState {
                players: Players::empty(1),
                npcs: BTreeMap::new(),
                objects: TickObjects::default(),
                events: vec![Event::recorded(
                    ClientId(1),
                    EventKind::VerzikBounce(VerzikBounce {
                        attack_tick: Tick(2),
                        players_in_range: 1,
                        bounced: Some(PartyIndex::from_usize(0)),
                    }),
                )],
            },
        );

        timeline.shift(Ticks(3));

        assert_eq!(timeline.last_tick(), Tick(8));
        assert_eq!(
            timeline.states().map(|(tick, _)| tick).collect::<Vec<_>>(),
            [Tick(5), Tick(6)]
        );

        let state = timeline.get_state(Tick(5)).unwrap();
        assert_eq!(state.npcs[&RoomId(1)].npc_id, 8372);
        assert!(matches!(
            state.events.as_slice(),
            [Event {
                source: Source::Client(ClientId(1)),
                kind: EventKind::NpcAttack(NpcAttacked {
                    attack: NpcAttack::TobVerzikP2Bounce,
                    ..
                }),
            }]
        ));

        let state = timeline.get_state(Tick(6)).unwrap();
        assert!(matches!(
            state.events.as_slice(),
            [Event {
                source: Source::Client(ClientId(1)),
                kind: EventKind::VerzikBounce(VerzikBounce {
                    attack_tick: Tick(5),
                    players_in_range: 1,
                    bounced: Some(_),
                }),
            }]
        ));
    }
}

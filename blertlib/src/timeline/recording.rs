use std::collections::BTreeMap;

use crate::actor::Rsn;
use crate::event::Event;
use crate::tick::{Tick, Ticks};
use crate::{ChallengeMode, Stage};

use super::{TickState, Timeline, finalize};

/// A `Recording` represents a mutable model of a challenge stage as observed by
/// one or more clients. It is a nonempty, chronological sequence of ticks, each
/// storing the state of the world on that tick alongside the events that
/// occurred.
///
/// As a `Recording` is intended to be modified, it does not store events which
/// are derivable from world state. Once mutation is complete, the recording is
/// finalized into an immutable `Timeline`, deriving the remaining events.
#[derive(Debug, Clone)]
pub struct Recording {
    stage: Stage,
    mode: ChallengeMode,
    party: Vec<Rsn>,
    states: Vec<Option<TickState>>,
}

impl Recording {
    /// Creates a recording spanning to `last_tick` without any state or events.
    #[must_use]
    pub fn vacant(stage: Stage, mode: ChallengeMode, party: Vec<Rsn>, last_tick: Tick) -> Self {
        Self {
            stage,
            mode,
            party,
            states: vec![None; last_tick.as_usize() + 1],
        }
    }

    /// Returns the recorded stage.
    #[must_use]
    pub fn stage(&self) -> Stage {
        self.stage
    }

    /// Returns the mode of the challenge.
    #[must_use]
    pub fn mode(&self) -> ChallengeMode {
        self.mode
    }

    /// Returns the challenge's party in orb order.
    #[must_use]
    pub fn party(&self) -> &[Rsn] {
        &self.party
    }

    /// Returns the highest recorded tick number.
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
    /// Panics if `tick` is beyond the recording's last tick.
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

    /// Returns an iterator over the events occurring on `tick`.
    pub fn events_for_tick(&self, tick: Tick) -> impl Iterator<Item = &Event> {
        self.get_state(tick)
            .into_iter()
            .flat_map(|state| state.events.iter())
    }

    /// Grows the recording to span to inclusive `last_tick`, adding empty ticks
    /// at the end. Does nothing if the recording is at or beyond that length.
    pub fn extend_to(&mut self, last_tick: Tick) {
        if self.last_tick() < last_tick {
            self.states.resize(last_tick.as_usize() + 1, None);
        }
    }

    /// Moves every recorded tick and its events forward by `offset` ticks,
    /// growing the recording by that length and leaving vacant ticks at the
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

    /// Finalizes the recording into a [`Timeline`].
    #[must_use]
    pub fn finalize(self) -> Timeline {
        let mut timeline = Timeline {
            stage: self.stage,
            mode: self.mode,
            party: self.party,
            states: self.states,
            npcs: BTreeMap::new(),
        };
        finalize::finalize_from(&mut timeline, Tick(0));
        timeline
    }

    /// Finalizes a copy of the recording into a [`Timeline`], leaving the
    /// recording as it is.
    #[must_use]
    pub fn snapshot(&self) -> Timeline {
        self.clone().finalize()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        Actor, BloatDown, ClientId, EventKind, NpcAttack, NpcAttacked, NpcState, PartyIndex,
        Players, Point, PrayerBook, PrayerSet, Rect, RoomId, SkillLevel, Source, TickObjects,
        VerzikBounce, XarpusPhase,
    };

    #[test]
    fn recording_tick_access() {
        let mut recording = Recording::vacant(
            Stage::TobBloat,
            ChallengeMode::TobRegular,
            vec![Rsn::try_from("TobDataEgirl").unwrap()],
            Tick(3),
        );
        assert_eq!(recording.last_tick(), Tick(3));
        assert!(
            Tick(3)
                .up_to_inclusive()
                .all(|t| recording.get_state(t).is_none())
        );
        assert!(recording.get_state(Tick(4)).is_none());

        recording.set_state(
            Tick(1),
            TickState {
                players: Players::empty(1),
                npcs: BTreeMap::new(),
                objects: TickObjects::default(),
                events: Vec::new(),
            },
        );
        assert!(recording.get_state(Tick(0)).is_none());
        assert!(recording.get_state(Tick(1)).is_some());
        assert!(recording.get_state(Tick(2)).is_none());
        assert_eq!(recording.last_tick(), Tick(3));

        assert!(recording.get_state_mut(Tick(0)).is_none());
        assert!(recording.get_state_mut(Tick(4)).is_none());
        recording
            .get_state_mut(Tick(1))
            .unwrap()
            .events
            .push(Event::synthetic(EventKind::BloatUp));
        assert!(matches!(
            recording.get_state(Tick(1)).unwrap().events.as_slice(),
            [Event {
                source: Source::Synthetic,
                kind: EventKind::BloatUp,
            }]
        ));

        recording.set_state(
            Tick(3),
            TickState {
                players: Players::empty(1),
                npcs: BTreeMap::new(),
                objects: TickObjects::default(),
                events: Vec::new(),
            },
        );
        assert_eq!(
            recording
                .states()
                .map(|(tick, state)| (tick, state.events.len()))
                .collect::<Vec<_>>(),
            [(Tick(1), 1), (Tick(3), 0)]
        );

        for (tick, state) in recording.states_mut() {
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
            recording
                .states()
                .map(|(tick, state)| (tick, state.events.len()))
                .collect::<Vec<_>>(),
            [(Tick(1), 1), (Tick(3), 1)]
        );

        assert_eq!(
            recording.events_for_tick(Tick(3)).collect::<Vec<_>>(),
            [&Event::synthetic(EventKind::BloatDown(BloatDown {
                down_number: 1,
                up_ticks: Ticks(2),
            }))]
        );
        assert_eq!(recording.events_for_tick(Tick(1)).count(), 1);
        assert_eq!(recording.events_for_tick(Tick(2)).count(), 0);
        assert_eq!(recording.events_for_tick(Tick(4)).count(), 0);
    }

    #[test]
    #[should_panic(expected = "index out of bounds")]
    fn recording_set_beyond_last_tick() {
        let mut recording = Recording::vacant(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            vec![Rsn::try_from("TobDataEgirl").unwrap()],
            Tick(3),
        );
        recording.set_state(
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
    fn recording_extend_to() {
        let mut recording = Recording::vacant(
            Stage::TobXarpus,
            ChallengeMode::TobHard,
            vec![
                Rsn::try_from("1Ogp").unwrap(),
                Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
            ],
            Tick(3),
        );
        recording.set_state(
            Tick(2),
            TickState {
                players: Players::empty(2),
                npcs: BTreeMap::new(),
                objects: TickObjects::default(),
                events: vec![Event::recorded(
                    ClientId(14),
                    EventKind::XarpusPhase(XarpusPhase::XarpusP2),
                )],
            },
        );

        recording.extend_to(Tick(7));
        assert_eq!(recording.last_tick(), Tick(7));
        assert_eq!(
            recording.states().map(|(tick, _)| tick).collect::<Vec<_>>(),
            [Tick(2)]
        );
        assert_eq!(recording.events_for_tick(Tick(2)).count(), 1);

        recording.extend_to(Tick(5));
        assert_eq!(recording.last_tick(), Tick(7));
        recording.extend_to(Tick(7));
        assert_eq!(recording.last_tick(), Tick(7));
    }

    #[test]
    fn recording_shift() {
        let mut recording = Recording::vacant(
            Stage::TobVerzik,
            ChallengeMode::TobRegular,
            vec![Rsn::try_from("TobDataEgirl").unwrap()],
            Tick(5),
        );
        recording.set_state(
            Tick(2),
            TickState {
                players: Players::empty(1),
                npcs: BTreeMap::from([(
                    RoomId(1),
                    NpcState {
                        source: Source::Client(ClientId(1)),
                        npc_id: 8372,
                        position: Rect::square(Point(3166, 4324), 3),
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
        recording.set_state(
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

        recording.shift(Ticks(3));

        assert_eq!(recording.last_tick(), Tick(8));
        assert_eq!(
            recording.states().map(|(tick, _)| tick).collect::<Vec<_>>(),
            [Tick(5), Tick(6)]
        );

        let state = recording.get_state(Tick(5)).unwrap();
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

        let state = recording.get_state(Tick(6)).unwrap();
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

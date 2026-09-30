//! State representation and operations on a recording of a challenge stage.

use std::collections::BTreeMap;

use crate::actor::{NpcState, Players, RoomId};
use crate::event::Event;
use crate::objects::TickObjects;
use crate::tick::Tick;
use crate::{ChallengeMode, Stage};

mod builder;
mod finalize;
mod recording;

pub use builder::{
    BuildRejection, BuildWarning, FieldError, RawActor, RecordingBuilder, RejectionReason,
};

pub use recording::Recording;

/// The state of the world on a single tick alongside the events that occurred.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TickState {
    pub players: Players,
    pub npcs: BTreeMap<RoomId, NpcState>,
    pub objects: TickObjects,
    pub events: Vec<Event>,
}

#[derive(Debug)]
pub struct Timeline {
    stage: Stage,
    mode: ChallengeMode,
    party: Vec<String>,
    states: Vec<Option<TickState>>,
}

impl Timeline {
    /// Returns the stage recorded in this timeline.
    #[must_use]
    pub fn stage(&self) -> &Stage {
        &self.stage
    }

    /// Returns the mode of the recorded challenge.
    #[must_use]
    pub fn mode(&self) -> &ChallengeMode {
        &self.mode
    }

    /// Returns the party of the recorded challenge.
    #[must_use]
    pub fn party(&self) -> &[String] {
        &self.party
    }

    /// Returns the last recorded tick in the timeline.
    #[must_use]
    pub fn last_tick(&self) -> Tick {
        Tick::from_usize(self.states.len() - 1)
    }

    /// Returns the number of ticks without any recorded state.
    #[must_use]
    pub fn missing_tick_count(&self) -> usize {
        self.states.iter().filter(|state| state.is_none()).count()
    }

    /// Returns the state of the world on `tick`.
    #[must_use]
    pub fn get_state(&self, tick: Tick) -> Option<&TickState> {
        self.states.get(tick.as_usize())?.as_ref()
    }

    /// Returns an iterator over each event in the timeline with its tick.
    pub fn events(&self) -> impl Iterator<Item = (Tick, &Event)> {
        self.states
            .iter()
            .enumerate()
            .filter_map(|(tick, state)| state.as_ref().map(|state| (Tick::from_usize(tick), state)))
            .flat_map(|(tick, state)| state.events.iter().map(move |event| (tick, event)))
    }

    /// Returns the events recorded on `tick` or an empty slice if none occurred.
    #[must_use]
    pub fn events_for_tick(&self, tick: Tick) -> &[Event] {
        self.get_state(tick)
            .map(|state| state.events.as_slice())
            .unwrap_or_default()
    }

    /// Returns whether this timeline is compatible with the given recording.
    #[must_use]
    pub fn is_compatible(&self, recording: &Recording) -> bool {
        self.stage == recording.stage()
            && self.mode == recording.mode()
            && self.party == recording.party()
    }

    /// Replaces every tick starting at `from` with state from a recording,
    /// growing the timeline if the recording has grown.
    pub fn refresh(&mut self, recording: &Recording, from: Tick) {
        if !self.is_compatible(recording) || from > recording.last_tick() {
            return;
        }

        self.states.truncate(from.as_usize());
        let start = Tick::from_usize(self.states.len());
        self.states.extend(
            start
                .through(recording.last_tick())
                .map(|tick| recording.get_state(tick).cloned()),
        );
        finalize::finalize_from(self.stage, self.mode, &mut self.states, start);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{BloatDown, ClientId, EventKind, Ticks};

    #[test]
    fn timeline_accessors() {
        let timeline = Timeline {
            stage: Stage::TobBloat,
            mode: ChallengeMode::TobHard,
            party: vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()],
            states: vec![
                None,
                Some(TickState {
                    players: Players::empty(2),
                    npcs: BTreeMap::new(),
                    objects: TickObjects::default(),
                    events: vec![Event::recorded(ClientId(7), EventKind::BloatUp)],
                }),
                Some(TickState {
                    players: Players::empty(2),
                    npcs: BTreeMap::new(),
                    objects: TickObjects::default(),
                    events: Vec::new(),
                }),
                None,
                Some(TickState {
                    players: Players::empty(2),
                    npcs: BTreeMap::new(),
                    objects: TickObjects::default(),
                    events: vec![Event::recorded(
                        ClientId(7),
                        EventKind::BloatDown(BloatDown {
                            down_number: 2,
                            up_ticks: Ticks(3),
                        }),
                    )],
                }),
                None,
            ],
        };

        assert_eq!(timeline.stage(), &Stage::TobBloat);
        assert_eq!(timeline.mode(), &ChallengeMode::TobHard);
        assert_eq!(timeline.party(), ["1Ogp", "WWWWWWWWWWQQ"]);
        assert_eq!(timeline.last_tick(), Tick(5));
        assert_eq!(timeline.missing_tick_count(), 3);

        assert_eq!(timeline.get_state(Tick(0)), None);
        assert_eq!(
            timeline.get_state(Tick(2)),
            Some(&TickState {
                players: Players::empty(2),
                npcs: BTreeMap::new(),
                objects: TickObjects::default(),
                events: Vec::new(),
            })
        );
        assert_eq!(
            timeline.get_state(Tick(4)),
            Some(&TickState {
                players: Players::empty(2),
                npcs: BTreeMap::new(),
                objects: TickObjects::default(),
                events: vec![Event::recorded(
                    ClientId(7),
                    EventKind::BloatDown(BloatDown {
                        down_number: 2,
                        up_ticks: Ticks(3),
                    }),
                )],
            })
        );
        assert_eq!(timeline.get_state(Tick(6)), None);

        assert_eq!(
            timeline.events().collect::<Vec<_>>(),
            [
                (Tick(1), &Event::recorded(ClientId(7), EventKind::BloatUp)),
                (
                    Tick(4),
                    &Event::recorded(
                        ClientId(7),
                        EventKind::BloatDown(BloatDown {
                            down_number: 2,
                            up_ticks: Ticks(3),
                        }),
                    )
                ),
            ]
        );

        assert_eq!(
            timeline.events_for_tick(Tick(1)),
            [Event::recorded(ClientId(7), EventKind::BloatUp)]
        );
        assert_eq!(timeline.events_for_tick(Tick(2)), []);
        assert_eq!(timeline.events_for_tick(Tick(3)), []);
        assert_eq!(timeline.events_for_tick(Tick(6)), []);
    }
}

//! State representation and operations on a recording of a challenge stage.

use std::collections::BTreeMap;

use crate::actor::{Actor, NpcProperties, NpcState, PartyIndex, Players, RoomId, Rsn};
use crate::event::{Event, Maze};
use crate::objects::TickObjects;
use crate::tick::{Tick, Ticks};
use crate::{ChallengeMode, PlayerAttack, Point, Stage, proto};

mod builder;
mod config;
mod encode;
mod finalize;
mod interpret;
mod recording;

use interpret::{RawNpc, RawObjects};

pub(crate) use interpret::OcellusProperties;

pub use builder::{
    BuildMismatch, BuildRejection, BuildWarning, FieldError, Modified, RawActor, RecordingBuilder,
    RejectionReason, WarningReason,
};
pub use config::{ConfigVersion, InvalidVersion};
pub use recording::Recording;

/// The state of the world on a single tick alongside the events that occurred.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TickState {
    pub players: Players,
    pub npcs: BTreeMap<RoomId, NpcState>,
    pub objects: TickObjects,
    pub(crate) raw_objects: RawObjects,
    pub(crate) raw_npcs: BTreeMap<RoomId, RawNpc>,
    pub events: Vec<Event>,
}

impl TickState {
    /// Returns true if `actor` was recorded on the tick.
    #[must_use]
    pub fn has_actor(&self, actor: Actor) -> bool {
        match actor {
            Actor::Npc(room_id) => self.npcs.contains_key(&room_id),
            Actor::Player(player) => self.players.get(player).is_some(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StageNpc {
    pub spawn: Tick,
    pub death: Option<Tick>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SoteMazePivots {
    pub overworld: Vec<Point>,
    pub underworld: Vec<Point>,
}

/// Information about a recording that exists at the stage level instead of
/// occurring on a specific tick.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StageData {
    None,
    Sotetseg {
        mazes: BTreeMap<Maze, SoteMazePivots>,
    },
    Inferno {
        /// The plugin sends a wave start on tick 0 of each wave with its own
        /// accounting of the ticks elapsed since the start of the challenge,
        /// including inter-wave gaps. Not sent if the player ever logs out
        /// since the clock is no longer monotonic.
        wave_start: Ticks,
    },
}

impl StageData {
    fn normalize(&mut self) {
        match self {
            Self::None | Self::Inferno { .. } => {}
            Self::Sotetseg { mazes } => {
                for pivots in mazes.values_mut() {
                    pivots.overworld.sort_by_key(|point| point.1);
                    pivots.underworld.sort_by_key(|point| point.1);
                }
            }
        }
    }
}

#[derive(Debug)]
pub struct Timeline {
    stage: Stage,
    mode: ChallengeMode,
    party: Vec<Rsn>,
    states: Vec<Option<TickState>>,
    npcs: BTreeMap<RoomId, StageNpc>,
    stage_data: StageData,
}

impl Timeline {
    /// Returns the stage recorded in this timeline.
    #[must_use]
    pub fn stage(&self) -> Stage {
        self.stage
    }

    /// Returns the mode of the recorded challenge.
    #[must_use]
    pub fn mode(&self) -> ChallengeMode {
        self.mode
    }

    /// Returns the party of the recorded challenge.
    #[must_use]
    pub fn party(&self) -> &[Rsn] {
        &self.party
    }

    /// Returns the party index of `rsn`, or `None` if they are not in the party.
    #[must_use]
    pub fn party_index(&self, rsn: &Rsn) -> Option<PartyIndex> {
        PartyIndex::resolve(&self.party, rsn.as_str())
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

    /// Returns stage-level information about an NPC.
    #[must_use]
    pub fn npc(&self, room_id: RoomId) -> Option<StageNpc> {
        self.npcs.get(&room_id).copied()
    }

    /// Returns stage-level information about every recorded NPC.
    pub fn npcs(&self) -> impl Iterator<Item = (RoomId, StageNpc)> {
        self.npcs.iter().map(|(&room_id, &npc)| (room_id, npc))
    }

    /// Returns data recorded for the stage as a whole.
    #[must_use]
    pub fn stage_data(&self) -> &StageData {
        &self.stage_data
    }

    /// Returns whether this timeline is compatible with the given recording.
    #[must_use]
    pub fn is_compatible(&self, recording: &Recording) -> bool {
        self.stage == recording.stage()
            && self.mode == recording.mode()
            && self.party == recording.party()
    }

    /// Replaces every tick starting at `modified.from_tick` with state from a
    /// recording, growing the timeline if the recording has grown. Copies the
    /// recording's stage data if it was modified.
    pub fn refresh(&mut self, recording: &Recording, modified: Modified) {
        if !self.is_compatible(recording) {
            return;
        }

        if modified.stage_data {
            self.stage_data = recording.stage_data().clone();
            self.stage_data.normalize();
        }

        if let Some(from) = modified.from_tick
            && from <= recording.last_tick()
        {
            self.states.truncate(from.as_usize());
            let start = Tick::from_usize(self.states.len());
            self.states.extend(
                start
                    .through(recording.last_tick())
                    .map(|tick| recording.get_state(tick).cloned()),
            );
            finalize::finalize_from(self, start);
        }
    }

    /// Encodes the full timeline as wire events in tick order.
    pub fn to_proto(&self) -> impl Iterator<Item = proto::Event> {
        self.to_proto_from(Tick(0))
    }

    /// Encodes the timeline from `start` onward as wire events in tick order.
    pub fn to_proto_from(&self, start: Tick) -> impl Iterator<Item = proto::Event> {
        encode::encode_from(self, start)
    }
}

/// Tracks the cooldowns of players in a party.
pub struct PlayerCooldowns {
    cooldowns: Vec<Tick>,
}

impl PlayerCooldowns {
    /// Creates a new `PlayerCooldowns` for a party of `size`.
    #[must_use]
    pub fn new(party_size: usize) -> Self {
        Self {
            cooldowns: vec![Tick(0); party_size],
        }
    }

    /// Returns `true` if `player` can perform `attack` on `target` on the given tick.
    #[must_use]
    pub fn can_attack(
        &self,
        player: PartyIndex,
        tick: Tick,
        state: &TickState,
        attack: PlayerAttack,
        target: Option<Actor>,
    ) -> bool {
        let checks_cooldown = match target {
            _ if state.npcs.values().any(|npc| {
                matches!(
                    &npc.properties,
                    Some(NpcProperties::Ocellus(OcellusProperties::P4(p4)))
                        if p4.attacks_ignore_cooldown(tick)
                )
            }) =>
            {
                false
            }
            Some(Actor::Npc(room_id)) => state
                .npcs
                .get(&room_id)
                .is_none_or(|target| target.attack_checks_cooldown(attack)),
            _ => true,
        };
        !checks_cooldown || tick >= self.off_cooldown_tick(player)
    }

    /// Updates the cooldown of `player` following them performing `attack` on `target`.
    pub fn track_attack(
        &mut self,
        player: PartyIndex,
        tick: Tick,
        state: &TickState,
        attack: PlayerAttack,
        target: Option<Actor>,
    ) {
        if let Some(Actor::Npc(room_id)) = target
            && let Some(target) = state.npcs.get(&room_id)
            && !target.attack_applies_cooldown(attack)
        {
            return;
        }
        self.cooldowns[player.as_usize()] = tick + attack.cooldown();
    }

    /// Returns the tick on which `player` will be off cooldown.
    #[must_use]
    pub fn off_cooldown_tick(&self, player: PartyIndex) -> Tick {
        self.cooldowns[player.as_usize()]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::item::EQUIPMENT_SLOTS;
    use crate::{
        BloatDown, ClientId, DataSource, EventKind, MaidenCrab, MaidenCrabPosition,
        MaidenCrabSpawn, NpcDeath, NpcProperties, PlayerState, Point, PrayerBook, PrayerSet, Rect,
        SkillLevel, Source, Ticks,
    };

    #[test]
    fn timeline_accessors() {
        let timeline = Timeline {
            stage: Stage::TobBloat,
            mode: ChallengeMode::TobHard,
            party: vec![
                Rsn::try_from("1Ogp").unwrap(),
                Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
            ],
            states: vec![
                None,
                Some(TickState {
                    players: Players::empty(2),
                    npcs: BTreeMap::new(),
                    objects: TickObjects::default(),
                    raw_objects: RawObjects::default(),
                    raw_npcs: BTreeMap::new(),
                    events: vec![Event::recorded(ClientId(7), EventKind::BloatUp)],
                }),
                Some(TickState {
                    players: Players::empty(2),
                    npcs: BTreeMap::new(),
                    objects: TickObjects::default(),
                    raw_objects: RawObjects::default(),
                    raw_npcs: BTreeMap::new(),
                    events: Vec::new(),
                }),
                None,
                Some(TickState {
                    players: Players::empty(2),
                    npcs: BTreeMap::new(),
                    objects: TickObjects::default(),
                    raw_objects: RawObjects::default(),
                    raw_npcs: BTreeMap::new(),
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
            npcs: BTreeMap::new(),
            stage_data: StageData::None,
        };

        assert_eq!(timeline.stage(), Stage::TobBloat);
        assert_eq!(timeline.mode(), ChallengeMode::TobHard);
        assert_eq!(timeline.party(), ["1Ogp", "WWWWWWWWWWQQ"]);
        assert_eq!(
            timeline.party_index(&Rsn::try_from("WWWWWWWWWWQQ").unwrap()),
            Some(PartyIndex(1))
        );
        assert_eq!(
            timeline.party_index(&Rsn::try_from("TobDataEgirl").unwrap()),
            None
        );
        assert_eq!(timeline.last_tick(), Tick(5));
        assert_eq!(timeline.missing_tick_count(), 3);

        assert_eq!(timeline.get_state(Tick(0)), None);
        assert_eq!(
            timeline.get_state(Tick(2)),
            Some(&TickState {
                players: Players::empty(2),
                npcs: BTreeMap::new(),
                objects: TickObjects::default(),
                raw_objects: RawObjects::default(),
                raw_npcs: BTreeMap::new(),
                events: Vec::new(),
            })
        );
        assert_eq!(
            timeline.get_state(Tick(4)),
            Some(&TickState {
                players: Players::empty(2),
                npcs: BTreeMap::new(),
                objects: TickObjects::default(),
                raw_objects: RawObjects::default(),
                raw_npcs: BTreeMap::new(),
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

    #[test]
    fn timeline_npcs() {
        let mut recording = Recording::vacant(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            vec![
                Rsn::try_from("Sacolyn").unwrap(),
                Rsn::try_from("715").unwrap(),
                Rsn::try_from("1Ogp").unwrap(),
                Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
            ],
            Tick(69),
        );
        recording.set_state(
            Tick(0),
            TickState {
                players: Players::empty(4),
                npcs: BTreeMap::from([(
                    RoomId(64386),
                    NpcState {
                        source: Source::Synthetic,
                        id: 8360,
                        position: Rect::square(Point(3162, 4444), 6),
                        hitpoints: SkillLevel {
                            current: 3062,
                            base: 3062,
                        },
                        prayers: PrayerSet::empty(PrayerBook::Normal),
                        properties: None,
                    },
                )]),
                objects: TickObjects::default(),
                raw_objects: RawObjects::default(),
                raw_npcs: BTreeMap::new(),
                events: Vec::new(),
            },
        );
        recording.set_state(
            Tick(32),
            TickState {
                players: Players::empty(4),
                npcs: BTreeMap::from([
                    (
                        RoomId(64386),
                        NpcState {
                            source: Source::Client(ClientId(344)),
                            id: 8361,
                            position: Rect::square(Point(3162, 4444), 6),
                            hitpoints: SkillLevel {
                                current: 2078,
                                base: 3062,
                            },
                            prayers: PrayerSet::empty(PrayerBook::Normal),
                            properties: None,
                        },
                    ),
                    (
                        RoomId(64745),
                        NpcState {
                            source: Source::Client(ClientId(344)),
                            id: 8366,
                            position: Rect::square(Point(3177, 4456), 2),
                            hitpoints: SkillLevel {
                                current: 87,
                                base: 87,
                            },
                            prayers: PrayerSet::empty(PrayerBook::Normal),
                            properties: Some(NpcProperties::MaidenCrab(MaidenCrab {
                                spawn: MaidenCrabSpawn::Seventies,
                                position: MaidenCrabPosition::N2,
                                scuffed: false,
                            })),
                        },
                    ),
                ]),
                objects: TickObjects::default(),
                raw_objects: RawObjects::default(),
                raw_npcs: BTreeMap::new(),
                events: Vec::new(),
            },
        );
        recording.set_state(
            Tick(68),
            TickState {
                players: Players::empty(4),
                npcs: BTreeMap::from([
                    (
                        RoomId(64386),
                        NpcState {
                            source: Source::Client(ClientId(344)),
                            id: 8362,
                            position: Rect::square(Point(3162, 4444), 6),
                            hitpoints: SkillLevel {
                                current: 1343,
                                base: 3062,
                            },
                            prayers: PrayerSet::empty(PrayerBook::Normal),
                            properties: None,
                        },
                    ),
                    (
                        RoomId(64745),
                        NpcState {
                            source: Source::Client(ClientId(344)),
                            id: 8366,
                            position: Rect::square(Point(3171, 4450), 2),
                            hitpoints: SkillLevel {
                                current: 0,
                                base: 87,
                            },
                            prayers: PrayerSet::empty(PrayerBook::Normal),
                            properties: Some(NpcProperties::MaidenCrab(MaidenCrab {
                                spawn: MaidenCrabSpawn::Seventies,
                                position: MaidenCrabPosition::N2,
                                scuffed: false,
                            })),
                        },
                    ),
                ]),
                objects: TickObjects::default(),
                raw_objects: RawObjects::default(),
                raw_npcs: BTreeMap::new(),
                events: Vec::new(),
            },
        );
        recording.set_state(
            Tick(69),
            TickState {
                players: Players::empty(4),
                npcs: BTreeMap::from([(
                    RoomId(64386),
                    NpcState {
                        source: Source::Client(ClientId(344)),
                        id: 8362,
                        position: Rect::square(Point(3162, 4444), 6),
                        hitpoints: SkillLevel {
                            current: 1343,
                            base: 3062,
                        },
                        prayers: PrayerSet::empty(PrayerBook::Normal),
                        properties: None,
                    },
                )]),
                objects: TickObjects::default(),
                raw_objects: RawObjects::default(),
                raw_npcs: BTreeMap::new(),
                events: vec![Event::recorded(
                    ClientId(344),
                    EventKind::NpcDeath(NpcDeath {
                        position: Point(3171, 4450),
                        npc: RoomId(64745),
                        npc_id: Some(8366),
                    }),
                )],
            },
        );

        let timeline = recording.finalize();

        assert_eq!(
            timeline.npc(RoomId(64386)),
            Some(StageNpc {
                spawn: Tick(0),
                death: None,
            })
        );
        assert_eq!(
            timeline.npc(RoomId(64745)),
            Some(StageNpc {
                spawn: Tick(32),
                death: Some(Tick(69)),
            })
        );
        assert_eq!(timeline.npc(RoomId(64744)), None);
        assert_eq!(
            timeline.npcs().collect::<Vec<_>>(),
            [
                (
                    RoomId(64386),
                    StageNpc {
                        spawn: Tick(0),
                        death: None,
                    }
                ),
                (
                    RoomId(64745),
                    StageNpc {
                        spawn: Tick(32),
                        death: Some(Tick(69)),
                    }
                ),
            ]
        );
    }

    #[test]
    fn tick_state_has_actor() {
        let mut players = Players::empty(3);
        players[PartyIndex(1)] = Some(PlayerState {
            source: Source::Client(ClientId(52)),
            position: Point(3166, 4441),
            equipment: [None; EQUIPMENT_SLOTS],
            prayers: PrayerSet::empty(PrayerBook::Normal),
            data: DataSource::Secondary,
        });
        let state = TickState {
            players,
            npcs: BTreeMap::from([(
                RoomId(64386),
                NpcState {
                    source: Source::Client(ClientId(52)),
                    id: 8360,
                    position: Rect::square(Point(3162, 4444), 6),
                    hitpoints: SkillLevel {
                        current: 3062,
                        base: 3062,
                    },
                    prayers: PrayerSet::empty(PrayerBook::Normal),
                    properties: None,
                },
            )]),
            objects: TickObjects::default(),
            raw_objects: RawObjects::default(),
            raw_npcs: BTreeMap::new(),
            events: Vec::new(),
        };

        assert!(state.has_actor(Actor::Player(PartyIndex(1))));
        assert!(!state.has_actor(Actor::Player(PartyIndex(2))));
        assert!(state.has_actor(Actor::Npc(RoomId(64386))));
        assert!(!state.has_actor(Actor::Npc(RoomId(64745))));
    }

    #[test]
    fn stage_data_normalize() {
        let mut stage_data = StageData::Sotetseg {
            mazes: BTreeMap::from([(
                Maze::Maze66,
                SoteMazePivots {
                    overworld: vec![
                        Point(7, 10),
                        Point(8, 0),
                        Point(2, 8),
                        Point(11, 4),
                        Point(7, 12),
                        Point(8, 2),
                        Point(7, 6),
                    ],
                    underworld: vec![
                        Point(3, 14),
                        Point(8, 2),
                        Point(7, 6),
                        Point(8, 0),
                        Point(7, 12),
                        Point(11, 4),
                        Point(7, 10),
                        Point(2, 8),
                    ],
                },
            )]),
        };

        stage_data.normalize();

        assert_eq!(
            stage_data,
            StageData::Sotetseg {
                mazes: BTreeMap::from([(
                    Maze::Maze66,
                    SoteMazePivots {
                        overworld: vec![
                            Point(8, 0),
                            Point(8, 2),
                            Point(11, 4),
                            Point(7, 6),
                            Point(2, 8),
                            Point(7, 10),
                            Point(7, 12),
                        ],
                        underworld: vec![
                            Point(8, 0),
                            Point(8, 2),
                            Point(11, 4),
                            Point(7, 6),
                            Point(2, 8),
                            Point(7, 10),
                            Point(7, 12),
                            Point(3, 14),
                        ],
                    },
                )]),
            }
        );

        let copy = stage_data.clone();
        stage_data.normalize();
        assert_eq!(stage_data, copy);

        let mut none = StageData::None;
        none.normalize();
        assert_eq!(none, StageData::None);

        let mut inferno = StageData::Inferno {
            wave_start: Ticks(1216),
        };
        inferno.normalize();
        assert_eq!(
            inferno,
            StageData::Inferno {
                wave_start: Ticks(1216)
            }
        );
    }
}

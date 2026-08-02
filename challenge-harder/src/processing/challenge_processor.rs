//! Type-specific challenge processing.

#![cfg_attr(not(test), expect(dead_code))]

use std::collections::BTreeMap;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::StoredState;
use super::db;
use super::split::{ChallengeSplit, SplitType, StageSplit};
use super::stats::PlayerStatsDelta;
use crate::lifecycle::core::types::{PrimaryMeleeGear, Stage};
use crate::merging::MergedEvents;
use crate::proto::{ChallengeData, Coords, Event, challenge_data, event};

/// Read and mutation access to the stage timeline during the event loop,
/// positioned at the event being processed.
pub struct EventCursor<'a> {
    events: &'a mut MergedEvents,
    index: usize,
}

impl<'a> EventCursor<'a> {
    pub(super) fn new(events: &'a mut MergedEvents, index: usize) -> EventCursor<'a> {
        EventCursor { events, index }
    }

    /// The event being processed.
    pub fn current(&self) -> &Event {
        &self.events[self.index]
    }

    /// Returns all events occurring on `tick`.
    pub fn events_for_tick(&self, tick: u32) -> &[Event] {
        self.events.events_for_tick(tick)
    }

    /// Returns all events occurring on `tick`, mutably.
    pub fn events_for_tick_mut(&mut self, tick: u32) -> &mut [Event] {
        self.events.events_for_tick_mut(tick)
    }
}

/// An NPC tracked through a stage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomNpc {
    pub spawn_npc_id: u32,
    pub room_id: u64,
    pub spawn_tick: u32,
    pub spawn_point: (i32, i32),
    pub death_tick: u32,
    pub death_point: (i32, i32),
    pub kind: Option<event::npc::Type>,
}

impl From<&RoomNpc> for challenge_data::StageNpc {
    fn from(npc: &RoomNpc) -> challenge_data::StageNpc {
        let kind = npc.kind.map(|kind| match kind {
            event::npc::Type::Basic(()) => challenge_data::stage_npc::Type::Basic(()),
            event::npc::Type::MaidenCrab(crab) => challenge_data::stage_npc::Type::MaidenCrab(crab),
            event::npc::Type::Nylo(nylo) => challenge_data::stage_npc::Type::Nylo(nylo),
            event::npc::Type::VerzikCrab(crab) => challenge_data::stage_npc::Type::VerzikCrab(crab),
        });
        challenge_data::StageNpc {
            spawn_npc_id: npc.spawn_npc_id,
            room_id: npc.room_id,
            spawn_tick: npc.spawn_tick,
            death_tick: npc.death_tick,
            spawn_point: Some(Coords {
                x: npc.spawn_point.0,
                y: npc.spawn_point.1,
            }),
            death_point: Some(Coords {
                x: npc.death_point.0,
                y: npc.death_point.1,
            }),
            r#type: kind,
        }
    }
}

/// Data accumulated about a single party member during a processing run.
#[derive(Debug, Clone, Default)]
pub struct PlayerData {
    pub gear: Option<PrimaryMeleeGear>,
    pub stats: PlayerStatsDelta,
}

/// Challenge-scoped state accumulated by a processing run.
#[derive(Debug)]
pub struct ChallengeContext {
    party: Vec<String>,
    /// Per-player data, indexed by party position.
    players: Vec<PlayerData>,
    /// Challenge-wide splits recorded during the run.
    challenge_splits: BTreeMap<SplitType, ChallengeSplit>,
}

impl ChallengeContext {
    pub(super) fn new(party: Vec<String>) -> ChallengeContext {
        let scale = party.len();
        ChallengeContext {
            party,
            players: vec![PlayerData::default(); scale],
            challenge_splits: BTreeMap::new(),
        }
    }

    /// Returns all players' collected data, indexed by party position.
    pub(super) fn players(&self) -> &[PlayerData] {
        &self.players
    }

    /// Returns the accumulated data of the player at `party_index`.
    pub(super) fn player_mut(&mut self, party_index: usize) -> Option<&mut PlayerData> {
        self.players.get_mut(party_index)
    }

    /// Returns the index of `username` in the party.
    pub(super) fn party_index(&self, username: &str) -> Option<usize> {
        self.party.iter().position(|name| name == username)
    }

    /// Records a split whose timer spans the entire challenge.
    pub fn set_challenge_split(&mut self, split: SplitType, ticks: u32, accurate: Option<bool>) {
        if ticks > 0 {
            self.challenge_splits
                .insert(split, ChallengeSplit { ticks, accurate });
        }
    }

    /// Iterates over recorded challenge splits in split order.
    pub(super) fn challenge_splits(
        &self,
    ) -> impl Iterator<Item = (SplitType, ChallengeSplit)> + '_ {
        self.challenge_splits
            .iter()
            .map(|(&split, &entry)| (split, entry))
    }
}

/// Stage-scoped state accumulated by the event loop.
#[derive(Debug)]
pub struct StageContext {
    challenge: ChallengeContext,
    npcs: BTreeMap<u64, RoomNpc>,
    /// Party indices of players who died this stage, in death order.
    deaths: Vec<usize>,
    /// Local splits recorded within the stage.
    stage_splits: BTreeMap<SplitType, StageSplit>,
}

impl StageContext {
    pub(super) fn new(party: Vec<String>) -> StageContext {
        StageContext {
            challenge: ChallengeContext::new(party),
            npcs: BTreeMap::new(),
            deaths: Vec::new(),
            stage_splits: BTreeMap::new(),
        }
    }

    /// Returns the tracked NPC with the given room ID.
    pub fn npc(&self, room_id: u64) -> Option<&RoomNpc> {
        self.npcs.get(&room_id)
    }

    /// Returns the tracked NPC with the given room ID, mutably.
    pub(super) fn npc_mut(&mut self, room_id: u64) -> Option<&mut RoomNpc> {
        self.npcs.get_mut(&room_id)
    }

    /// Begins tracking a newly spawned NPC, keyed by its room ID.
    pub(super) fn track_npc(&mut self, npc: RoomNpc) {
        self.npcs.insert(npc.room_id, npc);
    }

    /// Iterates over every NPC tracked this stage.
    pub fn npcs(&self) -> impl Iterator<Item = &RoomNpc> {
        self.npcs.values()
    }

    /// Party indices of players who died this stage, in death order.
    pub fn deaths(&self) -> &[usize] {
        &self.deaths
    }

    /// Records the death of the player at `party_index`.
    /// Deaths of players outside the party are ignored.
    pub(super) fn record_death(&mut self, party_index: usize) {
        if party_index < self.challenge.players.len() {
            self.deaths.push(party_index);
        }
    }

    /// Returns all players' collected data, indexed by party position.
    pub(super) fn players(&self) -> &[PlayerData] {
        self.challenge.players()
    }

    /// Returns the accumulated data of the player at `party_index`.
    pub(super) fn player_mut(&mut self, party_index: usize) -> Option<&mut PlayerData> {
        self.challenge.player_mut(party_index)
    }

    /// Returns the index of `username` in the party.
    pub(super) fn party_index(&self, username: &str) -> Option<usize> {
        self.challenge.party_index(username)
    }

    /// Records a split whose timer spans the entire challenge.
    pub fn set_challenge_split(&mut self, split: SplitType, ticks: u32, accurate: Option<bool>) {
        self.challenge.set_challenge_split(split, ticks, accurate);
    }

    /// Iterates over recorded challenge splits in split order.
    pub(super) fn challenge_splits(
        &self,
    ) -> impl Iterator<Item = (SplitType, ChallengeSplit)> + '_ {
        self.challenge.challenge_splits()
    }

    /// Records a split whose timer is local to the current stage.
    ///
    /// `tick` is the tick on which the split occurred, counted as elapsed from
    /// `start`. `requires_completion` indicates whether the split lasts until
    /// the end of the stage. When set, accuracy is contingent on completion.
    ///
    /// Recording the same split again overwrites it.
    pub fn set_stage_split(
        &mut self,
        split: SplitType,
        tick: u32,
        start: u32,
        requires_completion: bool,
    ) {
        if tick > start {
            self.stage_splits.insert(
                split,
                StageSplit {
                    tick,
                    start,
                    requires_completion,
                },
            );
        }
    }

    /// Returns the recorded stage split of the given type.
    pub fn stage_split(&self, split: SplitType) -> Option<StageSplit> {
        self.stage_splits.get(&split).copied()
    }

    /// Iterates over recorded stage splits in split order.
    pub(super) fn stage_splits(&self) -> impl Iterator<Item = (SplitType, StageSplit)> + '_ {
        self.stage_splits
            .iter()
            .map(|(&split, &entry)| (split, entry))
    }
}

/// Type-specific challenge processing behavior.
#[cfg_attr(not(test), expect(dead_code))]
#[async_trait]
pub trait ChallengeProcessor: Send {
    /// Handles one event during the stage processing loop, returning whether
    /// the event should be kept for storage.
    fn process_challenge_event(
        &mut self,
        ctx: &mut StageContext,
        events: &mut EventCursor<'_>,
    ) -> bool;

    /// Invoked when the challenge's database records are created.
    async fn on_create(&mut self, txn: &db::Transaction) -> Result<(), db::Error>;

    /// Invoked after a stage's events have been processed.
    async fn on_stage_finished(
        &mut self,
        txn: &db::Transaction,
        stored: &StoredState,
        ctx: &mut StageContext,
        stage: Stage,
        events: &MergedEvents,
    ) -> Result<(), db::Error>;

    /// Invoked when the challenge finishes.
    async fn on_finish(
        &mut self,
        txn: &db::Transaction,
        ctx: &mut ChallengeContext,
        final_ticks: u32,
    ) -> Result<(), db::Error>;

    /// Returns custom state to persist across the challenge processing runs.
    fn custom_data(&self) -> Option<serde_json::Value>;

    /// Returns the challenge's data file contents for the blob repository.
    fn challenge_data(&self) -> Option<ChallengeData>;

    /// Returns the challenge's official final tick count given its total ticks
    /// across all stages. Overridden where a challenge continues past its last
    /// counted stage.
    fn final_challenge_ticks(&self, total: u32) -> u32 {
        total
    }

    /// Whether every stage between the challenge's first and `stage`,
    /// inclusive, has recorded data.
    fn has_fully_recorded_up_to(&self, stage: Stage) -> bool;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stage_splits_must_progress_past_their_start() {
        let mut ctx = StageContext::new(vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()]);
        ctx.set_stage_split(SplitType::TobEntryMaiden70s50s, 0, 0, false);
        ctx.set_stage_split(SplitType::TobEntryMaiden70s50s, 32, 52, false);
        assert_eq!(ctx.stage_split(SplitType::TobEntryMaiden70s50s), None);

        ctx.set_stage_split(SplitType::TobEntryMaiden70s50s, 52, 32, false);
        assert_eq!(
            ctx.stage_split(SplitType::TobEntryMaiden70s50s),
            Some(StageSplit {
                tick: 52,
                start: 32,
                requires_completion: false,
            }),
        );
    }

    #[test]
    fn stage_splits_overwrite_and_iterate_in_split_order() {
        let mut ctx = StageContext::new(vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()]);
        ctx.set_stage_split(SplitType::TobEntryMaiden70s, 32, 0, false);
        ctx.set_stage_split(SplitType::TobEntryMaiden, 150, 0, true);
        ctx.set_stage_split(SplitType::TobEntryMaiden, 155, 0, true);
        assert_eq!(
            ctx.stage_splits().collect::<Vec<_>>(),
            vec![
                (
                    SplitType::TobEntryMaiden,
                    StageSplit {
                        tick: 155,
                        start: 0,
                        requires_completion: true,
                    },
                ),
                (
                    SplitType::TobEntryMaiden70s,
                    StageSplit {
                        tick: 32,
                        start: 0,
                        requires_completion: false,
                    },
                ),
            ],
        );
    }

    #[test]
    fn challenge_splits_need_nonzero_ticks_and_iterate_in_split_order() {
        let mut ctx = ChallengeContext::new(vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()]);
        ctx.set_challenge_split(SplitType::TobEntryChallenge, 0, None);
        assert_eq!(ctx.challenge_splits().count(), 0);

        ctx.set_challenge_split(SplitType::TobEntryNyloStart, 280, Some(true));
        ctx.set_challenge_split(SplitType::TobEntryChallenge, 1534, None);
        assert_eq!(
            ctx.challenge_splits().collect::<Vec<_>>(),
            vec![
                (
                    SplitType::TobEntryChallenge,
                    ChallengeSplit {
                        ticks: 1534,
                        accurate: None,
                    },
                ),
                (
                    SplitType::TobEntryNyloStart,
                    ChallengeSplit {
                        ticks: 280,
                        accurate: Some(true),
                    },
                ),
            ],
        );
    }
}

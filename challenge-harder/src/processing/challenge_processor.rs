//! Type-specific challenge processing.

#![cfg_attr(not(test), expect(dead_code))]

use async_trait::async_trait;

use super::db;
use super::interpret::StageContext;
use crate::lifecycle::core::types::Stage;
use crate::merging::MergedEvents;
use crate::proto::Event;

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
        ctx: &mut StageContext,
        stage: Stage,
        events: &MergedEvents,
    ) -> Result<(), db::Error>;

    /// Invoked when the challenge finishes.
    async fn on_finish(&mut self, txn: &db::Transaction, final_ticks: u32)
    -> Result<(), db::Error>;

    /// Returns custom state to persist across the challenge processing runs.
    fn custom_data(&self) -> Option<serde_json::Value>;

    /// Returns the challenge's final tick count given the accumulated total.
    /// Overridden where a challenge continues past its last counted stage.
    fn final_challenge_ticks(&self, accumulated: u32) -> u32 {
        accumulated
    }

    /// Whether every stage between the challenge's first and `stage`,
    /// inclusive, has recorded data.
    fn has_fully_recorded_up_to(&self, stage: Stage) -> bool;
}

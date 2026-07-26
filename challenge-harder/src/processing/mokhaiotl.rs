//! Mokhaiotl challenge processing.

use async_trait::async_trait;

use super::challenge_processor::{ChallengeProcessor, EventCursor};
use super::db;
use super::interpret::StageContext;
use crate::lifecycle::core::types::Stage;
use crate::merging::MergedEvents;

// TODO(frolv): port
pub struct MokhaiotlProcessor;

#[async_trait]
impl ChallengeProcessor for MokhaiotlProcessor {
    fn process_challenge_event(
        &mut self,
        _ctx: &mut StageContext,
        _events: &mut EventCursor<'_>,
    ) -> bool {
        false
    }

    async fn on_create(&mut self, _txn: &db::Transaction) -> Result<(), db::Error> {
        Ok(())
    }

    async fn on_stage_finished(
        &mut self,
        _txn: &db::Transaction,
        _ctx: &mut StageContext,
        _stage: Stage,
        _events: &MergedEvents,
    ) -> Result<(), db::Error> {
        Ok(())
    }

    async fn on_finish(
        &mut self,
        _txn: &db::Transaction,
        _final_ticks: u32,
    ) -> Result<(), db::Error> {
        Ok(())
    }

    fn custom_data(&self) -> Option<serde_json::Value> {
        None
    }

    fn has_fully_recorded_up_to(&self, _stage: Stage) -> bool {
        false
    }
}

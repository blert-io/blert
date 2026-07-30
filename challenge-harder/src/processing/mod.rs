//! Challenge processing pipeline.

use std::sync::Arc;

use async_trait::async_trait;

use crate::lifecycle::core::state::Trigger;
use crate::lifecycle::core::types::{
    ChallengeMode, ChallengeStatus, ChallengeType, PlayerId, PrimaryMeleeGear, ProcessingError,
    ProcessingPayload, Stage, Uuid,
};
use crate::store::Store;

pub mod db;

mod challenge;
mod challenge_processor;
mod interpret;
mod mokhaiotl;
mod persist;
mod split;
mod stage;
mod stats;

/// Challenge state at the time a run is triggered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChallengeInfo {
    pub challenge_type: ChallengeType,
    pub mode: ChallengeMode,
    pub party: Vec<String>,
    pub party_changed: bool,
    pub stage: Stage,
    pub status: ChallengeStatus,
    pub challenge_ticks: u32,
    pub created_unix_ms: u64,
}

impl ChallengeInfo {
    pub fn scale(&self) -> i16 {
        i16::try_from(self.party.len()).expect("scale fits in a smallint")
    }
}

/// A challenge party member.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StoredPlayerInfo {
    pub id: PlayerId,
    /// The gear recorded for the player.
    pub gear: PrimaryMeleeGear,
}

/// Challenge state a processing run retrieves from the database.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredState {
    /// Party members in order.
    pub players: Vec<StoredPlayerInfo>,
    /// Type-specific processor state persisted across runs.
    pub custom_data: Option<serde_json::Value>,
}

/// A request to process the data demanded by a run trigger.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessingRequest {
    pub uuid: Uuid,
    pub trigger: Trigger,
    pub challenge: ChallengeInfo,
}

/// Processes events for a completed challenge stage.
#[async_trait]
pub trait StageProcessor: Send + Sync + 'static {
    async fn process(
        &self,
        request: ProcessingRequest,
    ) -> Result<ProcessingPayload, ProcessingError>;
}

/// Complete event processing pipeline.
pub struct Pipeline {
    db: db::Postgres,
    store: Arc<Store>,
}

impl Pipeline {
    pub fn new(db: db::Postgres, store: Arc<Store>) -> Pipeline {
        Pipeline { db, store }
    }
}

#[async_trait]
impl StageProcessor for Pipeline {
    async fn process(
        &self,
        request: ProcessingRequest,
    ) -> Result<ProcessingPayload, ProcessingError> {
        tracing::info!(
            uuid = %request.uuid,
            trigger = ?request.trigger,
            "processing_started",
        );

        let mut txn = match self
            .db
            .start_transaction(request.uuid, request.trigger.seq())
            .await
        {
            Ok(txn) => txn,
            Err(db::Error::AlreadyApplied(payload)) => {
                tracing::debug!(uuid = %request.uuid, seq = ?request.trigger.seq(), "processing_step_already_applied");
                return Ok(payload);
            }
            Err(error) => return Err(error.into()),
        };

        let (payload, custom_data) = match request.trigger {
            Trigger::Create { .. } => {
                challenge::create(&mut txn, request.uuid, &request.challenge).await?;
                (ProcessingPayload::None, None)
            }
            Trigger::Recorder {
                user_id,
                recording_type,
                ..
            } => {
                challenge::add_recorder(&txn, user_id, recording_type).await?;
                (ProcessingPayload::None, None)
            }
            Trigger::StageStart { stage, .. } => {
                challenge::update_stage(&txn, stage).await?;
                (ProcessingPayload::None, None)
            }
            Trigger::Mode { mode, .. } => {
                challenge::update_mode(&txn, mode).await?;
                (ProcessingPayload::None, None)
            }
            Trigger::Finish { .. } => {
                challenge::finish(&txn, &request.challenge).await?;
                (ProcessingPayload::None, None)
            }
            Trigger::Stage { stage, attempt, .. } => {
                stage::process(
                    &self.store,
                    &txn,
                    &request.challenge,
                    request.uuid,
                    stage,
                    attempt,
                )
                .await?
            }
        };
        txn.commit(&payload, custom_data.as_ref()).await?;

        Ok(payload)
    }
}

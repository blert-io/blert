//! Challenge processing pipeline.

use std::sync::Arc;

use async_trait::async_trait;

use crate::lifecycle::core::state::Trigger;
use crate::lifecycle::core::types::{
    ChallengeMode, ChallengeStatus, ChallengeType, ProcessingError, ProcessingPayload, Stage, Uuid,
};
use crate::store::Store;

pub mod db;

mod challenge;
mod stage;

/// Challenge state at the time a run is triggered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChallengeInfo {
    pub challenge_type: ChallengeType,
    pub mode: ChallengeMode,
    pub party: Vec<String>,
    pub stage: Stage,
    pub status: ChallengeStatus,
    pub challenge_ticks: u32,
    pub created_unix_ms: u64,
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

        let payload = match request.trigger {
            Trigger::Create { .. } => {
                challenge::create(&mut txn, request.uuid, &request.challenge).await?;
                ProcessingPayload::None
            }
            Trigger::Recorder {
                user_id,
                recording_type,
                ..
            } => {
                challenge::add_recorder(&txn, user_id, recording_type).await?;
                ProcessingPayload::None
            }
            Trigger::Finish { .. } => {
                challenge::finish(&txn, &request.challenge).await?;
                ProcessingPayload::None
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
        txn.commit(&payload).await?;

        Ok(payload)
    }
}

//! Challenge processing pipeline.

use std::sync::Arc;

use async_trait::async_trait;

use crate::lifecycle::core::state::Trigger;
use crate::lifecycle::core::types::{
    PlayerId, PrimaryMeleeGear, ProcessingError, ProcessingPayload,
};
use crate::repository::DataRepository;
use crate::store::Store;

pub use crate::lifecycle::core::types::ChallengeInfo;

pub mod db;

mod challenge;
mod challenge_processor;
mod interpret;
mod mokhaiotl;
mod persist;
mod split;
mod stage;
mod stats;

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
    repository: DataRepository,
}

impl Pipeline {
    pub fn new(db: db::Postgres, store: Arc<Store>, repository: DataRepository) -> Pipeline {
        Pipeline {
            db,
            store,
            repository,
        }
    }
}

#[async_trait]
impl StageProcessor for Pipeline {
    async fn process(
        &self,
        request: ProcessingRequest,
    ) -> Result<ProcessingPayload, ProcessingError> {
        let uuid = request.challenge.uuid;
        tracing::info!(
            %uuid,
            trigger = ?request.trigger,
            "processing_started",
        );

        let mut txn = match self.db.start_transaction(uuid, request.trigger.seq()).await {
            Ok(txn) => txn,
            Err(db::Error::AlreadyApplied(payload)) => {
                tracing::debug!(%uuid, seq = ?request.trigger.seq(), "processing_step_already_applied");
                return Ok(payload);
            }
            Err(error) => return Err(error.into()),
        };

        let (payload, custom_data) = match request.trigger {
            Trigger::Create { .. } => {
                challenge::create(&mut txn, &request.challenge).await?;
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
            Trigger::Stage { .. } => {
                stage::process(&self.store, &self.repository, &txn, &request.challenge).await?
            }
        };
        txn.commit(&payload, custom_data.as_ref()).await?;

        Ok(payload)
    }
}

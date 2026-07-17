//! Challenge processing pipeline.

use async_trait::async_trait;

use crate::lifecycle::core::state::Trigger;
use crate::lifecycle::core::types::{ProcessingError, ProcessingOutcome, StageStatus, Uuid};

/// A request to process the data demanded by a run trigger.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProcessingRequest {
    pub uuid: Uuid,
    pub trigger: Trigger,
}

/// Processes events for a completed challenge stage.
#[async_trait]
pub trait StageProcessor: Send + Sync + 'static {
    async fn process(
        &self,
        request: ProcessingRequest,
    ) -> Result<ProcessingOutcome, ProcessingError>;
}

/// Complete event processing pipeline.
pub struct Pipeline;

#[async_trait]
impl StageProcessor for Pipeline {
    async fn process(
        &self,
        request: ProcessingRequest,
    ) -> Result<ProcessingOutcome, ProcessingError> {
        tracing::info!(
            uuid = %request.uuid,
            trigger = ?request.trigger,
            "processing_started",
        );
        Ok(match request.trigger {
            Trigger::Stage { .. } => ProcessingOutcome::Stage {
                status: StageStatus::Completed,
                ticks: 0,
            },
            Trigger::Create { .. } | Trigger::Finish { .. } => ProcessingOutcome::Boundary,
        })
    }
}

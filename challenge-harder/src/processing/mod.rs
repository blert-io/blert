//! Challenge processing pipeline.

use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;

use crate::lifecycle::core::state::Trigger;
use crate::lifecycle::core::types::{
    ChallengeType, PlayerId, PrimaryMeleeGear, ProcessingError, ProcessingPayload,
};
use crate::metrics;
use crate::price::PriceResolver;
use crate::redis::Store;
use crate::repository::DataRepository;

use challenge_processor::ChallengeProcessor;
use colosseum::ColosseumProcessor;
use inferno::InfernoProcessor;
use mokhaiotl::MokhaiotlProcessor;
use theatre::TheatreProcessor;

pub use crate::lifecycle::core::types::ChallengeInfo;
pub use session::PostgresSessionFinalizer;

pub mod db;

mod challenge;
mod challenge_processor;
mod colosseum;
mod effects;
mod inferno;
mod interpret;
mod mokhaiotl;
mod persist;
mod session;
mod split;
mod stage;
mod stats;
#[cfg(test)]
mod tests;
mod theatre;

fn processor_for(
    config: ProcessorConfig,
    challenge: &ChallengeInfo,
    custom_data: Option<&serde_json::Value>,
) -> Result<Option<Box<dyn ChallengeProcessor>>, ProcessingError> {
    match challenge.challenge_type {
        ChallengeType::Colosseum => Ok(Some(Box::new(ColosseumProcessor::new(
            challenge.clone(),
            custom_data,
        )?))),
        ChallengeType::Inferno => Ok(Some(Box::new(InfernoProcessor::new(
            challenge.clone(),
            custom_data,
        )?))),
        ChallengeType::Mokhaiotl => Ok(Some(Box::new(MokhaiotlProcessor::new(
            challenge.clone(),
            custom_data,
        )?))),
        ChallengeType::Tob => Ok(Some(Box::new(TheatreProcessor::new(
            config.theatre,
            challenge.clone(),
            custom_data,
        )?))),
        ChallengeType::Cox | ChallengeType::Toa | ChallengeType::UnknownChallenge => Ok(None),
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
    /// Tick count so far.
    pub challenge_ticks: u32,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TheatreConfig {
    /// Soft cap on Bloat hand rows recorded per UTC day.
    pub daily_bloat_hand_limit: i64,
}

impl Default for TheatreConfig {
    fn default() -> Self {
        TheatreConfig {
            daily_bloat_hand_limit: 10_000,
        }
    }
}

/// Challenge processing options.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ProcessorConfig {
    pub theatre: TheatreConfig,
}

/// Complete event processing pipeline.
pub struct Pipeline {
    db: Arc<db::Postgres>,
    store: Arc<Store>,
    repository: DataRepository,
    price_resolver: Arc<PriceResolver>,
    config: ProcessorConfig,
}

impl Pipeline {
    pub fn new(
        db: Arc<db::Postgres>,
        store: Arc<Store>,
        repository: DataRepository,
        price_resolver: Arc<PriceResolver>,
        config: ProcessorConfig,
    ) -> Pipeline {
        Pipeline {
            db,
            store,
            repository,
            price_resolver,
            config,
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
        let started = Instant::now();

        let mut txn = match self.db.start_transaction(uuid, request.trigger).await {
            Ok(txn) => txn,
            Err(db::Error::AlreadyApplied(payload)) => {
                tracing::debug!(%uuid, seq = ?request.trigger.seq(), "processing_step_already_applied");
                return Ok(payload);
            }
            Err(error) => return Err(error.into()),
        };

        let (payload, custom_data) = match request.trigger {
            Trigger::Create { .. } => {
                let custom_data =
                    challenge::create(&mut txn, &self.repository, self.config, &request.challenge)
                        .await?;
                (ProcessingPayload::None, custom_data)
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
                challenge::finish(&mut txn, &self.repository, self.config, &request.challenge)
                    .await?;
                (ProcessingPayload::None, None)
            }
            Trigger::Stage { .. } => {
                stage::process(
                    &self.store,
                    &self.repository,
                    &txn,
                    &self.price_resolver,
                    self.config,
                    &request.challenge,
                )
                .await?
            }
        };
        txn.commit(&payload, custom_data.as_ref()).await?;

        if let Trigger::Stage { stage, .. } = request.trigger {
            metrics::observe_stage_processing_duration(
                stage,
                started.elapsed().as_secs_f64() * 1000.0,
            );
        }

        Ok(payload)
    }
}

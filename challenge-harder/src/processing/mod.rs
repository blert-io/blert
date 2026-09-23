//! Challenge processing pipeline.

use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use blert::Ticks;

use crate::lifecycle::core::state::Trigger;
use crate::lifecycle::core::types::{
    ChallengeType, PlayerId, PrimaryMeleeGear, ProcessingError, ProcessingPayload, Uuid,
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
pub use merging::{CaptureRates, StreamCapturer};
pub use session::PostgresSessionFinalizer;

pub mod db;

mod challenge;
mod challenge_processor;
mod colosseum;
mod effects;
mod inferno;
mod interpret;
mod merging;
mod mokhaiotl;
mod persist;
mod session;
mod spawn_index;
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
    pub challenge_ticks: Ticks,
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
    capturer: Option<StreamCapturer>,
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
            capturer: None,
        }
    }

    pub fn with_capturer(mut self, capturer: StreamCapturer) -> Pipeline {
        self.capturer = Some(capturer);
        self
    }

    async fn dispatch(
        &self,
        run: &mut ProcessingRun,
    ) -> Result<(ProcessingPayload, Option<serde_json::Value>), ProcessingError> {
        match run.request.trigger {
            Trigger::Create { .. } => {
                let custom_data = challenge::create(run, &self.repository, self.config).await?;
                Ok((ProcessingPayload::None, custom_data))
            }
            Trigger::Recorder {
                user_id,
                recording_type,
                ..
            } => {
                time(&mut run.timings.writes, || {
                    challenge::add_recorder(&run.txn, user_id, recording_type)
                })
                .await?;
                Ok((ProcessingPayload::None, None))
            }
            Trigger::StageStart { stage, .. } => {
                time(&mut run.timings.writes, || {
                    challenge::update_stage(&run.txn, stage)
                })
                .await?;
                Ok((ProcessingPayload::None, None))
            }
            Trigger::Mode { mode, .. } => {
                time(&mut run.timings.writes, || {
                    challenge::update_mode(&run.txn, mode)
                })
                .await?;
                Ok((ProcessingPayload::None, None))
            }
            Trigger::Finish { .. } => {
                challenge::finish(run, &self.repository, self.config).await?;
                Ok((ProcessingPayload::None, None))
            }
            Trigger::Stage { .. } => stage::process(self, run).await,
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
        let trigger = request.trigger;
        tracing::info!(%uuid, ?trigger, "processing_started");

        let mut run = match ProcessingRun::start(&self.db, request).await {
            Ok(run) => run,
            Err(db::Error::AlreadyApplied(payload)) => {
                tracing::debug!(%uuid, seq = ?trigger.seq(), "processing_step_already_applied");
                return Ok(payload);
            }
            Err(error) => return Err(error.into()),
        };

        let outcome = self.dispatch(&mut run).await;
        run.finish(outcome).await
    }
}

/// Time spent during each stage of a processing run.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct RunTimings {
    transaction: Option<Duration>,
    stream_read: Option<Duration>,
    state_load: Option<Duration>,
    interpret: Option<Duration>,
    processor: Option<Duration>,
    writes: Option<Duration>,
    repository: Option<Duration>,
    commit: Option<Duration>,
}

impl RunTimings {
    fn log(&self, uuid: Uuid, trigger: Trigger, total: Duration, error: Option<&ProcessingError>) {
        tracing::info!(
            %uuid,
            ?trigger,
            total_ms = total.as_millis(),
            transaction_ms = self.transaction.map(|duration| duration.as_millis()),
            stream_read_ms = self.stream_read.map(|duration| duration.as_millis()),
            state_load_ms = self.state_load.map(|duration| duration.as_millis()),
            interpret_ms = self.interpret.map(|duration| duration.as_millis()),
            processor_ms = self.processor.map(|duration| duration.as_millis()),
            writes_ms = self.writes.map(|duration| duration.as_millis()),
            repository_ms = self.repository.map(|duration| duration.as_millis()),
            commit_ms = self.commit.map(|duration| duration.as_millis()),
            error = error.map(|error| error.message.as_str()),
            retriable = error.map(|error| error.retriable),
            "processing_finished",
        );
    }
}

/// Runs `work`, adding the time it took to `slot`.
async fn time<F: Future>(slot: &mut Option<Duration>, work: impl FnOnce() -> F) -> F::Output {
    let started = Instant::now();
    let output = work().await;
    *slot = Some(slot.unwrap_or_default() + started.elapsed());
    output
}

struct ProcessingRun {
    request: ProcessingRequest,
    txn: db::Transaction,
    started: Instant,
    timings: RunTimings,
}

impl ProcessingRun {
    async fn start(db: &db::Postgres, request: ProcessingRequest) -> Result<Self, db::Error> {
        let started = Instant::now();
        let mut timings = RunTimings::default();
        let txn = time(&mut timings.transaction, || {
            db.start_transaction(request.challenge.uuid, request.trigger)
        })
        .await?;
        Ok(ProcessingRun {
            request,
            txn,
            started,
            timings,
        })
    }

    async fn finish(
        mut self,
        outcome: Result<(ProcessingPayload, Option<serde_json::Value>), ProcessingError>,
    ) -> Result<ProcessingPayload, ProcessingError> {
        let result = match outcome {
            Ok((payload, custom_data)) => time(&mut self.timings.commit, || {
                self.txn.commit(&payload, custom_data.as_ref())
            })
            .await
            .map(|()| payload)
            .map_err(ProcessingError::from),
            Err(error) => Err(error),
        };

        let total = self.started.elapsed();
        if result.is_ok()
            && let Trigger::Stage { stage, .. } = self.request.trigger
        {
            metrics::observe_stage_processing_duration(stage, total.as_secs_f64() * 1000.0);
        }
        self.timings.log(
            self.request.challenge.uuid,
            self.request.trigger,
            total,
            result.as_ref().err(),
        );
        result
    }
}

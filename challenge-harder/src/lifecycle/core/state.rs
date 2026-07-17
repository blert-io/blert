//! Derived state of an active challenge.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde::{Deserialize, Serialize};

use core::time::Duration;

use super::types::{
    ChallengeMode, ChallengeStatus, ChallengeType, ChallengeTypeExt, ClientId, JournalSeq, MsgId,
    ProcessingError, ProcessingOutcome, RecordingType, ReportedTimes, SessionToken, Stage,
    StageStatus, Timestamp, UserId, Uuid,
};

/// Progress of the challenge's current stage attempt.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum StageState {
    /// Clients are recording the stage.
    #[default]
    InProgress,
    /// Some but not all clients have completed the stage.
    Ending { since: Timestamp },
    /// The stage's event streams are finalized.
    Complete { since: Timestamp },
}

/// Overall lifecycle phase of a challenge.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum PhaseState {
    /// Clients are recording the challenge.
    #[default]
    Active,
    /// At least one client has definitively finished.
    Finishing {
        /// Time of the most recent client finish.
        since: Timestamp,
    },
    /// The challenge has ended.
    Terminated,
}

impl PhaseState {
    /// Returns the published form of the phase.
    #[must_use]
    pub fn phase(self) -> ChallengePhase {
        match self {
            PhaseState::Active => ChallengePhase::Active,
            PhaseState::Finishing { .. } => ChallengePhase::Finishing,
            PhaseState::Terminated => ChallengePhase::Terminated,
        }
    }
}

/// Options for a challenge's data processing pipeline.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProcessingConfig {
    /// Attempts before giving up. Zero disables processing entirely.
    pub max_attempts: u32,
    /// Longest an attempt may run before it is aborted.
    pub run_timeout: Duration,
    /// Delay following a failed attempt before retrying.
    pub retry_backoff: Duration,
}

impl Default for ProcessingConfig {
    fn default() -> Self {
        ProcessingConfig {
            max_attempts: 0,
            run_timeout: Duration::from_secs(30),
            retry_backoff: Duration::from_secs(5),
        }
    }
}

/// A journal entry which starts a processing run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Trigger {
    /// A new challenge was created.
    Create { seq: JournalSeq },
    /// A stage completed.
    Stage {
        seq: JournalSeq,
        stage: Stage,
        attempt: Option<u32>,
    },
    /// A challenge terminated.
    Finish { seq: JournalSeq },
}

impl Trigger {
    /// Journal position of the triggering entry.
    #[must_use]
    pub fn seq(self) -> JournalSeq {
        match self {
            Trigger::Create { seq } | Trigger::Stage { seq, .. } | Trigger::Finish { seq } => seq,
        }
    }
}

/// Status of an active processing run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProcessingState {
    Idle { since: Timestamp },
    Running { since: Timestamp },
}

/// An active processing run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProcessingRun {
    pub trigger: Trigger,
    pub attempts: u32,
    /// False once a run fails with a non-retriable error.
    pub retriable: bool,
    pub state: ProcessingState,
}

impl ProcessingRun {
    fn new(trigger: Trigger, at: Timestamp) -> Self {
        ProcessingRun {
            trigger,
            attempts: 0,
            retriable: true,
            state: ProcessingState::Idle { since: at },
        }
    }

    /// If `true`, the run cannot be retried any further.
    #[must_use]
    pub fn exhausted(&self, config: &ProcessingConfig) -> bool {
        !self.retriable || self.attempts >= config.max_attempts
    }
}

/// State of a challenge's data processing pipeline.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Processing {
    config: ProcessingConfig,
    active: Option<ProcessingRun>,
    pending: VecDeque<Trigger>,
    failed: Vec<Trigger>,
    /// Status derived from the most recently processed outcome.
    status: Option<ChallengeStatus>,
}

impl Processing {
    pub fn new(config: ProcessingConfig) -> Self {
        Self {
            config,
            active: None,
            pending: VecDeque::new(),
            failed: Vec::new(),
            status: None,
        }
    }

    /// Records a new trigger, starting its run if free.
    pub fn push(&mut self, trigger: Trigger, at: Timestamp) {
        if self.config.max_attempts == 0 {
            return;
        }
        if self.active.is_none() {
            self.active = Some(ProcessingRun::new(trigger, at));
        } else {
            self.pending.push_back(trigger);
        }
    }

    /// Begins an attempt of the active run.
    pub fn start(&mut self, seq: JournalSeq, at: Timestamp) {
        if let Some(run) = &mut self.active
            && run.trigger.seq() == seq
        {
            run.attempts += 1;
            run.state = ProcessingState::Running { since: at };
        }
    }

    /// Consumes the result of an attempt of the active run. A successful
    /// outcome or an exhausted run completes it, starting the next pending run.
    /// A failed run with attempts remaining marks it for retry.
    pub fn finish(
        &mut self,
        challenge_type: ChallengeType,
        at: Timestamp,
        result: Result<ProcessingOutcome, ProcessingError>,
    ) {
        let Some(run) = &mut self.active else {
            return;
        };
        match result {
            Ok(ProcessingOutcome::Stage { status, .. }) => {
                if let Trigger::Stage { stage, .. } = run.trigger {
                    self.status = Some(status_if_finished_now(challenge_type, stage, status));
                }
            }
            Ok(ProcessingOutcome::Boundary) => {}
            Err(error) => {
                run.retriable &= error.retriable;
                if !run.exhausted(&self.config) {
                    run.state = ProcessingState::Idle { since: at };
                    return;
                }
                self.failed.push(run.trigger);
            }
        }

        self.active = self
            .pending
            .pop_front()
            .map(|trigger| ProcessingRun::new(trigger, at));
    }

    /// The run currently owning the pipeline.
    #[must_use]
    pub fn active(&self) -> Option<&ProcessingRun> {
        self.active.as_ref()
    }

    /// Triggers whose runs were abandoned after exhausting their attempts.
    #[must_use]
    pub fn failed(&self) -> &[Trigger] {
        &self.failed
    }

    /// Timing parameters of the pipeline's runs.
    #[must_use]
    pub fn config(&self) -> &ProcessingConfig {
        &self.config
    }

    /// Whether the pipeline has no further work.
    #[must_use]
    pub fn settled(&self) -> bool {
        self.active.is_none() && self.pending.is_empty()
    }
}

/// A challenge's lifecycle phase as published for external readers.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChallengePhase {
    #[default]
    Active,
    Finishing,
    Terminated,
}

impl ChallengePhase {
    /// External representation of the phase.
    #[must_use]
    pub fn tag(self) -> &'static str {
        match self {
            ChallengePhase::Active => "ACTIVE",
            ChallengePhase::Finishing => "FINISHING",
            ChallengePhase::Terminated => "TERMINATED",
        }
    }

    /// Parses a phase from its representation.
    #[must_use]
    pub fn from_tag(tag: &str) -> Option<Self> {
        [Self::Active, Self::Finishing, Self::Terminated]
            .into_iter()
            .find(|phase| phase.tag() == tag)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClientState {
    pub user_id: UserId,
    pub session_token: SessionToken,
    pub recording_type: RecordingType,
    pub active: bool,
    pub stage: Stage,
    pub stage_status: StageStatus,
    pub stage_attempt: Option<u32>,
    pub last_completed: Option<LastCompleted>,
}

/// A client's latest completed stage and attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastCompleted {
    pub stage: Stage,
    pub attempt: Option<u32>,
}

/// A client's state as published for external readers.
/// Mirrors `ChallengeClient` in `//challenge-server/redis-client.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedClient {
    pub user_id: UserId,
    pub client_id: ClientId,
    #[serde(rename = "type")]
    pub recording_type: RecordingType,
    pub active: bool,
    pub stage: Stage,
    pub stage_attempt: Option<u32>,
    pub stage_status: StageStatus,
    pub last_completed: LastCompleted,
}

impl PublishedClient {
    #[must_use]
    pub fn of(client_id: ClientId, client: &ClientState) -> Self {
        Self {
            user_id: client.user_id,
            client_id,
            recording_type: client.recording_type,
            active: client.active,
            stage: client.stage,
            stage_attempt: client.stage_attempt,
            stage_status: client.stage_status,
            last_completed: client.last_completed.unwrap_or(LastCompleted {
                stage: Stage::UnknownStage,
                attempt: None,
            }),
        }
    }
}

/// State published by a challenge for outside readers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub uuid: Uuid,
    pub challenge_type: ChallengeType,
    pub mode: ChallengeMode,
    pub stage: Stage,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage_attempt: Option<u32>,
    pub party: Vec<String>,
    pub phase: ChallengePhase,
    pub status: ChallengeStatus,
    /// Last inbox message the challenge has processed, whether or not it had
    /// any effect. Lets a caller await the application of its own command.
    pub cursor: MsgId,
}

impl Snapshot {
    #[must_use]
    pub fn of(state: &ChallengeState, cursor: MsgId) -> Self {
        Self {
            uuid: state.uuid,
            challenge_type: state.challenge_type,
            mode: state.mode,
            stage: state.stage,
            stage_attempt: state.stage_attempt,
            party: state.party.clone(),
            phase: state.phase.phase(),
            status: state.status(),
            cursor,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChallengeState {
    pub uuid: Uuid,
    pub challenge_type: ChallengeType,
    pub mode: ChallengeMode,
    pub party: Vec<String>,
    /// A player left partway through.
    pub party_changed: bool,
    pub phase: PhaseState,
    /// Completion times reported by a finishing client.
    pub reported_times: Option<ReportedTimes>,
    pub stage: Stage,
    pub stage_attempt: Option<u32>,
    /// Status of the challenge's current stage.
    // TODO(frolv): Derived from client reports until stage processing
    // provides merged outcomes.
    pub stage_status: StageStatus,
    pub stage_state: StageState,
    pub clients: BTreeMap<ClientId, ClientState>,
    /// Every client that has recorded any part of the challenge.
    pub recorded_by: BTreeSet<ClientId>,
    /// When the challenge lost its last active client.
    pub dormant_since: Option<Timestamp>,
    /// State of the challenge's processing pipeline.
    pub processing: Processing,
    /// Last applied inbox message.
    pub cursor: MsgId,
}

impl ChallengeState {
    /// The challenge's published status.
    #[must_use]
    pub fn status(&self) -> ChallengeStatus {
        match self.phase {
            PhaseState::Active | PhaseState::Finishing { .. } => ChallengeStatus::InProgress,
            PhaseState::Terminated => self.processing.status.unwrap_or_else(|| {
                status_if_finished_now(self.challenge_type, self.stage, self.stage_status)
            }),
        }
    }

    // Whether the challenge has terminated.
    #[inline]
    #[must_use]
    pub fn terminated(&self) -> bool {
        matches!(self.phase, PhaseState::Terminated)
    }
}

/// Status a challenge ending at `stage` with `stage_status` would receive.
fn status_if_finished_now(
    challenge_type: ChallengeType,
    stage: Stage,
    stage_status: StageStatus,
) -> ChallengeStatus {
    let last_stage = challenge_type.last_stage();

    if last_stage.is_some_and(|last| stage > last) {
        return ChallengeStatus::Completed;
    }

    match stage_status {
        StageStatus::Started => ChallengeStatus::Abandoned,
        StageStatus::Entered => ChallengeStatus::Reset,
        StageStatus::Wiped => ChallengeStatus::Wiped,
        StageStatus::Completed => {
            if last_stage.is_some_and(|last| stage == last) {
                ChallengeStatus::Completed
            } else {
                ChallengeStatus::Reset
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(max_attempts: u32) -> ProcessingConfig {
        ProcessingConfig {
            max_attempts,
            run_timeout: Duration::from_secs(10),
            retry_backoff: Duration::from_secs(3),
        }
    }

    fn trigger(seq: u64, stage: Stage) -> Trigger {
        Trigger::Stage {
            seq: JournalSeq(seq),
            stage,
            attempt: None,
        }
    }

    fn outcome(status: StageStatus) -> ProcessingOutcome {
        ProcessingOutcome::Stage { status, ticks: 100 }
    }

    fn error(retriable: bool) -> ProcessingError {
        ProcessingError {
            message: "scripted".into(),
            retriable,
        }
    }

    #[test]
    fn processing_push_activates_when_free_and_queues_others() {
        let mut processing = Processing::new(config(2));
        assert!(processing.settled());

        processing.push(trigger(3, Stage::TobMaiden), Timestamp::from_millis(100));
        assert_eq!(
            processing.active(),
            Some(&ProcessingRun {
                trigger: trigger(3, Stage::TobMaiden),
                attempts: 0,
                retriable: true,
                state: ProcessingState::Idle {
                    since: Timestamp::from_millis(100)
                },
            }),
        );
        assert!(!processing.settled());

        processing.push(trigger(7, Stage::TobBloat), Timestamp::from_millis(200));
        assert_eq!(processing.active().unwrap().trigger.seq(), JournalSeq(3));
    }

    #[test]
    fn processing_start_only_responds_to_the_active_trigger() {
        let mut processing = Processing::new(config(2));
        processing.push(trigger(3, Stage::TobMaiden), Timestamp::from_millis(100));

        processing.start(JournalSeq(9), Timestamp::from_millis(150));
        assert_eq!(processing.active().unwrap().attempts, 0);

        processing.start(JournalSeq(3), Timestamp::from_millis(150));
        let run = processing.active().unwrap();
        assert_eq!(run.attempts, 1);
        assert_eq!(
            run.state,
            ProcessingState::Running {
                since: Timestamp::from_millis(150)
            },
        );
    }

    #[test]
    fn processing_finish_records_status_and_starts_next() {
        let mut processing = Processing::new(config(2));
        processing.push(trigger(3, Stage::TobMaiden), Timestamp::from_millis(100));
        processing.push(trigger(7, Stage::TobBloat), Timestamp::from_millis(200));
        processing.start(JournalSeq(3), Timestamp::from_millis(150));

        processing.finish(
            ChallengeType::Tob,
            Timestamp::from_millis(400),
            Ok(outcome(StageStatus::Completed)),
        );
        assert_eq!(processing.status, Some(ChallengeStatus::Reset));
        assert_eq!(
            processing.active(),
            Some(&ProcessingRun {
                trigger: trigger(7, Stage::TobBloat),
                attempts: 0,
                retriable: true,
                state: ProcessingState::Idle {
                    since: Timestamp::from_millis(400)
                },
            }),
        );
    }

    #[test]
    fn processing_failed_backs_off_until_exhausted() {
        let mut processing = Processing::new(config(2));
        processing.push(trigger(3, Stage::TobMaiden), Timestamp::from_millis(100));
        processing.push(trigger(7, Stage::TobBloat), Timestamp::from_millis(200));

        processing.start(JournalSeq(3), Timestamp::from_millis(150));
        processing.finish(
            ChallengeType::Tob,
            Timestamp::from_millis(300),
            Err(error(true)),
        );
        let run = processing.active().unwrap();
        assert_eq!(run.trigger.seq(), JournalSeq(3));
        assert_eq!(run.attempts, 1);
        assert_eq!(
            run.state,
            ProcessingState::Idle {
                since: Timestamp::from_millis(300)
            },
        );
        assert!(!run.exhausted(&config(2)));

        // The final allowed attempt fails; the run is abandoned and the next
        // trigger activates with no status recorded.
        processing.start(JournalSeq(3), Timestamp::from_millis(3_300));
        processing.finish(
            ChallengeType::Tob,
            Timestamp::from_millis(3_400),
            Err(error(true)),
        );
        assert_eq!(processing.status, None);
        assert_eq!(processing.failed, vec![trigger(3, Stage::TobMaiden)]);
        assert_eq!(processing.active().unwrap().trigger.seq(), JournalSeq(7));
    }

    #[test]
    fn processing_non_retriable_failure_exhausts_immediately() {
        let mut processing = Processing::new(config(5));
        processing.push(trigger(3, Stage::TobMaiden), Timestamp::from_millis(100));
        processing.start(JournalSeq(3), Timestamp::from_millis(150));

        processing.finish(
            ChallengeType::Tob,
            Timestamp::from_millis(300),
            Err(error(false)),
        );
        assert_eq!(processing.active(), None);
        assert_eq!(processing.failed, vec![trigger(3, Stage::TobMaiden)]);
        assert!(processing.settled());
    }

    #[test]
    fn status_stays_in_progress_until_terminated() {
        let mut state = ChallengeState {
            challenge_type: ChallengeType::Tob,
            stage: Stage::TobMaiden,
            stage_status: StageStatus::Wiped,
            ..ChallengeState::default()
        };
        assert_eq!(state.status(), ChallengeStatus::InProgress);

        state.phase = PhaseState::Finishing {
            since: Timestamp::from_millis(1_000),
        };
        assert_eq!(state.status(), ChallengeStatus::InProgress);

        state.phase = PhaseState::Terminated;
        assert_eq!(state.status(), ChallengeStatus::Wiped);
    }

    #[test]
    fn terminated_status_prefers_processing_outcome() {
        let mut state = ChallengeState {
            challenge_type: ChallengeType::Tob,
            stage: Stage::TobMaiden,
            stage_status: StageStatus::Wiped,
            phase: PhaseState::Terminated,
            processing: Processing::new(config(2)),
            ..ChallengeState::default()
        };

        state
            .processing
            .push(trigger(3, Stage::TobMaiden), Timestamp::from_millis(100));
        state
            .processing
            .start(JournalSeq(3), Timestamp::from_millis(150));
        state.processing.finish(
            ChallengeType::Tob,
            Timestamp::from_millis(300),
            Ok(outcome(StageStatus::Completed)),
        );
        assert_eq!(state.status(), ChallengeStatus::Reset);
    }

    #[test]
    fn status_if_finished_now_reflects_stage_position_and_outcome() {
        let cases = [
            (
                ChallengeType::Tob,
                Stage::TobMaiden,
                StageStatus::Started,
                ChallengeStatus::Abandoned,
            ),
            (
                ChallengeType::Tob,
                Stage::TobMaiden,
                StageStatus::Wiped,
                ChallengeStatus::Wiped,
            ),
            (
                ChallengeType::Tob,
                Stage::TobBloat,
                StageStatus::Completed,
                ChallengeStatus::Reset,
            ),
            (
                ChallengeType::Tob,
                Stage::TobNylocas,
                StageStatus::Entered,
                ChallengeStatus::Reset,
            ),
            (
                ChallengeType::Tob,
                Stage::TobVerzik,
                StageStatus::Completed,
                ChallengeStatus::Completed,
            ),
            (
                ChallengeType::Mokhaiotl,
                Stage::MokhaiotlDelve8,
                StageStatus::Started,
                ChallengeStatus::Abandoned,
            ),
            (
                ChallengeType::Mokhaiotl,
                Stage::MokhaiotlDelve8plus,
                StageStatus::Started,
                ChallengeStatus::Completed,
            ),
            (
                ChallengeType::Mokhaiotl,
                Stage::MokhaiotlDelve8plus,
                StageStatus::Wiped,
                ChallengeStatus::Completed,
            ),
        ];
        for (challenge_type, stage, stage_status, expected) in cases {
            assert_eq!(
                status_if_finished_now(challenge_type, stage, stage_status),
                expected,
                "{challenge_type:?} at {stage:?} with {stage_status:?}",
            );
        }
    }
}

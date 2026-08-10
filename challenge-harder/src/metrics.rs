//! Prometheus metrics for the challenge server.

use std::sync::LazyLock;

use prometheus::{
    HistogramVec, IntCounter, IntCounterVec, IntGauge, Opts, TextEncoder, histogram_opts,
    register_histogram_vec, register_int_counter, register_int_counter_vec, register_int_gauge,
};

use crate::lifecycle::core::state::Trigger;
use crate::lifecycle::core::types::{
    ChallengeMode, ChallengeStatus, ChallengeType, RecordingType, Stage, StageExt,
};

static HTTP_REQUESTS: LazyLock<IntCounterVec> = LazyLock::new(|| {
    register_int_counter_vec!(
        Opts::new(
            "challenge_server_http_requests_total",
            "HTTP request results"
        ),
        &["route", "method", "status"]
    )
    .unwrap()
});

static HTTP_REQUEST_DURATION: LazyLock<HistogramVec> = LazyLock::new(|| {
    register_histogram_vec!(
        histogram_opts!(
            "challenge_server_http_request_duration_ms",
            "HTTP request latency in milliseconds",
            vec![
                5.0, 15.0, 30.0, 60.0, 120.0, 250.0, 500.0, 1_000.0, 2_000.0, 5_000.0, 10_000.0
            ]
        ),
        &["route", "method", "status"]
    )
    .unwrap()
});

static CHALLENGE_REQUESTS: LazyLock<IntCounterVec> = LazyLock::new(|| {
    register_int_counter_vec!(
        Opts::new(
            "challenge_server_challenge_requests_total",
            "Challenge request flow decisions"
        ),
        &["action", "type", "mode", "recording_type", "decision"]
    )
    .unwrap()
});

static CLIENT_RECONNECTS: LazyLock<IntCounterVec> = LazyLock::new(|| {
    register_int_counter_vec!(
        Opts::new(
            "challenge_server_client_reconnects_total",
            "Client reconnects"
        ),
        &["recording_type", "decision"]
    )
    .unwrap()
});

static FINISH_REQUESTS: LazyLock<IntCounterVec> = LazyLock::new(|| {
    register_int_counter_vec!(
        Opts::new(
            "challenge_server_finish_requests_total",
            "Challenge finish attempt outcomes"
        ),
        &["all_clients_done", "result"]
    )
    .unwrap()
});

static CHALLENGE_FINALIZATION: LazyLock<IntCounterVec> = LazyLock::new(|| {
    register_int_counter_vec!(
        Opts::new(
            "challenge_server_challenge_finalization_total",
            "Challenge finalization paths"
        ),
        &["path", "status"]
    )
    .unwrap()
});

static STAGE_STARTS: LazyLock<IntCounterVec> = LazyLock::new(|| {
    register_int_counter_vec!(
        Opts::new(
            "challenge_server_stage_started_total",
            "Stages started within a challenge"
        ),
        &["type", "mode", "stage"]
    )
    .unwrap()
});

static STAGE_PROCESSING_DURATION: LazyLock<HistogramVec> = LazyLock::new(|| {
    register_histogram_vec!(
        histogram_opts!(
            "challenge_server_stage_processing_duration_ms",
            "Time spent processing a stage",
            vec![
                50.0, 100.0, 200.0, 400.0, 800.0, 1_500.0, 3_000.0, 6_000.0, 12_000.0, 30_000.0
            ]
        ),
        &["stage"]
    )
    .unwrap()
});

static REPOSITORY_WRITES: LazyLock<IntCounterVec> = LazyLock::new(|| {
    register_int_counter_vec!(
        Opts::new(
            "challenge_server_repository_writes_total",
            "Repository write attempts"
        ),
        &["target", "kind", "result"]
    )
    .unwrap()
});

static QUERYABLE_EVENTS: LazyLock<IntCounterVec> = LazyLock::new(|| {
    register_int_counter_vec!(
        Opts::new(
            "challenge_server_queryable_events_total",
            "Number of queryable events persisted"
        ),
        &["stage"]
    )
    .unwrap()
});

static REPORTED_TIME_MISMATCHES: LazyLock<IntCounterVec> = LazyLock::new(|| {
    register_int_counter_vec!(
        Opts::new(
            "challenge_server_reported_time_mismatch_total",
            "Reported time mismatches detected"
        ),
        &["type"]
    )
    .unwrap()
});

static ACTIVE_CHALLENGES: LazyLock<IntGauge> = LazyLock::new(|| {
    register_int_gauge!(Opts::new(
        "challenge_server_active_challenges",
        "Locally owned active challenges"
    ))
    .unwrap()
});

static SESSIONS_FINALIZED: LazyLock<IntCounter> = LazyLock::new(|| {
    register_int_counter!(Opts::new(
        "challenge_server_sessions_finalized_total",
        "Sessions whose records were finalized"
    ))
    .unwrap()
});

static STORE_OPERATIONS: LazyLock<IntCounterVec> = LazyLock::new(|| {
    register_int_counter_vec!(
        Opts::new(
            "challenge_server_store_operations_total",
            "Claim store operation outcomes"
        ),
        &["op", "outcome"]
    )
    .unwrap()
});

static PROCESSING_RUNS: LazyLock<IntCounterVec> = LazyLock::new(|| {
    register_int_counter_vec!(
        Opts::new(
            "challenge_server_processing_runs_total",
            "Processing run attempt outcomes"
        ),
        &["trigger", "outcome"]
    )
    .unwrap()
});

/// How a challenge start request was resolved.
#[derive(Debug, Clone, Copy)]
pub enum RequestAction {
    Create,
    Join,
}

/// Outcome of an incoming request.
#[derive(Debug, Clone, Copy)]
pub enum Decision {
    Accepted,
    Rejected,
    Error,
}

impl Decision {
    fn label(self) -> &'static str {
        match self {
            Decision::Accepted => "accepted",
            Decision::Rejected => "rejected",
            Decision::Error => "error",
        }
    }
}

/// What ended a challenge.
#[derive(Debug, Clone, Copy)]
pub enum FinalizationPath {
    /// Terminated through the regular finish flow.
    Normal,
    /// Cleaned up after a disconnection or inactivity window.
    Timeout,
}

/// How a store operation resolved.
#[derive(Debug, Clone, Copy)]
pub enum StoreOutcome {
    /// Succeeded on the first attempt.
    Ok,
    /// Succeeded after at least one retry.
    Retried,
    /// Every retry failed as unavailable.
    Exhausted,
    /// Failed prima facie.
    Error,
}

impl StoreOutcome {
    fn label(self) -> &'static str {
        match self {
            StoreOutcome::Ok => "ok",
            StoreOutcome::Retried => "retried",
            StoreOutcome::Exhausted => "exhausted",
            StoreOutcome::Error => "error",
        }
    }
}

/// How a processing run attempt settled.
#[derive(Debug, Clone, Copy)]
pub enum RunResult {
    Finished,
    Failed,
    TimedOut,
}

impl RunResult {
    fn label(self) -> &'static str {
        match self {
            RunResult::Finished => "finished",
            RunResult::Failed => "failed",
            RunResult::TimedOut => "timed_out",
        }
    }
}

fn type_label(challenge_type: ChallengeType) -> &'static str {
    match challenge_type {
        ChallengeType::UnknownChallenge => "unknown",
        ChallengeType::Tob => "tob",
        ChallengeType::Cox => "cox",
        ChallengeType::Toa => "toa",
        ChallengeType::Colosseum => "colosseum",
        ChallengeType::Inferno => "inferno",
        ChallengeType::Mokhaiotl => "mokhaiotl",
    }
}

fn mode_label(mode: ChallengeMode) -> &'static str {
    match mode {
        ChallengeMode::NoMode => "no_mode",
        ChallengeMode::TobEntry => "tob_entry",
        ChallengeMode::TobRegular => "tob_regular",
        ChallengeMode::TobHard => "tob_hard",
        _ => unimplemented!("unsupported mode: {mode:?}"),
    }
}

fn recording_type_label(recording_type: RecordingType) -> &'static str {
    match recording_type {
        RecordingType::Spectator => "spectator",
        RecordingType::Participant => "participant",
    }
}

fn status_label(status: ChallengeStatus) -> &'static str {
    match status {
        ChallengeStatus::InProgress => "in_progress",
        ChallengeStatus::Completed => "completed",
        ChallengeStatus::Reset => "reset",
        ChallengeStatus::Wiped => "wiped",
        ChallengeStatus::Abandoned => "abandoned",
    }
}

// Solo challenges collapse into one label to keep cardinality bounded.
fn stage_label(stage: Stage) -> String {
    match stage.challenge_type() {
        Some(ChallengeType::Colosseum) => "colosseum_any".to_owned(),
        Some(ChallengeType::Inferno) => "inferno_any".to_owned(),
        Some(ChallengeType::Mokhaiotl) => "mokhaiotl_any".to_owned(),
        Some(ChallengeType::Tob | ChallengeType::Cox | ChallengeType::Toa) => {
            stage.as_str_name().to_lowercase()
        }
        Some(ChallengeType::UnknownChallenge) | None => "unknown".to_owned(),
    }
}

fn bool_label(value: bool) -> &'static str {
    if value { "true" } else { "false" }
}

/// Records a served HTTP request.
pub fn observe_http_request(route: &str, method: &str, status: u16, duration_ms: f64) {
    let status = status.to_string();
    let labels = [route, method, status.as_str()];
    HTTP_REQUESTS.with_label_values(&labels).inc();
    HTTP_REQUEST_DURATION
        .with_label_values(&labels)
        .observe(duration_ms);
}

/// Records a challenge start request's outcome.
pub fn record_challenge_request(
    action: RequestAction,
    challenge_type: ChallengeType,
    mode: ChallengeMode,
    recording_type: RecordingType,
    decision: Decision,
) {
    let action = match action {
        RequestAction::Create => "create",
        RequestAction::Join => "join",
    };
    CHALLENGE_REQUESTS
        .with_label_values(&[
            action,
            type_label(challenge_type),
            mode_label(mode),
            recording_type_label(recording_type),
            decision.label(),
        ])
        .inc();
}

/// Records a client's reconnection attempt to an active challenge.
pub fn record_client_reconnect(recording_type: RecordingType, decision: Decision) {
    CLIENT_RECONNECTS
        .with_label_values(&[recording_type_label(recording_type), decision.label()])
        .inc();
}

/// Records a challenge finish request's outcome.
pub fn record_finish_request(all_clients_done: bool, decision: Decision) {
    FINISH_REQUESTS
        .with_label_values(&[bool_label(all_clients_done), decision.label()])
        .inc();
}

/// Records the final outcome of a challenge.
pub fn record_challenge_finalization(path: FinalizationPath, status: ChallengeStatus) {
    let path = match path {
        FinalizationPath::Normal => "normal",
        FinalizationPath::Timeout => "timeout",
    };
    CHALLENGE_FINALIZATION
        .with_label_values(&[path, status_label(status)])
        .inc();
}

/// Records the start of a challenge stage.
pub fn record_stage_start(challenge_type: ChallengeType, mode: ChallengeMode, stage: Stage) {
    STAGE_STARTS
        .with_label_values(&[
            type_label(challenge_type),
            mode_label(mode),
            &stage_label(stage),
        ])
        .inc();
}

/// Records the duration of a stage processing run attempt.
pub fn observe_stage_processing_duration(stage: Stage, duration_ms: f64) {
    STAGE_PROCESSING_DURATION
        .with_label_values(&[&stage_label(stage)])
        .observe(duration_ms);
}

/// Records an attempt to write stage events to the data repository.
pub fn record_stage_events_write(success: bool) {
    let result = if success { "success" } else { "error" };
    REPOSITORY_WRITES
        .with_label_values(&["challenge", "stage_events", result])
        .inc();
}

/// Records the number of queryable events written for a stage.
pub fn record_queryable_events(stage: Stage, count: usize) {
    QUERYABLE_EVENTS
        .with_label_values(&[&stage_label(stage)])
        .inc_by(u64::try_from(count).unwrap_or(u64::MAX));
}

/// Records a mismatch between reported and recorded challenge times.
pub fn record_reported_time_mismatch() {
    REPORTED_TIME_MISMATCHES
        .with_label_values(&["challenge"])
        .inc();
}

/// Sets the number of challenges this instance is running.
pub fn set_active_challenges(count: usize) {
    ACTIVE_CHALLENGES.set(i64::try_from(count).unwrap_or(i64::MAX));
}

/// Records a session's record being finalized.
pub fn record_session_finalized() {
    SESSIONS_FINALIZED.inc();
}

/// Records a store operation's outcome.
pub fn record_store_operation(op: &'static str, outcome: StoreOutcome) {
    STORE_OPERATIONS
        .with_label_values(&[op, outcome.label()])
        .inc();
}

/// Records the outcome of a processing run attempt.
pub fn record_processing_run(trigger: Trigger, outcome: RunResult) {
    let trigger = match trigger {
        Trigger::Create { .. } => "create",
        Trigger::Recorder { .. } => "recorder",
        Trigger::StageStart { .. } => "stage_start",
        Trigger::Mode { .. } => "mode",
        Trigger::Stage { .. } => "stage",
        Trigger::Finish { .. } => "finish",
    };
    PROCESSING_RUNS
        .with_label_values(&[trigger, outcome.label()])
        .inc();
}

/// Encodes all registered metrics in Prometheus text format.
#[must_use]
pub fn encode_metrics() -> String {
    let encoder = TextEncoder::new();
    let metric_families = prometheus::gather();
    encoder
        .encode_to_string(&metric_families)
        .unwrap_or_default()
}

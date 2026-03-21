use std::sync::LazyLock;

use prometheus::{
    Histogram, IntCounter, IntCounterVec, IntGauge, IntGaugeVec, Opts, TextEncoder,
    register_histogram, register_int_counter, register_int_counter_vec, register_int_gauge,
    register_int_gauge_vec,
};

/// Active challenge readers, labeled by challenge type.
pub static ACTIVE_READERS: LazyLock<IntGaugeVec> = LazyLock::new(|| {
    register_int_gauge_vec!(
        Opts::new(
            "live_server_active_readers",
            "Number of active challenge readers"
        ),
        &["challenge_type"]
    )
    .unwrap()
});

/// Total active SSE subscriber connections.
pub static ACTIVE_SUBSCRIBERS: LazyLock<IntGauge> = LazyLock::new(|| {
    register_int_gauge!(Opts::new(
        "live_server_active_subscribers",
        "Total SSE connections"
    ))
    .unwrap()
});

/// Total SSE connections opened, labeled by challenge type.
pub static SUBSCRIBER_CONNECTIONS_TOTAL: LazyLock<IntCounterVec> = LazyLock::new(|| {
    register_int_counter_vec!(
        Opts::new(
            "live_server_subscriber_connections_total",
            "SSE connections opened"
        ),
        &["challenge_type"]
    )
    .unwrap()
});

/// Total SSE connections closed, labeled by challenge type and reason.
pub static SUBSCRIBER_DISCONNECTIONS_TOTAL: LazyLock<IntCounterVec> = LazyLock::new(|| {
    register_int_counter_vec!(
        Opts::new(
            "live_server_subscriber_disconnections_total",
            "SSE connections closed"
        ),
        &["challenge_type", "reason"]
    )
    .unwrap()
});

/// Time for the pipelined Redis poll phase per global tick.
pub static REDIS_POLL_DURATION: LazyLock<Histogram> = LazyLock::new(|| {
    register_histogram!(
        "live_server_redis_poll_duration_seconds",
        "Time for the pipelined XRANGE poll phase per global tick"
    )
    .unwrap()
});

/// Time for the broadcast phase per global tick.
pub static BROADCAST_TICK_DURATION: LazyLock<Histogram> = LazyLock::new(|| {
    register_histogram!(
        "live_server_broadcast_tick_duration_seconds",
        "Time for the broadcast phase per global tick"
    )
    .unwrap()
});

/// Time to complete a full-stream backfill batch.
pub static BACKFILL_DURATION: LazyLock<Histogram> = LazyLock::new(|| {
    register_histogram!(
        "live_server_backfill_duration_seconds",
        "Time to complete a full-stream backfill"
    )
    .unwrap()
});

/// Primary client switches, labeled by reason.
pub static PRIMARY_SWITCHES_TOTAL: LazyLock<IntCounterVec> = LazyLock::new(|| {
    register_int_counter_vec!(
        Opts::new(
            "live_server_primary_switches_total",
            "Primary client switches"
        ),
        &["reason"]
    )
    .unwrap()
});

/// Reset events sent, labeled by reason.
pub static RESETS_TOTAL: LazyLock<IntCounterVec> = LazyLock::new(|| {
    register_int_counter_vec!(
        Opts::new("live_server_resets_total", "Reset events sent"),
        &["reason"]
    )
    .unwrap()
});

/// Times the jitter buffer triggered multi-tick bundling.
pub static LAG_RECOVERIES_TOTAL: LazyLock<IntCounter> = LazyLock::new(|| {
    register_int_counter!(Opts::new(
        "live_server_lag_recoveries_total",
        "Lag recovery events"
    ))
    .unwrap()
});

/// Times a challenge entered stalled state.
pub static STALLED_CHALLENGES_TOTAL: LazyLock<IntCounter> = LazyLock::new(|| {
    register_int_counter!(Opts::new(
        "live_server_stalled_challenges_total",
        "Challenges that entered stalled state"
    ))
    .unwrap()
});

/// Encodes all registered metrics in Prometheus text format.
pub fn encode_metrics() -> String {
    let encoder = TextEncoder::new();
    let metric_families = prometheus::gather();
    encoder
        .encode_to_string(&metric_families)
        .unwrap_or_default()
}

//! Journal determinism tests.

use super::*;
use crate::lifecycle::sim::run;

#[tokio::test(start_paused = true)]
async fn identical_runs_produce_identical_traces() {
    let first = run(solo_colosseum()).await;
    let second = run(solo_colosseum()).await;
    assert_eq!(first.normalized_trace(), second.normalized_trace());
}

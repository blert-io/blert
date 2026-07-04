//! Journal determinism tests.

use super::*;
use crate::lifecycle::sim::run;

#[tokio::test(start_paused = true)]
async fn identical_runs_produce_identical_traces() {
    let first = run(solo_colosseum()).await;
    let second = run(solo_colosseum()).await;

    // The uuids differ between runs, so compare with them normalized.
    let (first_uuid, _) = first.only_challenge();
    let (second_uuid, _) = second.only_challenge();
    let normalized = second
        .trace()
        .replace(&second_uuid.to_string(), &first_uuid.to_string());
    assert_eq!(first.trace(), normalized);
}

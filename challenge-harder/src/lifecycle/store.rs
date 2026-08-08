//! The live state storage contract shared by lifecycle actors.

use core::future::Future;
use core::time::Duration;

use super::core::types::Uuid;
use crate::metrics::{self, StoreOutcome};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StoreError {
    /// A newer incarnation owns the challenge; the challenge must exit.
    #[error("fenced off by a newer incarnation")]
    Fenced,
    /// The operation could not be completed.
    #[error("store unavailable: {0}")]
    Unavailable(String),
    /// Stored state exists but cannot be interpreted.
    #[error("corrupt state: {0}")]
    Corrupt(String),
}

// Transient store failures are retried inline before the caller gives up.
const STORE_ATTEMPTS: u32 = 3;
const STORE_RETRY_DELAY: Duration = Duration::from_millis(250);

/// Runs a store operation, retrying transient failures.
pub(crate) async fn with_retries<T, F, Fut>(
    uuid: Uuid,
    name: &'static str,
    op: F,
) -> Result<T, StoreError>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<T, StoreError>>,
{
    let mut attempts = STORE_ATTEMPTS;
    loop {
        match op().await {
            Err(StoreError::Unavailable(reason)) if attempts > 1 => {
                attempts -= 1;
                tracing::warn!(%uuid, reason, "store_retry");
                tokio::time::sleep(STORE_RETRY_DELAY).await;
            }
            result => {
                let outcome = match &result {
                    Ok(_) if attempts == STORE_ATTEMPTS => StoreOutcome::Ok,
                    Ok(_) => StoreOutcome::Retried,
                    Err(StoreError::Unavailable(_)) => StoreOutcome::Exhausted,
                    Err(StoreError::Fenced | StoreError::Corrupt(_)) => StoreOutcome::Error,
                };
                metrics::record_store_operation(name, outcome);
                return result;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering};

    use super::*;

    #[tokio::test(start_paused = true)]
    async fn transient_failures_retry_until_success() {
        let calls = AtomicU32::new(0);
        let result = with_retries(Uuid::new_v4(), "test", || {
            let call = calls.fetch_add(1, Ordering::Relaxed) + 1;
            async move {
                if call < 3 {
                    Err(StoreError::Unavailable("scripted".into()))
                } else {
                    Ok(call)
                }
            }
        })
        .await;
        assert_eq!(result, Ok(3));
    }

    #[tokio::test(start_paused = true)]
    async fn persistent_transient_failures_exhaust() {
        let calls = AtomicU32::new(0);
        let result: Result<(), StoreError> = with_retries(Uuid::new_v4(), "test", || {
            calls.fetch_add(1, Ordering::Relaxed);
            async { Err(StoreError::Unavailable("scripted".into())) }
        })
        .await;
        assert_eq!(result, Err(StoreError::Unavailable("scripted".into())));
        assert_eq!(calls.load(Ordering::Relaxed), 3);
    }

    #[tokio::test(start_paused = true)]
    async fn permanent_errors_fail_without_retrying() {
        let calls = AtomicU32::new(0);
        let result: Result<(), StoreError> = with_retries(Uuid::new_v4(), "test", || {
            calls.fetch_add(1, Ordering::Relaxed);
            async { Err(StoreError::Fenced) }
        })
        .await;
        assert_eq!(result, Err(StoreError::Fenced));
        assert_eq!(calls.load(Ordering::Relaxed), 1);

        let result: Result<(), StoreError> = with_retries(Uuid::new_v4(), "test", || {
            calls.fetch_add(1, Ordering::Relaxed);
            async { Err(StoreError::Corrupt("scripted".into())) }
        })
        .await;
        assert_eq!(result, Err(StoreError::Corrupt("scripted".into())));
        assert_eq!(calls.load(Ordering::Relaxed), 2);
    }
}

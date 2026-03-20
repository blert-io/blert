use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{Mutex, mpsc};

use crate::broadcast::BroadcastManager;
use crate::redis::{self, RedisQuery, RedisResponse, STREAM_START_CURSOR, StageStreamEntry};

/// How long to wait after the first backfill request for additional requests
/// to arrive before executing the batch. Keeps latency negligible (< 10% of a
/// game tick) while giving concurrent requests a window to coalesce.
const BATCH_WINDOW: Duration = Duration::from_millis(50);

/// A request to backfill a challenge stage from the beginning of its stream.
pub struct BackfillRequest {
    pub challenge_id: String,
    pub backfill_id: u64,
    pub stage: i32,
    pub attempt: Option<u32>,
}

/// The result of a backfill operation containing raw entries from the stream.
pub struct BackfillResult {
    pub challenge_id: String,
    pub backfill_id: u64,
    pub entries: Vec<StageStreamEntry>,
    pub last_stream_id: String,
}

impl BackfillResult {
    fn empty(challenge_id: String, backfill_id: u64) -> Self {
        Self {
            challenge_id,
            backfill_id,
            entries: Vec::new(),
            last_stream_id: STREAM_START_CURSOR.to_string(),
        }
    }
}

/// Manages backfill operations, batching concurrent requests into single
/// Redis pipeline round-trips.
///
/// Runs its own async loop: waits for the first request, gives a short
/// window for additional requests to coalesce, then builds a single
/// pipelined XRANGE for all of them and returns the raw entries.
pub struct BackfillManager {
    redis_conn: ::redis::aio::MultiplexedConnection,
    request_rx: mpsc::UnboundedReceiver<BackfillRequest>,
    result_tx: mpsc::UnboundedSender<BackfillResult>,
}

impl BackfillManager {
    pub fn new(
        redis_conn: ::redis::aio::MultiplexedConnection,
        request_rx: mpsc::UnboundedReceiver<BackfillRequest>,
        result_tx: mpsc::UnboundedSender<BackfillResult>,
    ) -> Self {
        Self {
            redis_conn,
            request_rx,
            result_tx,
        }
    }

    /// Runs the backfill loop until the request channel closes.
    pub async fn run(mut self) {
        tracing::info!("backfill manager started");

        loop {
            // Block until the first request arrives.
            let Some(first) = self.request_rx.recv().await else {
                break;
            };

            // Wait briefly for additional requests to coalesce into a batch.
            let mut requests = vec![first];
            let deadline = tokio::time::Instant::now() + BATCH_WINDOW;
            while let Ok(Some(req)) =
                tokio::time::timeout_at(deadline, self.request_rx.recv()).await
            {
                requests.push(req);
            }

            tracing::debug!(count = requests.len(), "processing backfill batch");

            // Build a single pipeline with one XRANGE per request.
            let queries: Vec<RedisQuery> = requests
                .iter()
                .map(|r| RedisQuery::StageStream {
                    uuid: r.challenge_id.clone(),
                    stage: r.stage,
                    attempt: r.attempt,
                    cursor: STREAM_START_CURSOR.to_string(),
                })
                .collect();

            let responses = redis::execute(&mut self.redis_conn, &queries).await;

            match responses {
                Ok(responses) => {
                    for (req, resp) in requests.into_iter().zip(responses) {
                        let result = match resp {
                            RedisResponse::StageStream(entries) => {
                                let last_stream_id = entries.last().map_or_else(
                                    || STREAM_START_CURSOR.to_string(),
                                    |e| e.id.clone(),
                                );
                                BackfillResult {
                                    challenge_id: req.challenge_id,
                                    backfill_id: req.backfill_id,
                                    entries,
                                    last_stream_id,
                                }
                            }
                            _ => BackfillResult::empty(req.challenge_id, req.backfill_id),
                        };
                        if self.result_tx.send(result).is_err() {
                            return;
                        }
                    }
                }
                Err(e) => {
                    tracing::error!("backfill pipeline error: {e}");
                    for req in requests {
                        if self
                            .result_tx
                            .send(BackfillResult::empty(req.challenge_id, req.backfill_id))
                            .is_err()
                        {
                            return;
                        }
                    }
                }
            }
        }

        tracing::info!("backfill manager stopped");
    }
}

/// Receives completed backfill results and applies them to readers.
pub async fn run_backfill_receiver(
    manager: Arc<Mutex<BroadcastManager>>,
    mut result_rx: mpsc::UnboundedReceiver<BackfillResult>,
) {
    while let Some(result) = result_rx.recv().await {
        let mut mgr = manager.lock().await;
        mgr.apply_backfill(result);
    }
}

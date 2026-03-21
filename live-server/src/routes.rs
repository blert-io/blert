use base64::Engine as _;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use axum::Json;
use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::response::sse::{Event, KeepAlive, Sse};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tokio_stream::StreamExt as _;
use tokio_stream::wrappers::UnboundedReceiverStream;

use crate::AppState;
use crate::broadcast::{BroadcastError, BroadcastManager, SubscriberHandle};
use crate::message::SseMessage;
use crate::rate_limit::ConnectionGuard;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    status: &'static str,
    uptime_secs: u64,
}

pub async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy",
        uptime_secs: state.start_time.elapsed().as_secs(),
    })
}

pub async fn ping() -> impl IntoResponse {
    "pong"
}

#[derive(Deserialize)]
pub struct LiveQuery {
    stage: Option<i32>,
}

pub async fn live(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(challenge_id): Path<String>,
    Query(query): Query<LiveQuery>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    let conn_guard = state
        .rate_limiter
        .try_acquire(addr.ip())
        .map_err(|_| StatusCode::TOO_MANY_REQUESTS)?;

    let (handle, receiver) = {
        let mut mgr = state.broadcast_manager.lock().await;
        mgr.subscribe(challenge_id.clone(), query.stage)
            .await
            .map_err(|e| match e {
                BroadcastError::ChallengeNotFound(_) => StatusCode::NOT_FOUND,
                BroadcastError::ShuttingDown => StatusCode::SERVICE_UNAVAILABLE,
                _ => {
                    tracing::error!(challenge_id = %challenge_id, "subscribe error: {e}");
                    StatusCode::INTERNAL_SERVER_ERROR
                }
            })?
    };

    let unsub = Unsubscribe {
        manager: state.broadcast_manager.clone(),
        handle: Some(handle),
        _conn_guard: conn_guard,
    };

    let stream = UnboundedReceiverStream::new(receiver).map(|msg| Ok(sse_event(&msg)));

    // Wrap with the unsubscribe guard so cleanup runs when the stream drops.
    let stream = UnsubscribeStream {
        inner: stream,
        _unsub: unsub,
    };

    Ok(Sse::new(stream).keep_alive(KeepAlive::new().text("skitter")))
}

fn sse_event(msg: &SseMessage) -> Event {
    match msg {
        SseMessage::Metadata {
            challenge_type,
            mode,
            stage,
            attempt,
            stage_active,
            party,
        } => Event::default().event("metadata").data(
            serde_json::json!({
                "type": challenge_type,
                "mode": mode,
                "stage": stage,
                "attempt": attempt,
                "stageActive": stage_active,
                "party": party,
            })
            .to_string(),
        ),
        SseMessage::Reset {
            reason,
            stage,
            attempt,
            stage_active,
            generation,
        } => Event::default().event("reset").data(
            serde_json::json!({
                "reason": reason.as_str(),
                "stage": stage,
                "attempt": attempt,
                "stageActive": stage_active,
                "generation": generation,
            })
            .to_string(),
        ),
        SseMessage::ReplayChunk {
            generation,
            start_tick,
            tick_count,
            data,
        } => Event::default()
            .event("replay-chunk")
            .id(format!("{generation}:{}", start_tick + tick_count - 1))
            .data(
                serde_json::json!({
                    "generation": generation,
                    "startTick": start_tick,
                    "tickCount": tick_count,
                    "data": base64::engine::general_purpose::STANDARD.encode(data),
                })
                .to_string(),
            ),
        SseMessage::ReplayEnd { generation, tick } => Event::default()
            .event("replay-end")
            .id(format!("{generation}:{tick}"))
            .data(serde_json::json!({"generation": generation, "tick": tick}).to_string()),
        SseMessage::Tick {
            generation,
            tick,
            tick_count,
            data,
        } => Event::default()
            .event("tick")
            .id(format!("{generation}:{}", tick + tick_count - 1))
            .data(
                serde_json::json!({
                    "generation": generation,
                    "tick": tick,
                    "tickCount": tick_count,
                    "data": base64::engine::general_purpose::STANDARD.encode(data),
                })
                .to_string(),
            ),
        SseMessage::StageChange { stage, attempt } => Event::default()
            .event("stage-change")
            .data(serde_json::json!({"stage": stage, "attempt": attempt}).to_string()),
        SseMessage::StageEnd { stage, attempt } => Event::default()
            .event("stage-end")
            .data(serde_json::json!({"stage": stage, "attempt": attempt}).to_string()),
        SseMessage::Stalled { reason } => Event::default()
            .event("stalled")
            .data(serde_json::json!({"reason": reason.to_string()}).to_string()),
        SseMessage::Complete => Event::default().event("complete").data("{}"),
        SseMessage::Shutdown { retry_window_secs } => Event::default()
            .event("shutdown")
            .data(serde_json::json!({"retryWindow": retry_window_secs}).to_string()),
    }
}

/// Drop guard that unsubscribes from the broadcast manager and releases the
/// rate limiter connection slot.
struct Unsubscribe {
    manager: Arc<Mutex<BroadcastManager>>,
    handle: Option<SubscriberHandle>,
    _conn_guard: ConnectionGuard,
}

impl Drop for Unsubscribe {
    fn drop(&mut self) {
        let Some(handle) = self.handle.take() else {
            return;
        };
        let manager = self.manager.clone();

        tokio::spawn(async move {
            let mut mgr = manager.lock().await;
            mgr.unsubscribe(handle);
        });
    }
}

pin_project_lite::pin_project! {
    struct UnsubscribeStream<S> {
        #[pin]
        inner: S,
        _unsub: Unsubscribe,
    }
}

impl<S: tokio_stream::Stream> tokio_stream::Stream for UnsubscribeStream<S> {
    type Item = S::Item;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.project().inner.poll_next(cx)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
    }
}

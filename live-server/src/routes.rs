use std::convert::Infallible;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use axum::Json;
use axum::extract::{Path, Query, State};
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
    Path(challenge_id): Path<String>,
    Query(query): Query<LiveQuery>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    let (handle, receiver) = {
        let mut mgr = state.broadcast_manager.lock().await;
        mgr.subscribe(challenge_id.clone(), query.stage)
            .await
            .map_err(|e| {
                if let BroadcastError::ChallengeNotFound(_) = e {
                    StatusCode::NOT_FOUND
                } else {
                    tracing::error!(challenge_id = %challenge_id, "subscribe error: {e}");
                    StatusCode::INTERNAL_SERVER_ERROR
                }
            })?
    };

    let unsub = Unsubscribe {
        manager: state.broadcast_manager.clone(),
        handle: Some(handle),
    };

    let stream = UnboundedReceiverStream::new(receiver).map(|msg| Ok(sse_event(&msg)));

    // Wrap with the unsubscribe guard so cleanup runs when the stream drops.
    let stream = UnsubscribeStream {
        inner: stream,
        _unsub: unsub,
    };

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

fn sse_event(msg: &SseMessage) -> Event {
    // TODO(frolv): Full JSON serialization for data-carrying messages.
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
        SseMessage::Reset { .. } => Event::default().event("reset").data("{}"),
        SseMessage::ReplayChunk { .. } => Event::default().event("replay-chunk").data("{}"),
        SseMessage::ReplayEnd { .. } => Event::default().event("replay-end").data("{}"),
        SseMessage::Tick { .. } => Event::default().event("tick").data("{}"),
        SseMessage::StageChange { stage, attempt } => Event::default()
            .event("stage-change")
            .data(serde_json::json!({"stage": stage, "attempt": attempt}).to_string()),
        SseMessage::StageEnd { stage, attempt } => Event::default()
            .event("stage-end")
            .data(serde_json::json!({"stage": stage, "attempt": attempt}).to_string()),
        SseMessage::Stalled { .. } => Event::default().event("stalled").data("{}"),
        SseMessage::Complete => Event::default().event("complete").data("{}"),
        SseMessage::Shutdown { .. } => Event::default().event("shutdown").data("{}"),
        SseMessage::KeepAlive => Event::default().comment("skitter"),
    }
}

/// Drop guard that unsubscribes from the broadcast manager.
struct Unsubscribe {
    manager: Arc<Mutex<BroadcastManager>>,
    handle: Option<SubscriberHandle>,
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

//! HTTP API through which clients drive challenges.
//!
//! Routes and body shapes mirror the current `challenge-server/api.ts`.

use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use axum::routing::post;
use serde::{Deserialize, Serialize};
use tower_http::trace::TraceLayer;

use crate::lifecycle::coordinator::{CommandError, Coordinator};
use crate::lifecycle::core::command::{
    ClientStatus, ClientStatusChange, Create, Finish, Join, StageProgress, Update,
};
use crate::lifecycle::core::state::Snapshot;
use crate::lifecycle::core::types::{
    ChallengeMode, ChallengeType, ClientId, RecordingType, ReportedTimes, SessionToken, Stage,
    UserId, Uuid,
};

pub fn router(coordinator: Arc<Coordinator>) -> Router {
    Router::new()
        .route("/challenges/new", post(new_challenge))
        .route("/challenges/{challenge_id}", post(update_challenge))
        .route("/challenges/{challenge_id}/finish", post(finish_challenge))
        .route("/challenges/{challenge_id}/join", post(join_challenge))
        .route("/client-status", post(client_status))
        .layer(TraceLayer::new_for_http())
        .with_state(coordinator)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewChallengeRequest {
    user_id: UserId,
    client_id: ClientId,
    session_token: SessionToken,
    plugin_version: String,
    rune_lite_version: String,
    #[serde(rename = "type")]
    challenge_type: ChallengeType,
    mode: ChallengeMode,
    party: Vec<String>,
    stage: Stage,
    recording_type: RecordingType,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateChallengeRequest {
    user_id: UserId,
    client_id: ClientId,
    session_token: SessionToken,
    update: ChallengeUpdate,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChallengeUpdate {
    mode: Option<ChallengeMode>,
    stage: Option<StageProgress>,
    party: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FinishChallengeRequest {
    user_id: UserId,
    client_id: ClientId,
    session_token: SessionToken,
    times: Option<ReportedTimes>,
    soft: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinChallengeRequest {
    user_id: UserId,
    client_id: ClientId,
    session_token: SessionToken,
    plugin_version: String,
    rune_lite_version: String,
    recording_type: RecordingType,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientStatusRequest {
    user_id: UserId,
    client_id: ClientId,
    session_token: SessionToken,
    status: ClientStatus,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChallengeResponse {
    uuid: Uuid,
    mode: ChallengeMode,
    stage: Stage,
    stage_attempt: Option<u32>,
}

impl From<Snapshot> for ChallengeResponse {
    fn from(p: Snapshot) -> Self {
        ChallengeResponse {
            uuid: p.uuid,
            mode: p.mode,
            stage: p.stage,
            stage_attempt: p.stage_attempt,
        }
    }
}

fn error_response(status: StatusCode, message: &str) -> Response {
    let body = serde_json::json!({ "error": { "message": message } });
    (status, Json(body)).into_response()
}

fn command_error(e: CommandError) -> Response {
    match e {
        CommandError::UnknownChallenge => {
            error_response(StatusCode::BAD_REQUEST, "challenge does not exist")
        }
        CommandError::AlreadyInChallenge => {
            error_response(StatusCode::BAD_REQUEST, "client is already in a challenge")
        }
        CommandError::Unavailable => {
            error_response(StatusCode::INTERNAL_SERVER_ERROR, "challenge is gone")
        }
    }
}

async fn new_challenge(
    State(coordinator): State<Arc<Coordinator>>,
    Json(req): Json<NewChallengeRequest>,
) -> Response {
    let create = Create {
        user_id: req.user_id,
        client_id: req.client_id,
        session_token: req.session_token,
        plugin_version: req.plugin_version,
        runelite_version: req.rune_lite_version,
        challenge_type: req.challenge_type,
        mode: req.mode,
        party: req.party,
        stage: req.stage,
        recording_type: req.recording_type,
    };

    match coordinator.create_or_join_challenge(create).await {
        Some(p) => Json(ChallengeResponse::from(p)).into_response(),
        None => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "challenge failed to start",
        ),
    }
}

async fn update_challenge(
    State(coordinator): State<Arc<Coordinator>>,
    Path(challenge_id): Path<Uuid>,
    Json(req): Json<UpdateChallengeRequest>,
) -> Response {
    let update = Update {
        user_id: req.user_id,
        client_id: req.client_id,
        session_token: req.session_token,
        mode: req.update.mode,
        stage: req.update.stage,
        party: req.update.party,
    };

    match coordinator.update(challenge_id, update).await {
        Ok(p) => Json(ChallengeResponse::from(p)).into_response(),
        Err(e) => command_error(e),
    }
}

async fn client_status(
    State(coordinator): State<Arc<Coordinator>>,
    Json(req): Json<ClientStatusRequest>,
) -> Response {
    let change = ClientStatusChange {
        user_id: req.user_id,
        client_id: req.client_id,
        session_token: req.session_token,
        status: req.status,
    };

    match coordinator.update_client_status(change).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(e) => command_error(e),
    }
}

async fn join_challenge(
    State(coordinator): State<Arc<Coordinator>>,
    Path(challenge_id): Path<Uuid>,
    Json(req): Json<JoinChallengeRequest>,
) -> Response {
    let join = Join {
        user_id: req.user_id,
        client_id: req.client_id,
        session_token: req.session_token,
        plugin_version: req.plugin_version,
        runelite_version: req.rune_lite_version,
        recording_type: req.recording_type,
    };

    match coordinator.rejoin(challenge_id, join).await {
        Ok(p) => Json(ChallengeResponse::from(p)).into_response(),
        Err(e) => command_error(e),
    }
}

async fn finish_challenge(
    State(coordinator): State<Arc<Coordinator>>,
    Path(challenge_id): Path<Uuid>,
    Json(req): Json<FinishChallengeRequest>,
) -> Response {
    let finish = Finish {
        user_id: req.user_id,
        client_id: req.client_id,
        session_token: req.session_token,
        times: req.times,
        soft: req.soft,
    };

    match coordinator.finish(challenge_id, finish).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(e) => command_error(e),
    }
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use super::*;
    use crate::lifecycle::sim::Collector;

    fn test_router() -> Router {
        let (tx, rx) = tokio::sync::watch::channel(false);
        std::mem::forget(tx);
        router(Arc::new(Coordinator::with_store(
            Arc::new(Collector::default()),
            rx,
        )))
    }

    async fn post(router: &Router, path: &str, body: &Value) -> (StatusCode, Value) {
        let response = router
            .clone()
            .oneshot(
                Request::post(path)
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let value = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap()
        };
        (status, value)
    }

    fn stage_update(stage: i32, status: i32) -> Value {
        json!({
            "userId": 1, "clientId": 10, "sessionToken": "tok",
            "update": { "stage": { "stage": stage, "status": status } },
        })
    }

    #[tokio::test]
    async fn drives_a_challenge_over_http() {
        let router = test_router();

        let (status, body) = post(
            &router,
            "/challenges/new",
            &json!({
                "userId": 1, "clientId": 10, "sessionToken": "tok",
                "pluginVersion": "0.9.14", "runeLiteVersion": "1.12.31.1",
                "type": 1, "mode": 11, "party": ["WWWWWWWWWWQQ"], "stage": 10,
                "recordingType": 1,
            }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["mode"], 11);
        assert_eq!(body["stage"], 10);
        assert_eq!(body["stageAttempt"], Value::Null);
        let uuid = body["uuid"].as_str().expect("uuid in response").to_owned();

        // Maiden start, complete, then Bloat start.
        let path = format!("/challenges/{uuid}");
        let (status, body) = post(&router, &path, &stage_update(10, 1)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["stage"], 10);

        let (status, _) = post(&router, &path, &stage_update(10, 2)).await;
        assert_eq!(status, StatusCode::OK);

        let (status, body) = post(&router, &path, &stage_update(11, 1)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["stage"], 11);

        let (status, body) = post(&router, &path, &stage_update(11, 3)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["stage"], 11);

        // The client briefly logs out and back in.
        let (status, _) = post(
            &router,
            "/client-status",
            &json!({ "userId": 1, "clientId": 10, "sessionToken": "tok", "status": 1 }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let (status, _) = post(
            &router,
            "/client-status",
            &json!({ "userId": 1, "clientId": 10, "sessionToken": "tok", "status": 0 }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);

        let (status, _) = post(
            &router,
            &format!("/challenges/{uuid}/finish"),
            &json!({ "userId": 1, "clientId": 10, "sessionToken": "tok", "soft": false }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }

    #[tokio::test]
    async fn status_without_challenge_is_accepted() {
        let router = test_router();
        let (status, body) = post(
            &router,
            "/client-status",
            &json!({ "userId": 1, "clientId": 10, "sessionToken": "tok", "status": 2 }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, Value::Null);
    }

    #[tokio::test]
    async fn unknown_challenge_is_rejected() {
        let router = test_router();
        let (status, body) = post(
            &router,
            &format!("/challenges/{}", Uuid::from_u128(7)),
            &json!({
                "userId": 1, "clientId": 10, "sessionToken": "tok",
                "update": {},
            }),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"]["message"], "challenge does not exist");
    }

    fn join_body(user: i64, client: i64, token: &str) -> Value {
        json!({
            "userId": user, "clientId": client, "sessionToken": token,
            "pluginVersion": "0.9.14", "runeLiteVersion": "1.12.31.1",
            "recordingType": 1,
        })
    }

    #[tokio::test]
    async fn rejoin_resyncs_a_client() {
        let router = test_router();
        let (_, body) = post(
            &router,
            "/challenges/new",
            &json!({
                "userId": 1, "clientId": 10, "sessionToken": "tok",
                "pluginVersion": "0.9.14", "runeLiteVersion": "1.12.31.1",
                "type": 1, "mode": 11, "party": ["WWWWWWWWWWQQ"], "stage": 10,
                "recordingType": 1,
            }),
        )
        .await;
        let uuid = body["uuid"].as_str().expect("uuid in response").to_owned();

        let (status, _) = post(
            &router,
            &format!("/challenges/{uuid}"),
            &stage_update(10, 1),
        )
        .await;
        assert_eq!(status, StatusCode::OK);

        // The client reconnects with a fresh session token.
        let (status, body) = post(
            &router,
            &format!("/challenges/{uuid}/join"),
            &join_body(1, 10, "tok2"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["uuid"], uuid.as_str());
        assert_eq!(body["mode"], 11);
        assert_eq!(body["stage"], 10);
        assert_eq!(body["stageAttempt"], Value::Null);
    }

    #[tokio::test]
    async fn rejoin_of_unknown_challenge_is_rejected() {
        let router = test_router();
        let (status, body) = post(
            &router,
            &format!("/challenges/{}/join", Uuid::from_u128(7)),
            &join_body(1, 10, "tok"),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"]["message"], "challenge does not exist");
    }

    #[tokio::test]
    async fn rejoin_from_another_challenge_is_rejected() {
        let router = test_router();
        let (_, body) = post(
            &router,
            "/challenges/new",
            &json!({
                "userId": 1, "clientId": 10, "sessionToken": "tok",
                "pluginVersion": "0.9.14", "runeLiteVersion": "1.12.31.1",
                "type": 1, "mode": 11, "party": ["WWWWWWWWWWQQ"], "stage": 10,
                "recordingType": 1,
            }),
        )
        .await;
        let first = body["uuid"].as_str().expect("uuid in response").to_owned();

        let (_, body) = post(
            &router,
            "/challenges/new",
            &json!({
                "userId": 2, "clientId": 20, "sessionToken": "tok2",
                "pluginVersion": "0.9.14", "runeLiteVersion": "1.12.31.1",
                "type": 1, "mode": 11, "party": ["715"], "stage": 10,
                "recordingType": 1,
            }),
        )
        .await;
        let second = body["uuid"].as_str().expect("uuid in response").to_owned();
        assert_ne!(first, second);

        let (status, body) = post(
            &router,
            &format!("/challenges/{first}/join"),
            &join_body(2, 20, "tok2b"),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"]["message"], "client is already in a challenge");
    }
}

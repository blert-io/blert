use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;

use axum::Router;
use axum::routing::get;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, mpsc};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tracing_subscriber::EnvFilter;

mod backfill;
mod broadcast;
mod config;
mod message;
mod reader;
#[expect(dead_code)]
mod redis;
mod routes;
mod subscriber;

use broadcast::BroadcastManager;
use config::Config;

#[derive(Clone)]
pub struct AppState {
    pub start_time: Instant,
    pub broadcast_manager: Arc<Mutex<BroadcastManager>>,
}

#[tokio::main]
async fn main() {
    let config = Config::from_env();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_env("BLERT_LOG_LEVEL").unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .json()
        .init();

    let redis_client = ::redis::Client::open(config.redis_uri.as_str()).expect("invalid redis URI");

    // Set up backfill channels and manager.
    let (backfill_request_tx, backfill_request_rx) = mpsc::unbounded_channel();
    let (backfill_result_tx, backfill_result_rx) = mpsc::unbounded_channel();
    let backfill_conn = redis_client
        .get_multiplexed_async_connection()
        .await
        .expect("failed to connect to redis for backfill");
    let backfill_manager =
        backfill::BackfillManager::new(backfill_conn, backfill_request_rx, backfill_result_tx);

    let broadcast_manager = BroadcastManager::new(&redis_client, backfill_request_tx)
        .await
        .expect("failed to connect to redis");

    let state = AppState {
        start_time: Instant::now(),
        broadcast_manager: Arc::new(Mutex::new(broadcast_manager)),
    };

    tokio::spawn(backfill_manager.run());
    tokio::spawn(backfill::run_backfill_receiver(
        state.broadcast_manager.clone(),
        backfill_result_rx,
    ));
    broadcast::spawn_pubsub_listener(state.broadcast_manager.clone(), &redis_client)
        .await
        .expect("failed to subscribe to challenge updates");
    tokio::spawn(broadcast::run_tick_loop(state.broadcast_manager.clone()));

    let cors = CorsLayer::new().allow_origin(AllowOrigin::list(
        config
            .allowed_origins
            .iter()
            .map(|o| o.parse().expect("invalid origin")),
    ));

    let app = Router::new()
        .route("/health", get(routes::health))
        .route("/ping", get(routes::ping))
        .route("/challenges/{challenge_id}/live", get(routes::live))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!(port = config.port, "live server starting");

    let listener = TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

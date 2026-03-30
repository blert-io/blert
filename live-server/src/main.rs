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
mod metrics;
mod rate_limit;
mod reader;
mod redis;
mod routes;
mod subscriber;

use broadcast::BroadcastManager;
use config::Config;

#[derive(Clone)]
pub struct AppState {
    pub start_time: Instant,
    pub broadcast_manager: Arc<Mutex<BroadcastManager>>,
    pub rate_limiter: Arc<rate_limit::RateLimiter>,
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

    let pool = deadpool_redis::Config::from_url(&config.redis_uri)
        .create_pool(Some(deadpool_redis::Runtime::Tokio1))
        .expect("failed to create redis pool");

    // A dedicated client is used for pubsub.
    let redis_client = ::redis::Client::open(config.redis_uri.as_str()).expect("invalid redis URI");

    // Set up backfill channels and manager.
    let (backfill_request_tx, backfill_request_rx) = mpsc::unbounded_channel();
    let (backfill_result_tx, backfill_result_rx) = mpsc::unbounded_channel();
    let backfill_manager =
        backfill::BackfillManager::new(pool.clone(), backfill_request_rx, backfill_result_tx);

    let broadcast_manager = BroadcastManager::new(pool.clone(), backfill_request_tx);

    let rate_limiter = rate_limit::RateLimiter::new(
        config.rate_limit.max_requests,
        config.rate_limit.window,
        config.rate_limit.max_concurrent_connections,
    );

    let state = AppState {
        start_time: Instant::now(),
        broadcast_manager: Arc::new(Mutex::new(broadcast_manager)),
        rate_limiter: Arc::new(rate_limiter),
    };

    tokio::spawn(backfill_manager.run());
    tokio::spawn(backfill::run_backfill_receiver(
        state.broadcast_manager.clone(),
        backfill_result_rx,
    ));
    broadcast::spawn_pubsub_listener(state.broadcast_manager.clone(), redis_client);
    tokio::spawn(broadcast::run_tick_loop(state.broadcast_manager.clone()));

    let cors = CorsLayer::new().allow_origin(AllowOrigin::list(
        config
            .allowed_origins
            .iter()
            .map(|o| o.parse().expect("invalid origin")),
    ));

    let shutdown_manager = state.broadcast_manager.clone();

    let app = Router::new()
        .route("/health", get(routes::health))
        .route("/ping", get(routes::ping))
        .route("/metrics", get(routes::metrics))
        .route("/challenges/{challenge_id}/live", get(routes::live))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!(port = config.port, "live server starting");
    let shutdown_signal = async move {
        #[cfg(unix)]
        {
            use tokio::signal::unix::{SignalKind, signal};
            let mut sigterm =
                signal(SignalKind::terminate()).expect("failed to install SIGTERM handler");
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = sigterm.recv() => {}
            }
        }
        #[cfg(not(unix))]
        tokio::signal::ctrl_c().await.ok();

        tracing::info!("shutdown signal received, notifying subscribers");
        let mut mgr = shutdown_manager.lock().await;
        mgr.shutdown_all(10);
    };

    let listener = TcpListener::bind(addr).await.unwrap();
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal)
    .await
    .unwrap();
}

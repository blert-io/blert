use std::net::SocketAddr;
use std::time::Instant;

use axum::Router;
use axum::routing::get;
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

mod config;
mod routes;

use config::Config;

#[derive(Clone)]
pub struct AppState {
    pub start_time: Instant,
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

    let state = AppState {
        start_time: Instant::now(),
    };

    let app = Router::new()
        .route("/health", get(routes::health))
        .route("/ping", get(routes::ping))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!(port = config.port, "live server starting");

    let listener = TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

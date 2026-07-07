//! 2 Challenge 2 Server

#![forbid(unsafe_code)]
// clippy.toml's disallowed lists set determinism rules that only apply to
// core. Allow at the root so it can be selectively enabled.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]
#![deny(clippy::pedantic)]

mod api;
mod lifecycle;
mod players;
mod proto;
mod store;

use std::sync::Arc;

use lifecycle::coordinator::Coordinator;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3003);

    let redis_uri = std::env::var("BLERT_REDIS_URI").expect("BLERT_REDIS_URI must be set");
    let store = store::Store::connect(&redis_uri)
        .await
        .expect("failed to connect to Redis");
    tracing::info!("redis_connected");

    let coordinator = Arc::new(Coordinator::with_store(Arc::new(store)));

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .expect("failed to bind server port");
    tracing::info!(
        port,
        commit = option_env!("BLERT_COMMIT_SHA").unwrap_or("dev"),
        "challenge_server_listening"
    );

    axum::serve(listener, api::router(coordinator))
        .await
        .expect("server exited with an error");
}

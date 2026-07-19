//! 2 Challenge 2 Server

#![forbid(unsafe_code)]
// clippy.toml's disallowed lists set determinism rules that only apply to
// core. Allow at the root so it can be selectively enabled.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]
#![deny(clippy::pedantic)]

mod api;
mod lifecycle;
mod players;
mod processing;
mod proto;
mod shadow;
mod store;

use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use clap::{Parser, Subcommand};
use lifecycle::coordinator::Coordinator;
use lifecycle::core::deadline::LifecycleConfig;
use lifecycle::core::state::ProcessingConfig;

const CLAIM_SCAN_INTERVAL: Duration = Duration::from_secs(5);

/// Run attempts allowed per processing trigger.
const PROCESSING_MAX_ATTEMPTS: u32 = 3;

/// Connections held to the challenge database.
const DEFAULT_DB_POOL_SIZE: usize = 8;

#[derive(Parser)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Runs the challenge server.
    Serve,
    /// Shadow harness tooling.
    #[command(subcommand)]
    Shadow(shadow::Command),
}

#[tokio::main]
async fn main() -> ExitCode {
    match Cli::parse().command {
        None | Some(Command::Serve) => {
            serve(LifecycleConfig {
                processing: ProcessingConfig {
                    max_attempts: PROCESSING_MAX_ATTEMPTS,
                    ..ProcessingConfig::default()
                },
                ..LifecycleConfig::default()
            })
            .await;
            ExitCode::SUCCESS
        }
        Some(Command::Shadow(command)) => shadow::run(command).await,
    }
}

async fn serve(config: LifecycleConfig) {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with_ansi(std::io::IsTerminal::is_terminal(&std::io::stdout()))
        .init();

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3003);

    let redis_uri = std::env::var("BLERT_REDIS_URI").expect("BLERT_REDIS_URI must be set");
    let identity = std::env::var("HOSTNAME").expect("HOSTNAME must be set");
    let store = store::Store::connect(&redis_uri, identity.clone())
        .await
        .expect("failed to connect to Redis");
    tracing::info!(identity, "redis_connected");

    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);

    let processing_enabled = config.processing.max_attempts > 0;
    let mut coordinator = Coordinator::with_store(Arc::new(store), shutdown_rx).with_config(config);
    if processing_enabled {
        let database_uri =
            std::env::var("BLERT_DATABASE_URI").expect("BLERT_DATABASE_URI must be set");
        let pool_size = std::env::var("BLERT_DB_POOL_SIZE")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(DEFAULT_DB_POOL_SIZE);
        let db = processing::db::Postgres::connect(&database_uri, pool_size)
            .await
            .expect("failed to connect to Postgres");
        tracing::info!("postgres_connected");
        coordinator = coordinator.with_processor(Arc::new(processing::Pipeline::new(db)));
    }
    let coordinator = Arc::new(coordinator);
    coordinator.start_scan(CLAIM_SCAN_INTERVAL);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .expect("failed to bind server port");
    tracing::info!(
        port,
        commit = option_env!("BLERT_COMMIT_SHA").unwrap_or("dev"),
        "challenge_server_listening"
    );

    axum::serve(listener, api::router(Arc::clone(&coordinator)))
        .with_graceful_shutdown(shut_down_on_sigterm(shutdown_tx, coordinator))
        .await
        .expect("server exited with an error");
}

async fn shut_down_on_sigterm(
    shutdown: tokio::sync::watch::Sender<bool>,
    coordinator: Arc<Coordinator>,
) {
    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("SIGTERM handler installs")
        .recv()
        .await;

    tracing::info!("shutdown_started");
    let _ = shutdown.send(true);
    coordinator.drained().await;
    tracing::info!("shutdown_complete");
}

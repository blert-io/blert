//! The server under test.

use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::time::Duration;

use bytes::Bytes;
use http_body_util::Full;
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use thiserror::Error;
use tokio::process::Child;
use tokio::time::Instant;

pub type HttpClient = Client<HttpConnector, Full<Bytes>>;

/// How long the server may take to answer its first health poll.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(5);

/// How long a drain may run before the server is killed outright.
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Error)]
pub enum ServerError {
    #[error("failed to write {}", path.display())]
    Log {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to manage the server under test")]
    Manage(#[source] std::io::Error),
    #[error("the server under test exited during startup ({0})")]
    ExitedDuringStartup(ExitStatus),
    #[error("the server under test never became healthy")]
    NeverHealthy,
}

/// A freshly spawned instance of this binary in serve mode, on its own port,
/// logging into the run directory.
pub struct Server {
    child: Child,
    port: u16,
}

impl Server {
    pub fn spawn(run_dir: &Path, redis_uri: &str, time_scale: u32) -> Result<Server, ServerError> {
        let log_path = run_dir.join("server.log");
        let log = std::fs::File::create(&log_path).map_err(|source| ServerError::Log {
            path: log_path.clone(),
            source,
        })?;
        let log_err = log.try_clone().map_err(|source| ServerError::Log {
            path: log_path,
            source,
        })?;

        let port = free_port()?;
        let exe = std::env::current_exe().map_err(ServerError::Manage)?;
        let child = tokio::process::Command::new(exe)
            .args(["shadow", "serve", "--time-scale"])
            .arg(time_scale.to_string())
            .env("BLERT_REDIS_URI", redis_uri)
            .env("HOSTNAME", "shadow-serve")
            .env("PORT", port.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(log_err))
            .kill_on_drop(true)
            .spawn()
            .map_err(ServerError::Manage)?;

        Ok(Server { child, port })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub async fn wait_until_healthy(&mut self, client: &HttpClient) -> Result<(), ServerError> {
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        let uri: axum::http::Uri = format!("http://127.0.0.1:{}/health", self.port)
            .parse()
            .expect("health URI parses");

        loop {
            if let Some(exit) = self.child.try_wait().map_err(ServerError::Manage)? {
                return Err(ServerError::ExitedDuringStartup(exit));
            }

            let request = axum::http::Request::get(uri.clone())
                .body(Full::default())
                .expect("health request builds");
            if let Ok(response) = client.request(request).await
                && response.status() == axum::http::StatusCode::OK
            {
                return Ok(());
            }

            if Instant::now() >= deadline {
                return Err(ServerError::NeverHealthy);
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    /// Drains the server through its SIGTERM path, killing it if the drain
    /// overruns. Returns whether the shutdown was graceful.
    pub async fn shut_down(mut self) -> Result<(ExitStatus, bool), ServerError> {
        if let Some(pid) = self.child.id() {
            let pid = nix::unistd::Pid::from_raw(i32::try_from(pid).expect("pid fits in i32"));
            let _ = nix::sys::signal::kill(pid, nix::sys::signal::Signal::SIGTERM);
        }

        if let Ok(exit) = tokio::time::timeout(SHUTDOWN_TIMEOUT, self.child.wait()).await {
            return Ok((exit.map_err(ServerError::Manage)?, true));
        }
        self.child.kill().await.map_err(ServerError::Manage)?;
        Ok((self.child.wait().await.map_err(ServerError::Manage)?, false))
    }
}

fn free_port() -> Result<u16, ServerError> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(ServerError::Manage)?;
    Ok(listener.local_addr().map_err(ServerError::Manage)?.port())
}

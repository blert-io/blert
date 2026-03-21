use std::time::Duration;

pub struct Config {
    pub port: u16,
    pub redis_uri: String,
    pub allowed_origins: Vec<String>,
    pub rate_limit: RateLimitConfig,
}

pub struct RateLimitConfig {
    pub max_requests: u32,
    pub window: Duration,
    pub max_concurrent_connections: u32,
}

impl Config {
    pub fn from_env() -> Self {
        let allowed_origins = std::env::var("BLERT_ALLOWED_ORIGINS").map_or_else(
            |_| vec!["http://localhost:3000".to_string()],
            |v| v.split(',').map(String::from).collect(),
        );

        Self {
            port: std::env::var("PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(3010),
            redis_uri: std::env::var("BLERT_REDIS_URI")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),
            allowed_origins,
            rate_limit: RateLimitConfig {
                max_requests: std::env::var("BLERT_RATE_LIMIT_MAX_REQUESTS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(30),
                window: Duration::from_secs(
                    std::env::var("BLERT_RATE_LIMIT_WINDOW_SECS")
                        .ok()
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(60),
                ),
                max_concurrent_connections: std::env::var(
                    "BLERT_RATE_LIMIT_MAX_CONCURRENT_CONNECTIONS",
                )
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(10),
            },
        }
    }
}

pub struct Config {
    pub port: u16,
    #[expect(dead_code)]
    pub redis_uri: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            port: std::env::var("PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(3010),
            redis_uri: std::env::var("BLERT_REDIS_URI")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),
        }
    }
}

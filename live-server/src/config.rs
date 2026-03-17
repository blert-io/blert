pub struct Config {
    pub port: u16,
    pub redis_uri: String,
    pub allowed_origins: Vec<String>,
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
        }
    }
}

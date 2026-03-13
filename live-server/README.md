# live-server

Rust service that streams live challenge events to web clients via SSE. It reads
challenge state and event streams from Redis and broadcasts them to connected
viewers.

## Development

### Prerequisites

- Rust toolchain (install via [rustup](https://rustup.rs))
- Protobuf compiler (e.g. `brew install protobuf` or `apt install protobuf-compiler`)

### Running locally

```bash
# From the repo root
cargo run -p live-server
```

Or use Docker Compose (no local Rust install required):

```bash
docker compose --profile live up
```

### Environment variables

| Variable          | Default                  | Description                                     |
| ----------------- | ------------------------ | ----------------------------------------------- |
| `PORT`            | `3010`                   | HTTP listen port                                |
| `BLERT_REDIS_URI` | `redis://localhost:6379` | Redis connection URI                            |
| `BLERT_LOG_LEVEL` | `info`                   | Log level filter (e.g. `debug`, `info`, `warn`) |

### Endpoints

| Route         | Description              |
| ------------- | ------------------------ |
| `GET /health` | Health check with uptime |
| `GET /ping`   | Liveness probe           |

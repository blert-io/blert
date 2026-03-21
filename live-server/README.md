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

| Route                                 | Description              |
| ------------------------------------- | ------------------------ |
| `GET /health`                         | Health check with uptime |
| `GET /ping`                           | Liveness probe           |
| `GET /challenges/{challenge_id}/live` | Challenge SSE stream     |

## Design

The server consists of several components:

### `BroadcastManager`

The `BroadcastManager` is responsible for managing subscriptions and driving
live challenges. It operates on a 600ms tick. During each cycle, it:

- Asks all active `ChallengeReader` instances what data they require
- Executes a single Redis pipeline to fetch the data
- Runs each reader's broadcast logic with its result

The `BroadcastManager` creates and destroys `ChallengeReader` instances as
subscribers connect and disconnect. A new subscriber either creates or joins an
existing reader, while readers without subscribers are cleaned up after a grace
period.

### `ChallengeReader`

A `ChallengeReader` manages the state of a single live challenge and broadcasts
SSE events to its subscribers.

#### Lifecycle

On creation, the reader receives the initial state of the challenge and requests
backfill of the current stage's events. It selects a client as the initial
primary data source.

On every broadcast tick, the reader receives the latest state of the challenge
and its clients, alongside the events for that tick. It broadcasts the events
from the selected primary to all subscribers, maintaining a buffer of the
primary's full history for replay to new subscribers. Additionally, the reader
monitors the activity of each client.

A reader only stores a single stage's state at a time, as following stage
completion, static data is available through the regular API. As the challenge
progresses, the reader refreshes its state, and broadcasts lifecycle events to
subscribers. On completion, the reader notifies subscribers with a final
`complete` event and becomes dormant to be cleaned up by the `BroadcastManager`.

#### Failover

If the primary client disconnects or goes silent, the reader selects a new
primary and requests backfill of the new primary's events. The complete new
history is then replayed to all subscribers before resuming normal broadcast.
Each primary switch increments the generation attached to SSE events, allowing
subscribers to distinguish between fresh and stale events.

If no clients are available, the reader enters a stalled state until a client
reappears. It can remain in this state indefinitely: either a client returns,
all subscribers leave, or the challenge times out and is deleted from Redis by
the challenge server.

### `BackfillManager`

The `BackfillManager` receives backfill requests from `ChallengeReader`
instances via a channel, coalescing requests within a short window into a single
Redis pipeline. Responses are sent back to the `BroadcastManager` to be
distributed back to the appropriate readers.

### SSE messages

An SSE stream consists of the following message types:

- `metadata`: The initial challenge state, sent on subscribe.
- `tick`: A single live tick's events, broadcast at 600ms cadence.
- `stage-end`: The current stage has ended.
- `stage-change`: A new stage has started.
- `complete`: The challenge has finished.
- `reset`: The event stream for the current stage has changed. `reset` is
  always followed by one or more `replay-chunk` messages, then a `replay-end`.
- `replay-chunk`: A chunk of historical events during catch-up, in tick order.
  Chunks are split by byte size, not tick count, but are always split on tick
  boundaries so that no two chunks overlap in time.
- `replay-end`: The end of the catch-up sequence.
- `stalled`: All recording clients have disconnected.

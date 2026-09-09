# effect-runner

Runs the external effects of a challenge out of band from the processing that
triggered them.

Effects are driven by an outbox. A challenge processor writes an `effect_events`
row in the same transaction as its challenge data, keeping the two consistent.

## Running locally

The compose stack runs the service in watch mode:

```bash
docker compose up effect-runner
```

### Environment variables

| Variable                            | Default    | Description                                   |
| ----------------------------------- | ---------- | --------------------------------------------- |
| `BLERT_DATABASE_URI`                | (required) | Postgres holding the effect tables            |
| `BLERT_REDIS_URI`                   | (required) | Redis carrying the activity feed              |
| `BLERT_BASE_URL`                    | (required) | Blert base URL for links in outgoing messages |
| `BLERT_DISCORD_RECORDS_WEBHOOK_URL` | unset      | Records webhook; handler disabled if not set  |
| `BLERT_EFFECT_POLL_INTERVAL_MS`     | `2000`     | Delay between polls of the outbox             |
| `PORT`                              | `3003`     | Metrics listener port                         |
| `BLERT_LOG_LEVEL`                   | `info`     | Log level (`debug` in development)            |
| `BLERT_STRUCTURED_LOGS`             | `false`    | Whether to output JSON logs                   |

In development, the runner also registers a `log` handler that records every
event it sees for observability.

## Loop

Each tick polls for events with outstanding work and fans each out to the
handlers subscribed to its kind. A handler processes an event in two stages:

- `plan(event)` returns the messages it intends to send as keys. Each key
  becomes an `effect_deliveries` row, so a handler that fans out to several
  destinations retries them independently, and a crash between sending and
  recording the result redelivers just that message. A handler without anything
  to send returns an empty list of keys.
- `deliver(event, messageKey)` performs an attempt, returning a status of
  `delivered`, `skipped`, `failed`, or `retry`. A `retry` decrements the key's
  attempt budget and schedules the next attempt with backoff, or after a delay
  specified by the handler.

Handlers are recorded in a table on first registration. Events created before
that registration are never routed to the handler.

## Adding a handler

Implement `EffectHandler` (`runner/types.ts`) and construct it in `app.ts`.
The handler must have a globally unique, stable `key`.

`plan` should return the set of keys the handler intends to deliver, and
subsequent calls must return the same set. A handler that only sends a single
message can use `SINGLE_MESSAGE_KEY`.

## Metrics

Several Prometheus metrics are exposed at `/metrics`, including the age of the
oldest event with outstanding work, delivery attempts by handler and outcome,
and failures. The full list can be seen in `metrics.ts`.

## Running tests

```bash
# Unit tests
npm run -w effect-runner test

# Full integration tests
BLERT_TEST_DATABASE_URI='postgres://blert:blert@localhost:5433/blert_test' \
  npm run -w effect-runner test:integration
```

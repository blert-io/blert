# 2 Challenge 2 Server

Blert meets rewrite it in Rust. It's a challenge server.

## Environment

Required:

| Variable                | Purpose                                           |
| ----------------------- | ------------------------------------------------- |
| `BLERT_REDIS_URI`       | Redis for active challenge state                  |
| `BLERT_DATABASE_URI`    | Postgres for persisting challenge data            |
| `BLERT_DATA_REPOSITORY` | `file://` or `s3://` URI to write protobuf events |
| `HOSTNAME`              | The instance's identity, used to claim challenges |

Optional:

| Variable                        | Default | Purpose                                              |
| ------------------------------- | ------- | ---------------------------------------------------- |
| `PORT`                          | `3003`  | Listen port                                          |
| `BLERT_REDIS_POOL_SIZE`         | `16`    | Redis connection pool size                           |
| `BLERT_DB_POOL_SIZE`            | `8`     | Postgres connection pool size                        |
| `BLERT_CAPTURE_DATA_REPOSITORY` | unset   | Enables merge stream capturing to the configured URI |
| `BLERT_ENVIRONMENT`             | unset   | Set to `development` if developing                   |
| `BLERT_DAILY_BLOAT_HAND_LIMIT`  | `10000` | Cap on Bloat hand rows recorded per UTC day          |

When `BLERT_DATA_REPOSITORY` is an `s3://` URI, `BLERT_ACCESS_KEY_ID` and
`BLERT_SECRET_ACCESS_KEY` are also required, with `BLERT_REGION` and
`BLERT_ENDPOINT`.

## Building

Stable Rust and `protoc` on PATH are required to build the service.

```bash
cargo build -p challenge-harder
```

## Testing

The fixture, Redis, and Postgres tests **return early and count as passed**
when their URIs are unset, so `cargo test` alone skips many tests. To enable:

```bash
export BLERT_TEST_REDIS_URI=redis://localhost:6379/15
export BLERT_TEST_DATABASE_URI=postgres://blert:blert@localhost:5433/blert_test

cargo test -p challenge-harder
```

`blert_test` is a separate database and must be migrated before it will work:

```bash
BLERT_DATABASE_URI=postgres://blert:blert@localhost:5433/blert_test \
  npm run -w common migration:run
```

Linting:

```bash
cargo fmt -p challenge-harder --check
cargo clippy -p challenge-harder --all-targets -- -D warnings
```

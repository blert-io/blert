//! Postgres persistence for data processing.

use std::ops::Deref;

use deadpool_postgres::{Manager, ManagerConfig, Object, Pool, RecyclingMethod};
use tokio_postgres::NoTls;

use crate::lifecycle::core::types::{
    JournalSeq, ProcessingError, ProcessingPayload, StageStatus, Uuid,
};

/// A database operation failure.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// This processing step was previously applied, with the stored payload.
    #[error("processing step already applied")]
    AlreadyApplied(ProcessingPayload),
    /// A database operation failed.
    #[error("database: {0}")]
    Database(String),
    /// The data stored in the database is invalid.
    #[error("invalid data: {0}")]
    InvalidData(String),
}

impl From<tokio_postgres::Error> for Error {
    fn from(error: tokio_postgres::Error) -> Self {
        // The top-level Display is just a kind ("db error"); the Postgres
        // message lives in the source.
        match std::error::Error::source(&error) {
            Some(source) => Error::Database(format!("{error}: {source}")),
            None => Error::Database(error.to_string()),
        }
    }
}

impl From<deadpool_postgres::PoolError> for Error {
    fn from(error: deadpool_postgres::PoolError) -> Self {
        Error::Database(error.to_string())
    }
}

impl From<deadpool_postgres::BuildError> for Error {
    fn from(error: deadpool_postgres::BuildError) -> Self {
        Error::Database(error.to_string())
    }
}

impl From<Error> for ProcessingError {
    fn from(error: Error) -> Self {
        ProcessingError {
            retriable: matches!(error, Error::Database(_)),
            message: error.to_string(),
        }
    }
}

/// The challenge database.
pub struct Postgres {
    pool: Pool,
}

impl Postgres {
    /// Opens a connection pool to the Postgres instance at `uri`.
    pub async fn connect(uri: &str, pool_size: usize) -> Result<Postgres, Error> {
        let config: tokio_postgres::Config = uri.parse()?;
        let manager = Manager::from_config(
            config,
            NoTls,
            ManagerConfig {
                recycling_method: RecyclingMethod::Fast,
            },
        );
        let pool = Pool::builder(manager).max_size(pool_size).build()?;
        drop(pool.get().await?);
        Ok(Postgres { pool })
    }

    /// Opens a guarded transaction for the processing stage triggered by `seq`,
    /// failing with [`Error::AlreadyApplied`] if the processing step has
    /// previously been applied to the database.
    pub async fn start_transaction(
        &self,
        uuid: Uuid,
        seq: JournalSeq,
    ) -> Result<Transaction, Error> {
        let client = self.pool.get().await?;
        client.batch_execute("BEGIN").await?;
        let mut txn = Transaction {
            client: Some(client),
            seq,
            challenge_id: 0,
        };

        let guard = txn
            .query_opt(
                "SELECT c.id, s.processed_seq, s.outcome_status, s.outcome_ticks
                 FROM challenges c
                 LEFT JOIN challenge_processing_state s ON s.challenge_id = c.id
                 WHERE c.uuid = $1",
                &[&uuid],
            )
            .await?;
        if let Some(row) = guard {
            if let Some(processed_seq) = row.get::<_, Option<i64>>(1)
                && processed_seq >= seq.0.cast_signed()
            {
                return Err(Error::AlreadyApplied(stored_payload(&row)?));
            }
            txn.challenge_id = row.get(0);
        }

        Ok(txn)
    }
}

/// Reconstructs a processing outcome from a stored row.
fn stored_payload(row: &tokio_postgres::Row) -> Result<ProcessingPayload, Error> {
    // Either both status and ticks are present, or neither.
    let Some(status) = row.get::<_, Option<i16>>(2) else {
        return Ok(ProcessingPayload::None);
    };

    let status = StageStatus::try_from(i32::from(status))
        .map_err(|_| Error::InvalidData(format!("stored outcome status {status}")))?;
    let ticks = row.get::<_, Option<i32>>(3);
    let ticks = ticks
        .and_then(|t| u32::try_from(t).ok())
        .ok_or_else(|| Error::InvalidData(format!("stored outcome ticks {ticks:?}")))?;
    Ok(ProcessingPayload::Stage { status, ticks })
}

/// An active processing transaction wrapping a database connection. Committing
/// advances the challenge's processing cursor.
pub struct Transaction {
    client: Option<Object>,
    seq: JournalSeq,
    /// Database ID of the challenge row.
    challenge_id: i32,
}

impl Transaction {
    /// Returns the database ID of the challenge row.
    pub fn challenge_id(&self) -> i32 {
        self.challenge_id
    }

    /// Sets the challenge ID after an initial insert.
    pub fn set_challenge_id(&mut self, id: i32) {
        debug_assert_eq!(self.challenge_id, 0);
        self.challenge_id = id;
    }

    /// Commits the transaction, advancing the challenge's cursor and storing
    /// the processed payload.
    pub async fn commit(mut self, payload: &ProcessingPayload) -> Result<(), Error> {
        let (status, ticks) = match payload {
            ProcessingPayload::Stage { status, ticks } => {
                (Some(*status as i16), Some(ticks.cast_signed()))
            }
            ProcessingPayload::None => (None, None),
        };
        let client = self.client.take().expect("transaction is active");
        client
            .execute(
                "INSERT INTO challenge_processing_state
                   (challenge_id, processed_seq, outcome_status, outcome_ticks)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (challenge_id)
                 DO UPDATE SET processed_seq = EXCLUDED.processed_seq,
                               outcome_status = EXCLUDED.outcome_status,
                               outcome_ticks = EXCLUDED.outcome_ticks",
                &[
                    &self.challenge_id,
                    &self.seq.0.cast_signed(),
                    &status,
                    &ticks,
                ],
            )
            .await?;
        client.batch_execute("COMMIT").await?;
        Ok(())
    }
}

impl Deref for Transaction {
    type Target = tokio_postgres::Client;

    fn deref(&self) -> &tokio_postgres::Client {
        self.client.as_ref().expect("transaction is active")
    }
}

impl Drop for Transaction {
    fn drop(&mut self) {
        // Closing the connection rolls the abandoned transaction back on the
        // server; detaching keeps the aborted session out of the pool.
        if let Some(client) = self.client.take() {
            drop(Object::take(client));
        }
    }
}

/// Connects to the migrated Postgres database at `BLERT_TEST_DATABASE_URI`,
/// or returns `None` when it is unset.
#[cfg(test)]
pub(crate) async fn test_database() -> Option<Postgres> {
    let Ok(uri) = std::env::var("BLERT_TEST_DATABASE_URI") else {
        eprintln!("BLERT_TEST_DATABASE_URI is not set; skipping Postgres tests");
        return None;
    };
    Some(
        Postgres::connect(&uri, 2)
            .await
            .expect("failed to connect to the test database"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lifecycle::core::types::StageStatus;

    /// Inserts a bare challenge row to satisfy foreign keys.
    async fn insert_challenge(db: &Postgres, uuid: Uuid) -> i32 {
        let client = db.pool.get().await.expect("client");
        let row = client
            .query_one(
                "INSERT INTO challenges (uuid, type, scale) VALUES ($1, $2, $3) RETURNING id",
                &[&uuid, &1_i16, &1_i16],
            )
            .await
            .expect("fixture challenge insert");
        row.get(0)
    }

    async fn delete_challenge(db: &Postgres, uuid: Uuid) {
        let client = db.pool.get().await.expect("client");
        client
            .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
            .await
            .expect("cleanup");
    }

    #[tokio::test]
    async fn guard_passes_for_an_unknown_challenge() {
        let Some(db) = test_database().await else {
            return;
        };
        let uuid = Uuid::new_v4();

        let txn = db
            .start_transaction(uuid, JournalSeq(1))
            .await
            .expect("guard should pass");
        assert_eq!(txn.challenge_id(), 0);
    }

    #[tokio::test]
    async fn commit_records_the_cursor_and_payload() {
        let Some(db) = test_database().await else {
            return;
        };
        let uuid = Uuid::new_v4();
        let id = insert_challenge(&db, uuid).await;

        let txn = db
            .start_transaction(uuid, JournalSeq(3))
            .await
            .expect("guard should pass");
        assert_eq!(txn.challenge_id(), id);
        txn.commit(&ProcessingPayload::Stage {
            status: StageStatus::Wiped,
            ticks: 180,
        })
        .await
        .expect("commit failed");

        let client = db.pool.get().await.expect("client");
        let row = client
            .query_one(
                "SELECT processed_seq, outcome_status, outcome_ticks
                 FROM challenge_processing_state WHERE challenge_id = $1",
                &[&id],
            )
            .await
            .expect("state row missing");
        assert_eq!(row.get::<_, i64>(0), 3);
        assert_eq!(
            row.get::<_, Option<i16>>(1),
            Some(StageStatus::Wiped as i16)
        );
        assert_eq!(row.get::<_, Option<i32>>(2), Some(180));

        // Reopening the committed step returns its stored payload.
        let replay = db.start_transaction(uuid, JournalSeq(3)).await;
        assert!(matches!(
            replay,
            Err(Error::AlreadyApplied(ProcessingPayload::Stage {
                status: StageStatus::Wiped,
                ticks: 180,
            }))
        ));
        let next = db.start_transaction(uuid, JournalSeq(4)).await;
        assert!(next.is_ok());

        // Free both held connections; the pool has two and cleanup needs one.
        drop(next);
        drop(client);
        delete_challenge(&db, uuid).await;
    }

    #[tokio::test]
    async fn commit_without_a_payload_stores_none() {
        let Some(db) = test_database().await else {
            return;
        };
        let uuid = Uuid::new_v4();
        let id = insert_challenge(&db, uuid).await;

        let txn = db
            .start_transaction(uuid, JournalSeq(1))
            .await
            .expect("guard should pass");
        txn.commit(&ProcessingPayload::None)
            .await
            .expect("commit failed");

        let client = db.pool.get().await.expect("client");
        let row = client
            .query_one(
                "SELECT processed_seq, outcome_status, outcome_ticks
                 FROM challenge_processing_state WHERE challenge_id = $1",
                &[&id],
            )
            .await
            .expect("state row missing");
        assert_eq!(row.get::<_, i64>(0), 1);
        assert_eq!(row.get::<_, Option<i16>>(1), None);
        assert_eq!(row.get::<_, Option<i32>>(2), None);

        let replay = db.start_transaction(uuid, JournalSeq(1)).await;
        assert!(matches!(
            replay,
            Err(Error::AlreadyApplied(ProcessingPayload::None))
        ));

        delete_challenge(&db, uuid).await;
    }

    #[tokio::test]
    async fn dropped_transaction_abandons_its_writes() {
        let Some(db) = test_database().await else {
            return;
        };
        let uuid = Uuid::new_v4();
        let id = insert_challenge(&db, uuid).await;

        let txn = db
            .start_transaction(uuid, JournalSeq(1))
            .await
            .expect("guard should pass");
        txn.execute("UPDATE challenges SET scale = 5 WHERE id = $1", &[&id])
            .await
            .expect("update failed");
        drop(txn);

        let client = db.pool.get().await.expect("client");
        let row = client
            .query_one("SELECT scale FROM challenges WHERE id = $1", &[&id])
            .await
            .expect("challenge row missing");
        assert_eq!(row.get::<_, i16>(0), 1);

        delete_challenge(&db, uuid).await;
    }

    #[test]
    fn errors_map_to_processing_errors() {
        let error: ProcessingError = Error::Database("connection refused".into()).into();
        assert!(error.retriable);
        assert_eq!(error.message, "database: connection refused");

        let error: ProcessingError = Error::InvalidData("bad status".into()).into();
        assert!(!error.retriable);
        assert_eq!(error.message, "invalid data: bad status");
    }
}

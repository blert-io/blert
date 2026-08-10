//! Session database storage.

use std::sync::Arc;
use std::time::SystemTime;

use async_trait::async_trait;
use deadpool_postgres::Object;

use crate::lifecycle::core::types::{ChallengeMode, ChallengeStatus, Uuid};
use crate::lifecycle::session::SessionFinalizer;
use crate::metrics;
use crate::players::party_hash;

use super::{ChallengeInfo, db};

/// Status of a challenge session, matching `SessionStatus` in
/// `//common/challenge.ts`.
#[derive(Debug, Clone, Copy)]
#[repr(u8)]
pub(super) enum SessionStatus {
    Active = 0,
    Completed = 1,
    Hidden = 2,
}

#[derive(Debug, Clone, Copy)]
pub(super) enum FinalizationReason {
    /// A newer session for the party closed a stale one.
    Superseded,
    /// The session's activity window elapsed.
    Expired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum FinalizationOutcome {
    /// The session had no recorded challenges and its data was deleted.
    Deleted,
    /// The session's final state was written.
    Updated,
}

/// Resolves the database session to which the challenge represented by `info`
/// belongs, either creating a new session or using an existing one.
/// Returns the ID of the session row.
pub(super) async fn resolve_session(
    txn: &db::Transaction,
    info: &ChallengeInfo,
    start_time: SystemTime,
) -> Result<i32, db::Error> {
    let active = txn
        .query_opt(
            "SELECT id FROM challenge_sessions WHERE uuid = $1",
            &[&info.session_uuid],
        )
        .await?;
    if let Some(row) = active {
        return Ok(row.get(0));
    }

    let hash = party_hash(&info.party);

    // If the previous session for the party has not cleaned up, close it.
    let stale = txn
        .query(
            "SELECT id FROM challenge_sessions
             WHERE challenge_type = $1 AND party_hash = $2 AND end_time IS NULL
             FOR UPDATE",
            &[&(info.challenge_type as i16), &hash],
        )
        .await?;
    if let Some(row) = stale.first() {
        finalize_session(
            txn,
            row.get(0),
            Some(start_time),
            FinalizationReason::Superseded,
        )
        .await?;
    }

    let row = txn
        .query_one(
            "INSERT INTO challenge_sessions
               (uuid, challenge_type, challenge_mode, scale, party_hash, start_time, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id",
            &[
                &info.session_uuid,
                &(info.challenge_type as i16),
                &(info.mode as i16),
                &info.scale(),
                &hash,
                &start_time,
                &(SessionStatus::Active as i16),
            ],
        )
        .await?;

    let id: i32 = row.get(0);
    tracing::info!(
        session_uuid = %info.session_uuid,
        session_id = id,
        challenge_type = ?info.challenge_type,
        challenge_mode = ?info.mode,
        party = ?info.party,
        party_hash = %hash,
        "session_created",
    );
    Ok(id)
}

/// Writes a provisional end time for the transaction's session.
pub(super) async fn update_end_time(
    txn: &db::Transaction,
    end_time: SystemTime,
) -> Result<(), db::Error> {
    txn.execute(
        "UPDATE challenge_sessions SET end_time = $2 WHERE id = $1",
        &[&txn.session_id()?, &end_time],
    )
    .await?;
    Ok(())
}

/// Propagates a challenge mode change to the transaction's session.
pub(super) async fn update_mode(
    txn: &db::Transaction,
    mode: ChallengeMode,
) -> Result<(), db::Error> {
    txn.execute(
        "UPDATE challenge_sessions SET challenge_mode = $2 WHERE id = $1",
        &[&txn.session_id()?, &(mode as i16)],
    )
    .await?;
    Ok(())
}

/// Closes session `session_id`, writing its final state.
/// If no challenges were recorded, the session is deleted.
pub(super) async fn finalize_session(
    client: &tokio_postgres::Client,
    session_id: i32,
    default_end_time: Option<SystemTime>,
    reason: FinalizationReason,
) -> Result<FinalizationOutcome, db::Error> {
    let row = client
        .query_one(
            "SELECT ARRAY_AGG(DISTINCT status ORDER BY status),
                    MAX(finish_time),
                    MIN(start_time),
                    MODE() WITHIN GROUP (ORDER BY mode)
             FROM challenges WHERE session_id = $1",
            &[&session_id],
        )
        .await?;
    let statuses: Option<Vec<i16>> = row.get(0);
    let last_finish: Option<SystemTime> = row.get(1);
    let earliest_start: Option<SystemTime> = row.get(2);
    let frequent_mode: Option<i16> = row.get(3);

    let Some(statuses) = statuses else {
        tracing::warn!(session_id, ?reason, "session_no_challenges");
        client
            .execute(
                "DELETE FROM challenge_sessions WHERE id = $1",
                &[&session_id],
            )
            .await?;
        return Ok(FinalizationOutcome::Deleted);
    };

    let status = if statuses == [ChallengeStatus::Abandoned as i16] {
        tracing::warn!(session_id, ?reason, "session_only_abandoned_challenges");
        SessionStatus::Hidden
    } else {
        SessionStatus::Completed
    };
    let end_time = last_finish.or(default_end_time);
    let mode = frequent_mode.filter(|&mode| mode != ChallengeMode::NoMode as i16);

    client
        .execute(
            "UPDATE challenge_sessions
             SET status = $2,
                 start_time = COALESCE($3, start_time),
                 end_time = GREATEST($4, end_time),
                 challenge_mode = COALESCE($5, challenge_mode)
             WHERE id = $1",
            &[
                &session_id,
                &(status as i16),
                &earliest_start,
                &end_time,
                &mode,
            ],
        )
        .await?;
    Ok(FinalizationOutcome::Updated)
}

/// Finalizes expired sessions' database records.
pub struct PostgresSessionFinalizer {
    db: Arc<db::Postgres>,
}

impl PostgresSessionFinalizer {
    #[must_use]
    pub fn new(db: Arc<db::Postgres>) -> Self {
        PostgresSessionFinalizer { db }
    }

    async fn run(&self, session: Uuid) -> Result<(), db::Error> {
        let client = self.db.checkout().await?;
        client.batch_execute("BEGIN").await?;
        let result = async {
            let outcome = Self::finalize_row(&client, session).await?;
            client.batch_execute("COMMIT").await?;
            Ok(outcome)
        }
        .await;
        match result {
            Ok(Some(FinalizationOutcome::Updated)) => {
                metrics::record_session_finalized();
                Ok(())
            }
            Ok(_) => Ok(()),
            Err(error) => {
                // Closing the connection rolls the transaction back on the
                // server; detaching keeps the aborted session out of the pool.
                drop(Object::take(client));
                Err(error)
            }
        }
    }

    /// Finalizes the session's row if it exists.
    async fn finalize_row(
        client: &tokio_postgres::Client,
        session: Uuid,
    ) -> Result<Option<FinalizationOutcome>, db::Error> {
        let row = client
            .query_opt(
                "SELECT id FROM challenge_sessions WHERE uuid = $1 FOR UPDATE",
                &[&session],
            )
            .await?;
        let Some(row) = row else {
            tracing::debug!(session_uuid = %session, "session_finalize_no_row");
            return Ok(None);
        };
        let outcome =
            finalize_session(client, row.get(0), None, FinalizationReason::Expired).await?;
        Ok(Some(outcome))
    }
}

#[async_trait]
impl SessionFinalizer for PostgresSessionFinalizer {
    async fn finalize(&self, uuid: Uuid) -> Result<(), String> {
        self.run(uuid).await.map_err(|error| error.to_string())
    }
}

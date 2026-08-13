//! Challenge session management.

use async_trait::async_trait;

use core::time::Duration;

use super::core::types::{ChallengeType, Uuid};
use super::store::StoreError;

/// Outcome of resolving a party's session.
pub enum SessionResolution {
    /// The party has a live session.
    Existing(Uuid),
    /// A new session was created.
    Created(Uuid),
}

/// Durable storage for session state.
#[async_trait]
pub trait SessionStore: Send + Sync + 'static {
    /// Returns the live session for a party, extending its activity deadline
    /// to `window` from now, or creates a new one with that deadline.
    async fn resolve(
        &self,
        challenge_type: ChallengeType,
        party: &[String],
        window: Duration,
    ) -> Result<SessionResolution, StoreError>;

    /// Extends a session's activity deadline to `window` from now.
    async fn refresh(&self, session: Uuid, window: Duration) -> Result<(), StoreError>;

    /// Claims up to `batch_size` expired sessions for finalization.
    async fn claim_expired_sessions(&self, batch_size: usize) -> Result<Vec<Uuid>, StoreError>;

    /// Deletes a finalized session's state.
    async fn delete_session(&self, session: Uuid) -> Result<(), StoreError>;
}

#[async_trait]
pub trait SessionFinalizer: Send + Sync + 'static {
    /// Finalizes an expired session's record.
    async fn finalize(&self, uuid: Uuid) -> Result<(), String>;
}

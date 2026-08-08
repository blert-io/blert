//! Challenge session management.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use super::core::types::{JournalSeq, MsgId, Timestamp, Uuid};
use super::store::{StoreError, with_retries};

/// What triggered a session event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SessionCause {
    /// A command sent to the session's inbox.
    Command(MsgId),
    /// The session's inactivity period expired.
    Expiry,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionJournalEntry {
    pub seq: JournalSeq,
    /// Apply time from the session's clock.
    pub at: Timestamp,
    pub caused_by: SessionCause,
    pub event: SessionEvent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionEvent {
    /// The session was created.
    Started { uuid: Uuid, party_key: String },
    /// A member challenge reported activity.
    Activity,
    /// Terminal session event.
    Expired,
}

/// A command sent to a session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionCommand {
    Start { uuid: Uuid, party_key: String },
    Activity,
}

/// A command with its inbox sequence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionEnvelope {
    pub id: MsgId,
    pub cmd: SessionCommand,
}

/// An exclusive handle to a session's journal and party directory entry.
#[async_trait]
pub trait SessionClaim: Send + Sync + 'static {
    /// Returns every entry in the session's journal, in order.
    async fn load(&self) -> Result<Vec<SessionJournalEntry>, StoreError>;

    /// Delivers the session's inbox entries positioned after `from` into
    /// `sink`, in order, until `sink` closes.
    fn follow(&self, from: MsgId, sink: mpsc::Sender<SessionEnvelope>);

    /// Appends journal entries as a single atomic batch.
    async fn append(&self, batch: &[SessionJournalEntry]) -> Result<(), StoreError>;

    /// Extends this claim's hold on the session.
    async fn renew(&self) -> Result<(), StoreError>;

    /// Releases this claim's hold on the session, leaving it immediately
    /// claimable by any instance.
    async fn release(&self) -> Result<(), StoreError>;

    /// Deletes the session's durable state, including its directory key if
    /// it still points to this session.
    async fn delete(&self, party_key: &str) -> Result<(), StoreError>;
}

pub struct ClaimedSession {
    uuid: Uuid,
    inner: Box<dyn SessionClaim>,
}

impl ClaimedSession {
    #[must_use]
    pub fn new(uuid: Uuid, inner: Box<dyn SessionClaim>) -> Self {
        ClaimedSession { uuid, inner }
    }

    /// Identifier of the session this claim owns.
    #[must_use]
    pub fn uuid(&self) -> Uuid {
        self.uuid
    }
}

impl std::ops::Deref for ClaimedSession {
    type Target = dyn SessionClaim;

    fn deref(&self) -> &Self::Target {
        self.inner.as_ref()
    }
}

/// Durable storage for session state, granting exclusive access through claims.
#[async_trait]
pub trait SessionStore: Send + Sync + 'static {
    /// Finds up to `batch_size` claimable sessions not listed in `exclude`
    /// and claims each under a fresh epoch, fencing off any previous owner.
    async fn claim_unowned_sessions(
        &self,
        batch_size: usize,
        exclude: &[Uuid],
    ) -> Result<Vec<ClaimedSession>, StoreError>;
}

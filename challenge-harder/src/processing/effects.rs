//! Handling for the effects outbox.
//!
//! A processing run announces milestones by writing `effect_events` rows for
//! effect-runner to act on. A row consists of an event kind and the subject of
//! that event, defined per-kind.

use serde::Serialize;
use serde_repr::{Deserialize_repr, Serialize_repr};

use crate::lifecycle::core::types::{Stage, Uuid};

use super::db;

/// Kind of an effect event.
/// Matches `EffectEventKind` in `//effect-runner/effects.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize_repr, Deserialize_repr)]
#[repr(u8)]
pub(super) enum EventKind {
    ChallengeFinished = 0,
    StageFinished = 1,
}

/// An event that could trigger side effects.
/// Matches `EffectSubject` in `//effect-runner/effects.ts`.
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub(super) enum Event {
    ChallengeFinished {
        uuid: Uuid,
    },
    StageFinished {
        uuid: Uuid,
        stage: Stage,
        attempt: Option<u32>,
    },
}

impl Event {
    fn kind(&self) -> EventKind {
        match self {
            Event::ChallengeFinished { .. } => EventKind::ChallengeFinished,
            Event::StageFinished { .. } => EventKind::StageFinished,
        }
    }

    /// The event's idempotency key, stable and unique across `kind`.
    fn key(&self) -> String {
        match self {
            Event::ChallengeFinished { uuid } => uuid.to_string(),
            Event::StageFinished {
                uuid,
                stage,
                attempt: Some(attempt),
            } => format!("{uuid}:{}:{attempt}", *stage as i32),
            Event::StageFinished {
                uuid,
                stage,
                attempt: None,
            } => format!("{uuid}:{}", *stage as i32),
        }
    }
}

/// Stages an event which might trigger side effects.
pub(super) async fn emit(txn: &db::Transaction, event: &Event) -> Result<(), db::Error> {
    let subject = serde_json::to_value(event)
        .map_err(|error| db::Error::InvalidData(format!("effect subject: {error}")))?;

    txn.execute(
        "INSERT INTO effect_events (kind, subject, key)
         VALUES ($1, $2, $3)
         ON CONFLICT (kind, key) DO NOTHING",
        &[&(event.kind() as i16), &subject, &event.key()],
    )
    .await?;

    Ok(())
}

// Compile-time parity checks against the TypeScript values.
const _: () = {
    assert!(EventKind::ChallengeFinished as u8 == 0);
    assert!(EventKind::StageFinished as u8 == 1);
};

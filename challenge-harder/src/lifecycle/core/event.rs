//! Challenge journal events.

use serde::{Deserialize, Serialize};

use super::command::StageProgress;
use super::types::{
    ChallengeMode, ChallengeStatus, ChallengeType, ClientId, JournalSeq, MsgId, RecordingType,
    ReportedTimes, Stage, StageProcessingError, StageProcessingOutcome, Timestamp, UserId, Uuid,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JournalEntry {
    pub seq: JournalSeq,
    /// Apply time from the challenge's clock.
    pub at: Timestamp,
    /// Inbox message that produced this entry.
    pub caused_by: MsgId,
    pub event: LifecycleEvent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum LifecycleEvent {
    ChallengeCreated {
        uuid: Uuid,
        challenge_type: ChallengeType,
        mode: ChallengeMode,
        party: Vec<String>,
        stage: Stage,
    },
    ClientJoined {
        client_id: ClientId,
        user_id: UserId,
        session_token: String,
        recording_type: RecordingType,
    },
    ModeChanged {
        mode: ChallengeMode,
    },
    PartyChanged {
        party: Vec<String>,
    },
    /// A client reported stage progress.
    ClientStageReported {
        client_id: ClientId,
        #[serde(skip_serializing_if = "Option::is_none")]
        attempt: Option<u32>,
        update: StageProgress,
    },
    /// The challenge advanced to a new stage.
    StageStarted {
        stage: Stage,
    },
    /// A `STARTED` update for the current retriable stage began a new attempt.
    StageRetried {
        stage: Stage,
        attempt: u32,
    },
    /// The stage's event streams have been finalized and processing may begin.
    /// `forced` indicates that not all clients sent a completion message within
    /// the grace period.
    StageSealed {
        stage: Stage,
        #[serde(skip_serializing_if = "Option::is_none")]
        attempt: Option<u32>,
        forced: bool,
    },
    StageProcessingStarted {
        stage: Stage,
        #[serde(skip_serializing_if = "Option::is_none")]
        attempt: Option<u32>,
    },
    StageProcessingFinished {
        stage: Stage,
        #[serde(skip_serializing_if = "Option::is_none")]
        attempt: Option<u32>,
        outcome: StageProcessingOutcome,
    },
    StageProcessingFailed {
        stage: Stage,
        #[serde(skip_serializing_if = "Option::is_none")]
        attempt: Option<u32>,
        error: StageProcessingError,
    },
    StageProcessingTimedOut {
        stage: Stage,
        #[serde(skip_serializing_if = "Option::is_none")]
        attempt: Option<u32>,
    },
    ClientFinished {
        client_id: ClientId,
        definitive: bool,
        soft: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        times: Option<ReportedTimes>,
    },
    ClientActivated {
        client_id: ClientId,
    },
    ClientIdled {
        client_id: ClientId,
    },
    ClientRemoved {
        client_id: ClientId,
    },
    /// A cleanup deadline came due when the conditions for cleanup were no
    /// longer met, so it was ignored.
    CleanupDeferred {
        kind: DeadlineKind,
    },
    /// Terminal challenge event.
    /// `empty` marks a challenge with no recorded data which should be deleted.
    ChallengeTerminated {
        status: ChallengeStatus,
        empty: bool,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lifecycle::core::types::Timestamp;

    #[test]
    fn journal_entry_format_is_stable() {
        let entry = JournalEntry {
            seq: JournalSeq(4),
            at: Timestamp::from_millis(1_500),
            caused_by: MsgId(9),
            event: LifecycleEvent::StageSealed {
                stage: Stage::TobBloat,
                attempt: None,
                forced: true,
            },
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert_eq!(
            json,
            r#"{"seq":4,"at":1500,"caused_by":9,"event":{"StageSealed":{"stage":11,"forced":true}}}"#
        );
        assert_eq!(serde_json::from_str::<JournalEntry>(&json).unwrap(), entry);
    }
}

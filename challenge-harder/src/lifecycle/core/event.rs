//! Challenge journal events.

use serde::{Deserialize, Serialize};

use super::command::StageProgress;
use super::deadline::DeadlineKind;
use super::types::{
    ChallengeMode, ChallengeStatus, ChallengeType, ClientId, JournalSeq, MsgId, RecordingType,
    ReportedTimes, SessionToken, Stage, StageProcessingError, StageProcessingOutcome, Timestamp,
    UserId, Uuid,
};

/// What triggered a lifecycle event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Cause {
    /// An inbox command.
    Command(MsgId),
    /// A deadline coming due.
    Deadline(DeadlineKind),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JournalEntry {
    pub seq: JournalSeq,
    /// Apply time from the challenge's clock.
    pub at: Timestamp,
    pub caused_by: Cause,
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
        session_token: SessionToken,
        recording_type: RecordingType,
    },
    /// A new connection took over an existing client.
    ClientRejoined {
        client_id: ClientId,
        session_token: SessionToken,
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
        attempt: Option<u32>,
        update: StageProgress,
    },
    /// The challenge advanced to a new stage.
    StageStarted {
        stage: Stage,
    },
    /// A `STARTED` update for the current retriable stage began a new attempt.
    StageAttemptStarted {
        stage: Stage,
        attempt: u32,
    },
    /// The stage's event streams have been finalized and processing may begin.
    /// `forced` indicates that not all clients sent a completion message within
    /// the grace period.
    StageSealed {
        stage: Stage,
        attempt: Option<u32>,
        forced: bool,
    },
    StageProcessingStarted {
        stage: Stage,
        attempt: Option<u32>,
    },
    StageProcessingFinished {
        stage: Stage,
        attempt: Option<u32>,
        outcome: StageProcessingOutcome,
    },
    StageProcessingFailed {
        stage: Stage,
        attempt: Option<u32>,
        error: StageProcessingError,
    },
    StageProcessingTimedOut {
        stage: Stage,
        attempt: Option<u32>,
    },
    /// A client definitively finished the challenge, entering its finishing phase.
    ChallengeFinishing {
        // TODO(frolv): Temporary until stage processing is implemented.
        status: ChallengeStatus,
    },
    ClientFinished {
        client_id: ClientId,
        definitive: bool,
        soft: bool,
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
            caused_by: Cause::Command(MsgId::sequence(9)),
            event: LifecycleEvent::StageSealed {
                stage: Stage::TobBloat,
                attempt: None,
                forced: true,
            },
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert_eq!(
            json,
            r#"{"seq":4,"at":1500,"caused_by":"0-9","event":{"StageSealed":{"stage":11,"attempt":null,"forced":true}}}"#
        );
        assert_eq!(serde_json::from_str::<JournalEntry>(&json).unwrap(), entry);

        let forced = JournalEntry {
            seq: JournalSeq(5),
            at: Timestamp::from_millis(3_500),
            caused_by: Cause::Deadline(DeadlineKind::StageEnd),
            event: LifecycleEvent::StageSealed {
                stage: Stage::TobBloat,
                attempt: None,
                forced: true,
            },
        };
        let json = serde_json::to_string(&forced).unwrap();
        assert_eq!(
            json,
            r#"{"seq":5,"at":3500,"caused_by":"StageEnd","event":{"StageSealed":{"stage":11,"attempt":null,"forced":true}}}"#
        );
        assert_eq!(serde_json::from_str::<JournalEntry>(&json).unwrap(), forced);
    }
}

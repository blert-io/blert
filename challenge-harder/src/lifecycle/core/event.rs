//! Challenge journal events.

use serde::{Deserialize, Serialize};

use super::command::StageProgress;
use super::deadline::DeadlineKind;
use super::types::{
    ChallengeMode, ChallengeType, ClientId, JournalSeq, MsgId, ProcessingError, ProcessingOutcome,
    RecordingType, ReportedTimes, SessionToken, Stage, Timestamp, UserId, Uuid,
};

/// What triggered a lifecycle event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Cause {
    /// An inbox command.
    Command(MsgId),
    /// A deadline coming due.
    Deadline(DeadlineKind),
    /// A report from a processing run triggered by the journal entry at `seq`.
    Processing(JournalSeq),
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
    /// A processing run for the entry at journal position `trigger` began.
    ProcessingStarted {
        trigger: JournalSeq,
    },
    ProcessingFinished {
        trigger: JournalSeq,
        outcome: ProcessingOutcome,
    },
    ProcessingFailed {
        trigger: JournalSeq,
        error: ProcessingError,
    },
    ProcessingTimedOut {
        trigger: JournalSeq,
    },
    /// A client definitively finished the challenge, entering its finishing phase.
    ChallengeFinishing,
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
        empty: bool,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lifecycle::core::types::{StageStatus, Timestamp};

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

        let processed = JournalEntry {
            seq: JournalSeq(6),
            at: Timestamp::from_millis(4_000),
            caused_by: Cause::Processing(JournalSeq(5)),
            event: LifecycleEvent::ProcessingFinished {
                trigger: JournalSeq(5),
                outcome: ProcessingOutcome::Stage {
                    status: StageStatus::Completed,
                    ticks: 237,
                },
            },
        };
        let json = serde_json::to_string(&processed).unwrap();
        assert_eq!(
            json,
            r#"{"seq":6,"at":4000,"caused_by":5,"event":{"ProcessingFinished":{"trigger":5,"outcome":{"Stage":{"status":2,"ticks":237}}}}}"#
        );
        assert_eq!(
            serde_json::from_str::<JournalEntry>(&json).unwrap(),
            processed
        );

        let boundary = JournalEntry {
            seq: JournalSeq(8),
            at: Timestamp::from_millis(4_200),
            caused_by: Cause::Processing(JournalSeq(0)),
            event: LifecycleEvent::ProcessingFinished {
                trigger: JournalSeq(0),
                outcome: ProcessingOutcome::Boundary,
            },
        };
        let json = serde_json::to_string(&boundary).unwrap();
        assert_eq!(
            json,
            r#"{"seq":8,"at":4200,"caused_by":0,"event":{"ProcessingFinished":{"trigger":0,"outcome":"Boundary"}}}"#
        );
        assert_eq!(
            serde_json::from_str::<JournalEntry>(&json).unwrap(),
            boundary
        );

        let failed = JournalEntry {
            seq: JournalSeq(7),
            at: Timestamp::from_millis(4_100),
            caused_by: Cause::Processing(JournalSeq(5)),
            event: LifecycleEvent::ProcessingFailed {
                trigger: JournalSeq(5),
                error: ProcessingError {
                    message: "stream unavailable".into(),
                    retriable: true,
                },
            },
        };
        let json = serde_json::to_string(&failed).unwrap();
        assert_eq!(
            json,
            r#"{"seq":7,"at":4100,"caused_by":5,"event":{"ProcessingFailed":{"trigger":5,"error":{"message":"stream unavailable","retriable":true}}}}"#
        );
        assert_eq!(serde_json::from_str::<JournalEntry>(&json).unwrap(), failed);
    }
}

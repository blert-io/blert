//! Derived state of an active challenge.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::types::{
    ChallengeMode, ChallengeStatus, ChallengeType, ClientId, MsgId, RecordingType, ReportedTimes,
    SessionToken, Stage, StageStatus, Timestamp, UserId, Uuid,
};

/// Progress of the challenge's current stage attempt.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum StageState {
    /// Clients are recording the stage.
    #[default]
    InProgress,
    /// Some but not all clients have completed the stage.
    Ending { since: Timestamp },
    /// The stage's event streams are finalized.
    Complete { since: Timestamp },
}

/// Overall lifecycle phase of a challenge.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChallengePhase {
    /// Clients are recording the challenge.
    #[default]
    Active,
    /// At least one client has definitively finished.
    Finishing {
        /// Time of the first client finish.
        since: Timestamp,
        // TODO(frolv): Remove once stage processing is added.
        status: ChallengeStatus,
    },
    /// The challenge has ended.
    Terminated { status: ChallengeStatus },
}

impl ChallengePhase {
    /// The phase's user-facing status.
    #[must_use]
    pub fn status(self) -> ChallengeStatus {
        match self {
            ChallengePhase::Active | ChallengePhase::Finishing { .. } => {
                ChallengeStatus::InProgress
            }
            ChallengePhase::Terminated { status } => status,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClientState {
    pub user_id: UserId,
    pub session_token: SessionToken,
    pub recording_type: RecordingType,
    pub active: bool,
    pub stage: Stage,
    pub stage_status: StageStatus,
    pub stage_attempt: Option<u32>,
}

/// State published by a challenge for outside readers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub uuid: Uuid,
    pub mode: ChallengeMode,
    pub stage: Stage,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage_attempt: Option<u32>,
    pub phase: ChallengePhase,
    /// Last inbox message the challenge has processed, whether or not it had
    /// any effect. Lets a caller await the application of its own command.
    pub cursor: MsgId,
}

impl Snapshot {
    #[must_use]
    pub fn of(state: &ChallengeState, cursor: MsgId) -> Self {
        Self {
            uuid: state.uuid,
            mode: state.mode,
            stage: state.stage,
            stage_attempt: state.stage_attempt,
            phase: state.phase,
            cursor,
        }
    }

    #[must_use]
    pub fn status(&self) -> ChallengeStatus {
        self.phase.status()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChallengeState {
    pub uuid: Uuid,
    pub challenge_type: ChallengeType,
    pub mode: ChallengeMode,
    pub party: Vec<String>,
    pub phase: ChallengePhase,
    /// Completion times reported by a finishing client.
    pub reported_times: Option<ReportedTimes>,
    pub stage: Stage,
    pub stage_attempt: Option<u32>,
    pub stage_state: StageState,
    pub clients: BTreeMap<ClientId, ClientState>,
    /// Last applied inbox message.
    pub cursor: MsgId,
}

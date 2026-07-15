//! Derived state of an active challenge.

use std::collections::{BTreeMap, BTreeSet};

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
pub enum PhaseState {
    /// Clients are recording the challenge.
    #[default]
    Active,
    /// At least one client has definitively finished.
    Finishing {
        /// Time of the most recent client finish.
        since: Timestamp,
        // TODO(frolv): Remove once stage processing is added.
        status: ChallengeStatus,
    },
    /// The challenge has ended.
    Terminated { status: ChallengeStatus },
}

impl PhaseState {
    /// The phase's user-facing status.
    #[must_use]
    pub fn status(self) -> ChallengeStatus {
        match self {
            PhaseState::Active | PhaseState::Finishing { .. } => ChallengeStatus::InProgress,
            PhaseState::Terminated { status } => status,
        }
    }

    /// Returns the published form of the phase.
    #[must_use]
    pub fn phase(self) -> ChallengePhase {
        match self {
            PhaseState::Active => ChallengePhase::Active,
            PhaseState::Finishing { .. } => ChallengePhase::Finishing,
            PhaseState::Terminated { .. } => ChallengePhase::Terminated,
        }
    }
}

/// A challenge's lifecycle phase as published for external readers.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChallengePhase {
    #[default]
    Active,
    Finishing,
    Terminated,
}

impl ChallengePhase {
    /// External representation of the phase.
    #[must_use]
    pub fn tag(self) -> &'static str {
        match self {
            ChallengePhase::Active => "ACTIVE",
            ChallengePhase::Finishing => "FINISHING",
            ChallengePhase::Terminated => "TERMINATED",
        }
    }

    /// Parses a phase from its representation.
    #[must_use]
    pub fn from_tag(tag: &str) -> Option<Self> {
        [Self::Active, Self::Finishing, Self::Terminated]
            .into_iter()
            .find(|phase| phase.tag() == tag)
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub uuid: Uuid,
    pub challenge_type: ChallengeType,
    pub mode: ChallengeMode,
    pub stage: Stage,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage_attempt: Option<u32>,
    pub party: Vec<String>,
    pub phase: ChallengePhase,
    pub status: ChallengeStatus,
    /// Last inbox message the challenge has processed, whether or not it had
    /// any effect. Lets a caller await the application of its own command.
    pub cursor: MsgId,
}

impl Snapshot {
    #[must_use]
    pub fn of(state: &ChallengeState, cursor: MsgId) -> Self {
        Self {
            uuid: state.uuid,
            challenge_type: state.challenge_type,
            mode: state.mode,
            stage: state.stage,
            stage_attempt: state.stage_attempt,
            party: state.party.clone(),
            phase: state.phase.phase(),
            status: state.phase.status(),
            cursor,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChallengeState {
    pub uuid: Uuid,
    pub challenge_type: ChallengeType,
    pub mode: ChallengeMode,
    pub party: Vec<String>,
    /// A player left partway through.
    pub party_changed: bool,
    pub phase: PhaseState,
    /// Completion times reported by a finishing client.
    pub reported_times: Option<ReportedTimes>,
    pub stage: Stage,
    pub stage_attempt: Option<u32>,
    /// Status of the challenge's current stage.
    // TODO(frolv): Derived from client reports until stage processing
    // provides merged outcomes.
    pub stage_status: StageStatus,
    pub stage_state: StageState,
    pub clients: BTreeMap<ClientId, ClientState>,
    /// Every client that has recorded any part of the challenge.
    pub recorded_by: BTreeSet<ClientId>,
    /// When the challenge lost its last active client.
    pub dormant_since: Option<Timestamp>,
    /// Last applied inbox message.
    pub cursor: MsgId,
}

//! Commands processed by a challenge.

use serde::{Deserialize, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};

use super::deadline::Deadline;
use super::types::{
    ChallengeMode, ChallengeType, ClientId, JournalSeq, MsgId, RecordingType, ReportedTimes,
    SessionToken, Stage, StageProcessingError, StageProcessingOutcome, StageStatus, UserId,
};

/// A client's stage progress report.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct StageProgress {
    pub stage: Stage,
    pub status: StageStatus,
}

/// State of a client within a challenge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize_repr, Deserialize_repr)]
#[repr(u8)]
pub enum ClientStatus {
    Active = 0,
    Idle = 1,
    Disconnected = 2,
}

/// Request to start a new challenge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Create {
    pub user_id: UserId,
    pub client_id: ClientId,
    pub session_token: SessionToken,
    pub plugin_version: String,
    pub runelite_version: String,
    pub challenge_type: ChallengeType,
    pub mode: ChallengeMode,
    pub party: Vec<String>,
    pub stage: Stage,
    pub recording_type: RecordingType,
}

/// Request to join an existing challenge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Join {
    pub user_id: UserId,
    pub client_id: ClientId,
    pub session_token: SessionToken,
    pub plugin_version: String,
    pub runelite_version: String,
    pub recording_type: RecordingType,
}

impl From<&Create> for Join {
    fn from(create: &Create) -> Self {
        Join {
            user_id: create.user_id,
            client_id: create.client_id,
            session_token: create.session_token.clone(),
            plugin_version: create.plugin_version.clone(),
            runelite_version: create.runelite_version.clone(),
            recording_type: create.recording_type,
        }
    }
}

/// Request to update the state of an active challenge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub user_id: UserId,
    pub client_id: ClientId,
    pub session_token: SessionToken,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<ChallengeMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<StageProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub party: Option<Vec<String>>,
}

/// Request to complete a challenge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finish {
    pub user_id: UserId,
    pub client_id: ClientId,
    pub session_token: SessionToken,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub times: Option<ReportedTimes>,
    pub soft: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientStatusChange {
    pub user_id: UserId,
    pub client_id: ClientId,
    pub session_token: SessionToken,
    pub status: ClientStatus,
}

/// Completion message from the stage processing pipeline.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageProcessed {
    pub stage: Stage,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempt: Option<u32>,
    /// Journal position of the `StageSealed` that spawned the processing run.
    pub seal_seq: JournalSeq,
    pub result: Result<StageProcessingOutcome, StageProcessingError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Command {
    Create(Create),
    Join(Join),
    Update(Update),
    Finish(Finish),
    ClientStatus(ClientStatusChange),
    StageProcessed(StageProcessed),
    DeadlineFired(Deadline),
}

/// A command as stored in the inbox.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Envelope {
    pub id: MsgId,
    pub cmd: Command,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_matches_wire_shape() {
        let update = Update {
            user_id: UserId(7),
            client_id: ClientId(3),
            session_token: "tok".into(),
            mode: Some(ChallengeMode::TobRegular),
            stage: Some(StageProgress {
                stage: Stage::TobMaiden,
                status: StageStatus::Completed,
            }),
            party: None,
        };
        let json = serde_json::to_string(&update).unwrap();
        assert_eq!(
            json,
            r#"{"userId":7,"clientId":3,"sessionToken":"tok","mode":11,"stage":{"stage":10,"status":2}}"#
        );
        assert_eq!(serde_json::from_str::<Update>(&json).unwrap(), update);
    }
}

//! Commands processed by a challenge.

use blert::Rsn;
use serde::{Deserialize, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};

use super::deadline::Deadline;
use super::types::{
    ChallengeMode, ChallengeType, ClientId, JournalSeq, MsgId, OverallTicks, ProcessingError,
    ProcessingPayload, RecordingType, ReportedTimes, SessionToken, Stage, StageStatus, UserId,
    Uuid,
};

/// A client's stage progress report.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageProgress {
    pub stage: Stage,
    pub status: StageStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overall_ticks: Option<OverallTicks>,
}

/// State of a client within a challenge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize_repr, Deserialize_repr)]
#[repr(u8)]
pub enum ClientStatus {
    Active = 0,
    Idle = 1,
    Disconnected = 2,
}

/// External request to start a new challenge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRequest {
    pub user_id: UserId,
    pub client_id: ClientId,
    pub session_token: SessionToken,
    pub plugin_version: String,
    pub runelite_version: String,
    pub challenge_type: ChallengeType,
    pub mode: ChallengeMode,
    pub party: Vec<Rsn>,
    pub stage: Stage,
    pub recording_type: RecordingType,
}

/// Command to start a new challenge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Create {
    pub session_uuid: Uuid,
    #[serde(flatten)]
    pub request: CreateRequest,
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

impl From<&CreateRequest> for Join {
    fn from(request: &CreateRequest) -> Self {
        Join {
            user_id: request.user_id,
            client_id: request.client_id,
            session_token: request.session_token.clone(),
            plugin_version: request.plugin_version.clone(),
            runelite_version: request.runelite_version.clone(),
            recording_type: request.recording_type,
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
    pub party: Option<Vec<Rsn>>,
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

/// A client started another challenge, leaving this one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientMovedOn {
    pub client_id: ClientId,
}

/// Terminal report from a processing run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Processed {
    /// Journal position of the entry that triggered the run.
    pub trigger: JournalSeq,
    /// The run attempt which produced the result.
    pub attempt: u32,
    pub result: Result<ProcessingPayload, ProcessingError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Command {
    Create(Create),
    Join(Join),
    Update(Update),
    Finish(Finish),
    ClientStatus(ClientStatusChange),
    ClientMovedOn(ClientMovedOn),
    Processed(Processed),
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
    use crate::lifecycle::core::types::ServerTicks;

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
                overall_ticks: None,
            }),
            party: None,
        };
        let json = serde_json::to_string(&update).unwrap();
        assert_eq!(
            json,
            r#"{"userId":7,"clientId":3,"sessionToken":"tok","mode":11,"stage":{"stage":10,"status":2}}"#
        );
        assert_eq!(serde_json::from_str::<Update>(&json).unwrap(), update);

        let server = StageProgress {
            stage: Stage::TfaGuardian,
            status: StageStatus::Started,
            overall_ticks: Some(OverallTicks::Server(ServerTicks {
                count: 412,
                precise: true,
            })),
        };
        let json = serde_json::to_string(&server).unwrap();
        assert_eq!(
            json,
            r#"{"stage":60,"status":1,"overallTicks":{"server":{"count":412,"precise":true}}}"#
        );
        assert_eq!(
            serde_json::from_str::<StageProgress>(&json).unwrap(),
            server
        );

        let local = StageProgress {
            stage: Stage::InfernoWave2,
            status: StageStatus::Started,
            overall_ticks: Some(OverallTicks::Local(132)),
        };
        let json = serde_json::to_string(&local).unwrap();
        assert_eq!(
            json,
            r#"{"stage":201,"status":1,"overallTicks":{"local":132}}"#
        );
        assert_eq!(serde_json::from_str::<StageProgress>(&json).unwrap(), local);

        assert_eq!(
            serde_json::from_str::<StageProgress>(r#"{"stage":10,"status":2,"overallTicks":null}"#)
                .unwrap(),
            StageProgress {
                stage: Stage::TobMaiden,
                status: StageStatus::Completed,
                overall_ticks: None,
            },
        );
    }
}

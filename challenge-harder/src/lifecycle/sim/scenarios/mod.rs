//! Scripted lifecycle scenarios, asserting full transition traces.

#![allow(clippy::too_many_lines)]

mod challenge_end;
mod creation;
mod determinism;
mod progression;
mod retries;
mod stage_end;

use super::{Action, Client, Scenario};
use crate::lifecycle::core::command::StageProgress;
use crate::lifecycle::core::event::{Cause, JournalEntry, LifecycleEvent};
use crate::lifecycle::core::types::{
    ChallengeMode, ChallengeType, ClientId, JournalSeq, MsgId, RecordingType, Stage, StageStatus,
    Timestamp, UserId,
};

pub fn duo() -> Vec<String> {
    vec!["WWWWWWWWWWQQ".into(), "715".into()]
}

pub fn tob_start() -> Action {
    Action::Start {
        challenge_type: ChallengeType::Tob,
        mode: ChallengeMode::TobRegular,
        party: duo(),
        stage: Stage::TobMaiden,
    }
}

pub fn report(stage: Stage, status: StageStatus) -> Action {
    Action::Update {
        mode: None,
        stage: Some(StageProgress { stage, status }),
    }
}

pub fn finish(soft: bool) -> Action {
    Action::Finish { times: None, soft }
}

pub fn entry(seq: u64, at_ms: u64, caused_by: Cause, event: LifecycleEvent) -> JournalEntry {
    JournalEntry {
        seq: JournalSeq(seq),
        at: Timestamp::from_millis(at_ms),
        caused_by,
        event,
    }
}

pub fn cmd(n: u64) -> Cause {
    Cause::Command(MsgId(n))
}

pub fn client_id(client: i64) -> ClientId {
    ClientId(10 * client)
}

pub fn reported(client: i64, stage: Stage, status: StageStatus) -> LifecycleEvent {
    LifecycleEvent::ClientStageReported {
        client_id: client_id(client),
        attempt: None,
        update: StageProgress { stage, status },
    }
}

pub fn reported_attempt(
    client: i64,
    stage: Stage,
    status: StageStatus,
    attempt: u32,
) -> LifecycleEvent {
    LifecycleEvent::ClientStageReported {
        client_id: client_id(client),
        attempt: Some(attempt),
        update: StageProgress { stage, status },
    }
}

pub fn joined(client: i64, recording_type: RecordingType) -> LifecycleEvent {
    LifecycleEvent::ClientJoined {
        client_id: client_id(client),
        user_id: UserId(client),
        session_token: format!("tok{client}").into(),
        recording_type,
    }
}

/// A solo Colosseum attempt wiping on wave 2.
pub fn solo_colosseum() -> Scenario {
    Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(
                    0,
                    Action::Start {
                        challenge_type: ChallengeType::Colosseum,
                        mode: ChallengeMode::NoMode,
                        party: vec!["aSaradomin".into()],
                        stage: Stage::ColosseumWave1,
                    },
                )
                .at(10, report(Stage::ColosseumWave1, StageStatus::Started))
                .at(500, report(Stage::ColosseumWave1, StageStatus::Completed))
                .at(600, report(Stage::ColosseumWave2, StageStatus::Started))
                .at(900, report(Stage::ColosseumWave2, StageStatus::Wiped))
                .at(1_000, finish(false)),
        ],
        run_until: 1_500,
    }
}

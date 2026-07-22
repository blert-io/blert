//! Challenge data processing.

use std::time::{Duration, UNIX_EPOCH};

use crate::lifecycle::core::types::{
    ChallengeMode, ChallengeStatus, PrimaryMeleeGear, RecordingType, Stage, UserId, Uuid,
};
use crate::players::normalize_rsn;

use super::{ChallengeInfo, db};

/// Initializes a new challenge.
pub async fn create(
    txn: &mut db::Transaction,
    uuid: Uuid,
    info: &ChallengeInfo,
) -> Result<(), db::Error> {
    let start_time = UNIX_EPOCH + Duration::from_millis(info.created_unix_ms);
    let scale = i16::try_from(info.party.len()).expect("party fits in a smallint");
    let row = txn
        .query_one(
            "INSERT INTO challenges (uuid, type, mode, scale, stage, status, start_time)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id",
            &[
                &uuid,
                &(info.challenge_type as i16),
                &(info.mode as i16),
                &scale,
                &(info.stage as i16),
                &(ChallengeStatus::InProgress as i16),
                &start_time,
            ],
        )
        .await?;
    txn.set_challenge_id(row.get(0));

    for (orb, username) in info.party.iter().enumerate() {
        let player_id = start_player_challenge(txn, username).await?;
        txn.execute(
            "INSERT INTO challenge_players (challenge_id, player_id, username, orb, primary_gear)
             VALUES ($1, $2, $3, $4, $5)",
            &[
                &txn.challenge_id(),
                &player_id,
                &username,
                &i16::try_from(orb).expect("orb fits in a smallint"),
                &(PrimaryMeleeGear::Unknown as i16),
            ],
        )
        .await?;
    }

    Ok(())
}

/// Records that a player has started a challenge, creating their row if it
/// does not exist. Returns the player's database ID.
async fn start_player_challenge(txn: &db::Transaction, username: &str) -> Result<i32, db::Error> {
    // The unique index on normalized_username is partial, so the conflict
    // target must spell its predicate for Postgres.
    let row = txn
        .query_one(
            "INSERT INTO players (username, normalized_username, total_recordings)
             VALUES ($1, $2, 1)
             ON CONFLICT (normalized_username) WHERE NOT starts_with(normalized_username, '*')
             DO UPDATE SET total_recordings = players.total_recordings + 1
             RETURNING id",
            &[&username, &normalize_rsn(username)],
        )
        .await?;
    Ok(row.get(0))
}

/// Records a user as a recorder of the challenge.
pub async fn add_recorder(
    txn: &db::Transaction,
    user_id: UserId,
    recording_type: RecordingType,
) -> Result<(), db::Error> {
    txn.execute(
        "INSERT INTO recorded_challenges (challenge_id, recorder_id, recording_type)
         VALUES ($1, $2, $3)
         ON CONFLICT (challenge_id, recorder_id)
         DO UPDATE SET recording_type = GREATEST(
             recorded_challenges.recording_type,
             EXCLUDED.recording_type
         )",
        &[
            &txn.challenge_id(),
            &i32::try_from(user_id.0).expect("user id fits in an integer"),
            &(recording_type as i16),
        ],
    )
    .await?;
    Ok(())
}

/// Records the challenge starting a new stage.
pub async fn update_stage(txn: &db::Transaction, stage: Stage) -> Result<(), db::Error> {
    txn.execute(
        "UPDATE challenges SET stage = $1 WHERE id = $2",
        &[&(stage as i16), &txn.challenge_id()],
    )
    .await?;
    Ok(())
}

/// Records a change to the challenge's mode.
pub async fn update_mode(txn: &db::Transaction, mode: ChallengeMode) -> Result<(), db::Error> {
    txn.execute(
        "UPDATE challenges SET mode = $1 WHERE id = $2",
        &[&(mode as i16), &txn.challenge_id()],
    )
    .await?;
    Ok(())
}

/// Finalizes a challenge, recording its ending status.
pub async fn finish(txn: &db::Transaction, info: &ChallengeInfo) -> Result<(), db::Error> {
    txn.execute(
        "UPDATE challenges SET status = $1 WHERE id = $2",
        &[&(info.status as i16), &txn.challenge_id()],
    )
    .await?;

    // TODO(frolv): The rest of the owl

    Ok(())
}

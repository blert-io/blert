//! Challenge data processing.

use std::time::{Duration, UNIX_EPOCH};

use crate::lifecycle::core::types::{
    ChallengeStatus, PrimaryMeleeGear, RecordingType, UserId, Uuid,
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

    let player_ids = start_player_challenges(txn, &info.party).await?;
    let orbs: Vec<i16> = (0..info.party.len())
        .map(|orb| i16::try_from(orb).expect("orb fits in a smallint"))
        .collect();
    txn.execute(
        "INSERT INTO challenge_players (challenge_id, player_id, username, orb, primary_gear)
         SELECT $1, player_id, username, orb, $2
         FROM UNNEST($3::INT[], $4::TEXT[], $5::SMALLINT[]) AS input (player_id, username, orb)",
        &[
            &txn.challenge_id(),
            &(PrimaryMeleeGear::Unknown as i16),
            &player_ids,
            &info.party,
            &orbs,
        ],
    )
    .await?;

    Ok(())
}

/// Records that each player in `party` has started a challenge, creating
/// their rows if they do not exist. Returns the players' database IDs, in
/// party order.
async fn start_player_challenges(
    txn: &db::Transaction,
    party: &[String],
) -> Result<Vec<i32>, db::Error> {
    let normalized: Vec<String> = party.iter().map(|name| normalize_rsn(name)).collect();
    // The unique index on normalized_username is partial, so the conflict
    // target must spell its predicate for Postgres.
    let rows = txn
        .query(
            "INSERT INTO players (username, normalized_username, total_recordings)
             SELECT username, normalized, 1
             FROM UNNEST($1::TEXT[], $2::TEXT[]) AS input (username, normalized)
             ON CONFLICT (normalized_username) WHERE NOT starts_with(normalized_username, '*')
             DO UPDATE SET total_recordings = players.total_recordings + 1
             RETURNING id, normalized_username",
            &[&party, &normalized],
        )
        .await?;

    let ids: std::collections::HashMap<String, i32> =
        rows.iter().map(|row| (row.get(1), row.get(0))).collect();
    normalized
        .iter()
        .map(|name| {
            ids.get(name)
                .copied()
                .ok_or_else(|| db::Error::InvalidData(format!("no player row returned for {name}")))
        })
        .collect()
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

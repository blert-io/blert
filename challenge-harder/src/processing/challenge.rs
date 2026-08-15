//! Challenge data processing.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::lifecycle::core::types::{
    ChallengeMode, ChallengeStatus, ChallengeTypeExt, PlayerId, PrimaryMeleeGear, ProcessingError,
    RecordingType, Stage, UserId,
};
use crate::metrics;
use crate::players::normalize_rsn;
use crate::repository::DataRepository;

use super::challenge_processor::ChallengeContext;
use super::persist::{save_splits, update_player_stats};
use super::{ChallengeInfo, StoredPlayerInfo, StoredState, db, session};

/// Initializes a new challenge, returning custom processor state to persist.
pub async fn create(
    txn: &mut db::Transaction,
    repository: &DataRepository,
    info: &ChallengeInfo,
) -> Result<Option<serde_json::Value>, ProcessingError> {
    insert_challenge(txn, info).await?;

    let Some(mut processor) = super::processor_for(info, None)? else {
        return Ok(None);
    };
    processor.on_create(txn).await?;
    if let Some(data) = processor.challenge_data() {
        repository.save_challenge(info.uuid, &data).await?;
    }
    Ok(processor.custom_data())
}

async fn insert_challenge(
    txn: &mut db::Transaction,
    info: &ChallengeInfo,
) -> Result<(), db::Error> {
    let start_time = UNIX_EPOCH + Duration::from_millis(info.created_unix_ms);
    let session_id = session::resolve_session(txn, info, start_time).await?;
    let row = txn
        .query_one(
            "INSERT INTO challenges
               (uuid, session_id, type, mode, scale, stage, status, start_time)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id",
            &[
                &info.uuid,
                &session_id,
                &(info.challenge_type as i16),
                &(info.mode as i16),
                &info.scale(),
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
                &player_id.0,
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
async fn start_player_challenge(
    txn: &db::Transaction,
    username: &str,
) -> Result<PlayerId, db::Error> {
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
    Ok(PlayerId(row.get(0)))
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
    let challenge = async {
        txn.execute(
            "UPDATE challenges SET mode = $1 WHERE id = $2",
            &[&(mode as i16), &txn.challenge_id()],
        )
        .await?;
        Ok::<_, db::Error>(())
    };
    tokio::try_join!(challenge, session::update_mode(txn, mode))?;
    Ok(())
}

/// Finalizes a challenge, recording its outcome.
/// A challenge without recorded data is deleted.
pub async fn finish(
    txn: &mut db::Transaction,
    repository: &DataRepository,
    info: &ChallengeInfo,
) -> Result<(), ProcessingError> {
    let stored = load_database_state(txn, info).await?;
    let finish_time = info
        .finished_unix_ms
        .map(|ms| UNIX_EPOCH + Duration::from_millis(ms))
        .ok_or_else(|| db::Error::InvalidData("invalid finish without an end time".into()))?;
    if stored.challenge_ticks == 0 {
        tracing::info!(uuid = %info.uuid, "challenge_finished_no_data");
        return delete_empty_challenge(txn, repository, info, &stored.players, finish_time).await;
    }

    let Some(mut processor) = super::processor_for(info, stored.custom_data.as_ref())? else {
        tokio::try_join!(
            finalize_challenge_row(txn, info, finish_time, stored.challenge_ticks, false),
            session::update_end_time(txn, finish_time),
        )?;
        return Ok(());
    };

    let recorded_ticks = processor.final_challenge_ticks(stored.challenge_ticks);
    let mut final_ticks = recorded_ticks;
    if let Some(times) = info.reported_times
        && times.challenge != recorded_ticks
    {
        tracing::warn!(
            uuid = %info.uuid,
            recorded_ticks,
            reported_ticks = times.challenge,
            "challenge_time_mismatch",
        );
        metrics::record_reported_time_mismatch();
        final_ticks = times.challenge;
    }

    // Correct the challenge ticks based on the server report. Any ticks
    // recorded in stages beyond the official end accumulate further.
    let challenge_ticks = stored.challenge_ticks - recorded_ticks + final_ticks;

    let full_recording = processor.has_fully_recorded_up_to(info.stage);
    let mut ctx = ChallengeContext::new(info.party.clone());
    tokio::try_join!(
        finalize_challenge_row(txn, info, finish_time, challenge_ticks, full_recording),
        session::update_end_time(txn, finish_time),
        processor.on_finish(txn, &stored, &mut ctx, final_ticks),
    )?;

    let times_accurate = !info.party_changed
        && info
            .challenge_type
            .last_stage()
            .is_some_and(|last| processor.has_fully_recorded_up_to(last))
        && info.status == ChallengeStatus::Completed;

    tokio::try_join!(
        save_splits(txn, info, ctx.splits(times_accurate), &stored.players),
        update_player_stats(txn, ctx.players(), &stored.players),
    )?;

    Ok(())
}

async fn delete_empty_challenge(
    txn: &mut db::Transaction,
    repository: &DataRepository,
    info: &ChallengeInfo,
    players: &[StoredPlayerInfo],
    finish_time: SystemTime,
) -> Result<(), ProcessingError> {
    session::update_end_time(txn, finish_time).await?;
    let delete_row = async { txn.delete_challenge().await.map_err(ProcessingError::from) };
    let delete_data = async {
        repository
            .delete_challenge(info.uuid)
            .await
            .map_err(ProcessingError::from)
    };
    tokio::try_join!(delete_row, delete_data)?;

    let ids: Vec<i32> = players.iter().map(|player| player.id.0).collect();
    txn.execute(
        "UPDATE players SET total_recordings = total_recordings - 1 WHERE id = ANY($1)",
        &[&ids],
    )
    .await
    .map_err(db::Error::from)?;
    Ok(())
}

async fn finalize_challenge_row(
    txn: &db::Transaction,
    info: &ChallengeInfo,
    finish_time: SystemTime,
    final_ticks: u32,
    full_recording: bool,
) -> Result<(), db::Error> {
    txn.execute(
        "UPDATE challenges
         SET status = $1, challenge_ticks = $2, overall_ticks = $3, finish_time = $4,
             full_recording = $5
         WHERE id = $6",
        &[
            &(info.status as i16),
            &final_ticks.cast_signed(),
            &info
                .reported_times
                .and_then(|times| times.overall)
                .map(u32::cast_signed),
            &finish_time,
            &full_recording,
            &txn.challenge_id(),
        ],
    )
    .await?;
    Ok(())
}

/// Loads the stored database state for a processing run.
pub(super) async fn load_database_state(
    txn: &db::Transaction,
    info: &ChallengeInfo,
) -> Result<StoredState, db::Error> {
    let players = async {
        let rows = txn
            .query(
                "SELECT player_id, primary_gear FROM challenge_players
                 WHERE challenge_id = $1
                 ORDER BY orb",
                &[&txn.challenge_id()],
            )
            .await?;
        if rows.len() != info.scale().cast_unsigned() as usize {
            return Err(db::Error::InvalidData(format!(
                "challenge has {} players, expected {}",
                rows.len(),
                info.scale(),
            )));
        }

        rows.iter()
            .map(|row| {
                let gear: i16 = row.get(1);
                Ok(StoredPlayerInfo {
                    id: PlayerId(row.get(0)),
                    gear: PrimaryMeleeGear::try_from(gear)
                        .map_err(|value| db::Error::InvalidData(format!("primary gear {value}")))?,
                })
            })
            .collect::<Result<Vec<_>, db::Error>>()
    };
    let challenge_ticks = async {
        let row = txn
            .query_one(
                "SELECT challenge_ticks FROM challenges WHERE id = $1",
                &[&txn.challenge_id()],
            )
            .await?;
        Ok(row.get::<_, i32>(0).cast_unsigned())
    };
    let (players, challenge_ticks) = tokio::try_join!(players, challenge_ticks)?;

    Ok(StoredState {
        players,
        challenge_ticks,
        custom_data: txn.custom_data().cloned(),
    })
}

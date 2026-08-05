//! Finish processing effects.

use serde_json::json;

use crate::lifecycle::core::state::Trigger;
use crate::lifecycle::core::types::{
    ChallengeMode, ChallengeStatus, ChallengeType, JournalSeq, ProcessingPayload, ReportedTimes,
    Stage, StageStatus, Uuid,
};
use crate::processing::{ChallengeInfo, challenge, db};
use crate::repository::{DataRepository, FilesystemBackend};

#[tokio::test]
async fn empty_challenge_is_deleted_at_finish() {
    let Some(db) = db::test_database().await else {
        return;
    };
    let dir = tempfile::tempdir().expect("temp repository");
    let repository =
        DataRepository::new(Box::new(FilesystemBackend::new(dir.path().to_path_buf())));

    let uuid = Uuid::new_v4();
    let player = format!("1Ogp {}", &uuid.to_string()[..7]);
    let info = ChallengeInfo {
        uuid,
        challenge_type: ChallengeType::Mokhaiotl,
        mode: ChallengeMode::NoMode,
        party: vec![player.clone()],
        party_changed: false,
        stage: Stage::MokhaiotlDelve1,
        stage_attempt: None,
        status: ChallengeStatus::InProgress,
        created_unix_ms: 1_785_772_101_000,
        reported_times: None,
        finished_unix_ms: None,
    };

    let mut txn = db
        .start_transaction(uuid, Trigger::Create { seq: JournalSeq(1) })
        .await
        .expect("create guard should pass");
    let custom_data = challenge::create(&mut txn, &repository, &info)
        .await
        .expect("create should succeed");
    txn.commit(&ProcessingPayload::None, custom_data.as_ref())
        .await
        .expect("create should commit");

    let client = db.client().await;
    let row = client
        .query_one(
            "SELECT p.id, p.total_recordings FROM players p WHERE p.username = $1",
            &[&player],
        )
        .await
        .expect("create should insert the player");
    let player_id: i32 = row.get(0);
    assert_eq!(row.get::<_, i32>(1), 1);
    assert!(repository.load_challenge(uuid).await.is_ok());

    // Finish the challenge.
    let info = ChallengeInfo {
        status: ChallengeStatus::Abandoned,
        finished_unix_ms: Some(1_785_772_401_000),
        ..info
    };
    let mut txn = db
        .start_transaction(uuid, Trigger::Finish { seq: JournalSeq(2) })
        .await
        .expect("finish guard should pass");
    challenge::finish(&mut txn, &repository, &info)
        .await
        .expect("finish should succeed");
    txn.commit(&ProcessingPayload::None, None)
        .await
        .expect("finish should commit");

    let challenges: i64 = client
        .query_one("SELECT COUNT(*) FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("count")
        .get(0);
    assert_eq!(challenges, 0);
    let members: i64 = client
        .query_one(
            "SELECT COUNT(*) FROM challenge_players WHERE player_id = $1",
            &[&player_id],
        )
        .await
        .expect("count")
        .get(0);
    assert_eq!(members, 0);
    let recordings: i32 = client
        .query_one(
            "SELECT total_recordings FROM players WHERE id = $1",
            &[&player_id],
        )
        .await
        .expect("recording count")
        .get(0);
    assert_eq!(recordings, 0);
    assert!(repository.load_challenge(uuid).await.is_err());

    // A second finish returns already applied.
    let replay = db
        .start_transaction(uuid, Trigger::Finish { seq: JournalSeq(2) })
        .await;
    assert!(matches!(
        replay,
        Err(db::Error::AlreadyApplied(ProcessingPayload::None)),
    ));

    client
        .execute("DELETE FROM players WHERE id = $1", &[&player_id])
        .await
        .expect("cleanup");
}

#[tokio::test]
#[expect(clippy::too_many_lines)]
async fn reported_time_mismatch_corrects_the_challenge_ticks() {
    let Some(db) = db::test_database().await else {
        return;
    };
    let dir = tempfile::tempdir().expect("temp repository");
    let repository =
        DataRepository::new(Box::new(FilesystemBackend::new(dir.path().to_path_buf())));

    let uuid = Uuid::new_v4();
    let player = format!("1Ogp {}", &uuid.to_string()[..7]);
    let info = ChallengeInfo {
        uuid,
        challenge_type: ChallengeType::Mokhaiotl,
        mode: ChallengeMode::NoMode,
        party: vec![player.clone()],
        party_changed: false,
        stage: Stage::MokhaiotlDelve8,
        stage_attempt: None,
        status: ChallengeStatus::InProgress,
        created_unix_ms: 1_785_858_060_000,
        reported_times: None,
        finished_unix_ms: None,
    };

    let mut txn = db
        .start_transaction(uuid, Trigger::Create { seq: JournalSeq(1) })
        .await
        .expect("create guard should pass");
    let custom_data = challenge::create(&mut txn, &repository, &info)
        .await
        .expect("create should succeed");
    txn.commit(&ProcessingPayload::None, custom_data.as_ref())
        .await
        .expect("create should commit");

    // A recording that starts at delve 8 counts only its 123 ticks, after which
    // the client reports the full 1-8 time from the game.
    let custom = json!({
        "delves": [{
            "stage": Stage::MokhaiotlDelve8 as i32,
            "ticksLost": 0,
            "npcs": [],
            "delve": 8,
            "challengeTicks": 123,
            "larvaeLeaked": 0,
        }],
        "delve1To8Ticks": 123,
    });
    let txn = db
        .start_transaction(
            uuid,
            Trigger::Stage {
                seq: JournalSeq(2),
                stage: Stage::MokhaiotlDelve8,
                attempt: None,
            },
        )
        .await
        .expect("stage guard should pass");
    txn.execute(
        "UPDATE challenges SET challenge_ticks = $1 WHERE id = $2",
        &[&123_i32, &txn.challenge_id()],
    )
    .await
    .expect("seed should apply");
    txn.commit(
        &ProcessingPayload::Stage {
            status: StageStatus::Completed,
            ticks: 123,
        },
        Some(&custom),
    )
    .await
    .expect("stage should commit");

    let info = ChallengeInfo {
        status: ChallengeStatus::Completed,
        reported_times: Some(ReportedTimes {
            challenge: 848,
            overall: None,
        }),
        finished_unix_ms: Some(1_785_859_016_486),
        ..info
    };
    let mut txn = db
        .start_transaction(uuid, Trigger::Finish { seq: JournalSeq(3) })
        .await
        .expect("finish guard should pass");
    challenge::finish(&mut txn, &repository, &info)
        .await
        .expect("finish should succeed");
    txn.commit(&ProcessingPayload::None, None)
        .await
        .expect("finish should commit");

    let client = db.client().await;
    let row = client
        .query_one(
            "SELECT c.id, c.status, c.challenge_ticks, c.overall_ticks, c.full_recording,
                    p.id AS player_id
             FROM challenges c
             JOIN players p ON p.username = $2
             WHERE c.uuid = $1",
            &[&uuid, &player],
        )
        .await
        .expect("challenge row should remain");
    let challenge_id: i32 = row.get(0);
    let player_id: i32 = row.get(5);
    assert_eq!(row.get::<_, i16>(1), ChallengeStatus::Completed as i16);
    // The reported time replaces the partial recording's count.
    assert_eq!(row.get::<_, i32>(2), 848);
    assert_eq!(row.get::<_, Option<i32>>(3), None);
    assert!(!row.get::<_, bool>(4));

    // The time is not counted as accurate and therefore not eligible for PBs.
    let splits = client
        .query(
            "SELECT type, scale, ticks, accurate FROM challenge_splits
             WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("splits query");
    assert_eq!(splits.len(), 1);
    assert_eq!(splits[0].get::<_, i16>(0), 200);
    assert_eq!(splits[0].get::<_, i16>(1), 1);
    assert_eq!(splits[0].get::<_, i32>(2), 848);
    assert!(!splits[0].get::<_, bool>(3));

    let pbs: i64 = client
        .query_one(
            "SELECT COUNT(*) FROM personal_best_history pbh
             JOIN challenge_splits cs ON cs.id = pbh.challenge_split_id
             WHERE pbh.player_id = $1",
            &[&player_id],
        )
        .await
        .expect("pb query")
        .get(0);
    assert_eq!(pbs, 0);

    let stats = client
        .query_one(
            "SELECT mokhaiotl_completions, mokhaiotl_resets, mokhaiotl_wipes,
                    mokhaiotl_total_delves
             FROM player_stats WHERE player_id = $1",
            &[&player_id],
        )
        .await
        .expect("exactly one stats row should exist");
    assert_eq!(stats.get::<_, i32>(0), 1);
    assert_eq!(stats.get::<_, i32>(1), 0);
    assert_eq!(stats.get::<_, i32>(2), 0);
    assert_eq!(stats.get::<_, i32>(3), 0);

    let marker = client
        .query_one(
            "SELECT processed_seq, finalized_seq, outcome_status, outcome_ticks, custom_data
             FROM challenge_processing_state WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("processing row should exist");
    assert_eq!(marker.get::<_, i64>(0), 3);
    assert_eq!(marker.get::<_, Option<i64>>(1), Some(3));
    assert_eq!(marker.get::<_, Option<i16>>(2), None);
    assert_eq!(marker.get::<_, Option<i32>>(3), None);
    assert_eq!(marker.get::<_, Option<serde_json::Value>>(4), None);

    client
        .execute("DELETE FROM challenges WHERE id = $1", &[&challenge_id])
        .await
        .expect("cleanup");
    client
        .execute(
            "DELETE FROM player_stats WHERE player_id = $1",
            &[&player_id],
        )
        .await
        .expect("cleanup");
    client
        .execute("DELETE FROM players WHERE id = $1", &[&player_id])
        .await
        .expect("cleanup");
}

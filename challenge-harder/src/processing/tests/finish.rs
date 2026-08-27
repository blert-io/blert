//! Finish processing effects.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::json;

use crate::lifecycle::core::state::Trigger;
use crate::lifecycle::core::types::{
    ChallengeMode, ChallengeStatus, ChallengeType, JournalSeq, ProcessingPayload, ReportedTimes,
    Stage, StageStatus, Uuid,
};
use crate::lifecycle::session::SessionFinalizer;
use crate::processing::effects::EventKind;
use crate::processing::session::SessionStatus;
use crate::processing::{ChallengeInfo, PostgresSessionFinalizer, ProcessorConfig, challenge, db};
use crate::repository::{DataRepository, FilesystemBackend};

#[tokio::test]
#[expect(clippy::too_many_lines)]
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
        session_uuid: Uuid::new_v4(),
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
    let custom_data = challenge::create(&mut txn, &repository, ProcessorConfig::default(), &info)
        .await
        .expect("create should succeed");
    txn.commit(&ProcessingPayload::None, custom_data.as_ref())
        .await
        .expect("create should commit");

    let client = db.checkout().await.expect("client");
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

    let session = client
        .query_one(
            "SELECT status, end_time FROM challenge_sessions WHERE uuid = $1",
            &[&info.session_uuid],
        )
        .await
        .expect("create should insert the session");
    assert_eq!(session.get::<_, i16>(0), SessionStatus::Active as i16);
    assert_eq!(session.get::<_, Option<SystemTime>>(1), None);

    // Finish the challenge.
    let info = ChallengeInfo {
        status: ChallengeStatus::Abandoned,
        finished_unix_ms: Some(1_785_772_401_243),
        ..info
    };
    let mut txn = db
        .start_transaction(uuid, Trigger::Finish { seq: JournalSeq(2) })
        .await
        .expect("finish guard should pass");
    challenge::finish(&mut txn, &repository, ProcessorConfig::default(), &info)
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

    let effects: i64 = client
        .query_one(
            "SELECT COUNT(*) FROM effect_events WHERE key LIKE $1",
            &[&format!("{uuid}%")],
        )
        .await
        .expect("count")
        .get(0);
    assert_eq!(effects, 0);

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

    let session = client
        .query_one(
            "SELECT status, end_time FROM challenge_sessions WHERE uuid = $1",
            &[&info.session_uuid],
        )
        .await
        .expect("session should outlive the deleted challenge");
    assert_eq!(session.get::<_, i16>(0), SessionStatus::Active as i16);
    assert_eq!(
        session.get::<_, Option<SystemTime>>(1),
        Some(UNIX_EPOCH + Duration::from_millis(1_785_772_401_243)),
    );

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

    // The empty session's row is deleted at finalization.
    let finalizer = PostgresSessionFinalizer::new(Arc::new(db));
    finalizer
        .finalize(info.session_uuid)
        .await
        .expect("finalization should succeed");
    let remaining: i64 = client
        .query_one(
            "SELECT COUNT(*) FROM challenge_sessions WHERE uuid = $1",
            &[&info.session_uuid],
        )
        .await
        .expect("count")
        .get(0);
    assert_eq!(remaining, 0);
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
        session_uuid: Uuid::new_v4(),
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
    let custom_data = challenge::create(&mut txn, &repository, ProcessorConfig::default(), &info)
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
            "offset": 0,
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
    challenge::finish(&mut txn, &repository, ProcessorConfig::default(), &info)
        .await
        .expect("finish should succeed");
    txn.commit(&ProcessingPayload::None, None)
        .await
        .expect("finish should commit");

    let client = db.checkout().await.expect("client");
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

    let events = client
        .query(
            "SELECT kind, key FROM effect_events WHERE key LIKE $1",
            &[&format!("{uuid}%")],
        )
        .await
        .expect("outbox query");
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0].get::<_, i16>(0),
        EventKind::ChallengeFinished as i16
    );
    assert_eq!(events[0].get::<_, String>(1), uuid.to_string());

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

    let session = client
        .query_one(
            "SELECT status, end_time FROM challenge_sessions WHERE uuid = $1",
            &[&info.session_uuid],
        )
        .await
        .expect("session row missing");
    assert_eq!(session.get::<_, i16>(0), SessionStatus::Active as i16);
    assert_eq!(
        session.get::<_, Option<SystemTime>>(1),
        Some(UNIX_EPOCH + Duration::from_millis(1_785_859_016_486)),
    );

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
    client
        .execute(
            "DELETE FROM challenge_sessions WHERE uuid = $1",
            &[&info.session_uuid],
        )
        .await
        .expect("cleanup");
}

#[tokio::test]
#[expect(clippy::too_many_lines)]
async fn finalization_corrects_the_session_start_to_its_earliest_challenge() {
    let Some(db) = db::test_database().await else {
        return;
    };
    let dir = tempfile::tempdir().expect("temp repository");
    let repository =
        DataRepository::new(Box::new(FilesystemBackend::new(dir.path().to_path_buf())));

    let session_uuid = Uuid::new_v4();
    let newer = Uuid::new_v4();
    let player = format!("1Ogp {}", &newer.to_string()[..7]);
    let newer_info = ChallengeInfo {
        uuid: newer,
        session_uuid,
        challenge_type: ChallengeType::Mokhaiotl,
        mode: ChallengeMode::NoMode,
        party: vec![player.clone()],
        party_changed: false,
        stage: Stage::MokhaiotlDelve1,
        stage_attempt: None,
        status: ChallengeStatus::InProgress,
        created_unix_ms: 1_785_772_401_000,
        reported_times: None,
        finished_unix_ms: None,
    };
    let mut txn = db
        .start_transaction(newer, Trigger::Create { seq: JournalSeq(1) })
        .await
        .expect("create guard should pass");
    let custom_data = challenge::create(
        &mut txn,
        &repository,
        ProcessorConfig::default(),
        &newer_info,
    )
    .await
    .expect("create should succeed");
    txn.commit(&ProcessingPayload::None, custom_data.as_ref())
        .await
        .expect("create should commit");

    let older = Uuid::new_v4();
    let older_info = ChallengeInfo {
        uuid: older,
        created_unix_ms: 1_785_772_101_000,
        ..newer_info.clone()
    };
    let mut txn = db
        .start_transaction(older, Trigger::Create { seq: JournalSeq(1) })
        .await
        .expect("create guard should pass");
    let custom_data = challenge::create(
        &mut txn,
        &repository,
        ProcessorConfig::default(),
        &older_info,
    )
    .await
    .expect("create should succeed");
    txn.commit(&ProcessingPayload::None, custom_data.as_ref())
        .await
        .expect("create should commit");

    let client = db.checkout().await.expect("client");
    let stamped: SystemTime = client
        .query_one(
            "SELECT start_time FROM challenge_sessions WHERE uuid = $1",
            &[&session_uuid],
        )
        .await
        .expect("session should exist")
        .get(0);
    assert_eq!(stamped, UNIX_EPOCH + Duration::from_secs(1_785_772_401),);

    // The end time should not be pushed back if a challenge delayed processing.
    #[expect(clippy::duration_suboptimal_units)]
    let provisional = UNIX_EPOCH + Duration::from_secs(1_785_772_500);
    client
        .execute(
            "UPDATE challenge_sessions SET end_time = $2 WHERE uuid = $1",
            &[&session_uuid, &provisional],
        )
        .await
        .expect("provisional end should write");

    let finalizer = PostgresSessionFinalizer::new(Arc::new(db));
    finalizer
        .finalize(session_uuid)
        .await
        .expect("finalization should succeed");

    let session = client
        .query_one(
            "SELECT start_time, end_time, status FROM challenge_sessions WHERE uuid = $1",
            &[&session_uuid],
        )
        .await
        .expect("session should survive finalization");
    assert_eq!(
        session.get::<_, SystemTime>(0),
        UNIX_EPOCH + Duration::from_secs(1_785_772_101),
    );
    assert_eq!(session.get::<_, Option<SystemTime>>(1), Some(provisional));
    assert_eq!(session.get::<_, i16>(2), SessionStatus::Completed as i16);

    for uuid in [newer, older] {
        client
            .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
            .await
            .expect("cleanup");
    }
    client
        .execute("DELETE FROM players WHERE username = $1", &[&player])
        .await
        .expect("cleanup");
    client
        .execute(
            "DELETE FROM challenge_sessions WHERE uuid = $1",
            &[&session_uuid],
        )
        .await
        .expect("cleanup");
}

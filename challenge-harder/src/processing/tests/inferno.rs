//! Runs a real recorded inferno wave through the processor, verifying results.

use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use deadpool_postgres::Object;

use super::golden;
use super::{load_fixture, prepare_fixture};
use crate::lifecycle::core::state::Trigger;
use crate::lifecycle::core::types::{
    ChallengeInfo, ChallengeMode, ChallengeStatus, ChallengeType, JournalSeq, PrimaryMeleeGear,
    ProcessingPayload, Stage, StageStatus, Uuid,
};
use crate::price::PriceResolver;
use crate::processing::split::SplitType;
use crate::processing::{Pipeline, ProcessingRequest, ProcessorConfig, StageProcessor, db};
use crate::proto::{ChallengeData, challenge_data};
use crate::redis;
use crate::repository::{DataRepository, FilesystemBackend};

const CREATED_UNIX_MS: u64 = 1_786_815_522_607;
const UUID: &str = "7c25e808-13f2-4a10-9a75-338c1e9c36d4";

#[tokio::test]
async fn wave_test() {
    let Some(db) = db::test_database().await else {
        return;
    };
    let Some(redis) = redis::tests::test_store().await else {
        return;
    };
    let _fixture_lock = super::FIXTURE_TESTS.lock().await;
    let client = db.checkout().await.expect("client");

    let uuid: Uuid = UUID.parse().expect("uuid is valid");

    // Clean the DB from previous runs.
    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .unwrap();
    client
        .execute(
            "DELETE FROM players WHERE normalized_username = 'player1'",
            &[],
        )
        .await
        .unwrap();

    prepare_fixture(uuid, Stage::InfernoWave42, &load_fixture("inferno_wave_42")).await;

    let dir = tempfile::tempdir().expect("tempdir");
    let pipeline = Pipeline::new(
        Arc::new(db),
        Arc::new(redis),
        DataRepository::new(Box::new(FilesystemBackend::new(dir.path().to_path_buf()))),
        Arc::new(PriceResolver::new()),
        ProcessorConfig::default(),
    );

    let info = ChallengeInfo {
        uuid,
        session_uuid: Uuid::new_v4(),
        challenge_type: ChallengeType::Inferno,
        mode: ChallengeMode::NoMode,
        party: vec!["player1".to_string()],
        party_changed: false,
        stage: Stage::InfernoWave42,
        stage_attempt: None,
        status: ChallengeStatus::InProgress,
        created_unix_ms: CREATED_UNIX_MS,
        reported_times: None,
        finished_unix_ms: None,
    };

    let payload = pipeline
        .process(ProcessingRequest {
            trigger: Trigger::Create { seq: JournalSeq(1) },
            challenge: info.clone(),
        })
        .await
        .expect("create runs");
    assert_eq!(payload, ProcessingPayload::None);

    let repository =
        DataRepository::new(Box::new(FilesystemBackend::new(dir.path().to_path_buf())));
    let (challenge_id, player_id) = verify_creation(&client, uuid, &repository).await;

    let payload = pipeline
        .process(ProcessingRequest {
            trigger: Trigger::Stage {
                seq: JournalSeq(2),
                stage: Stage::InfernoWave42,
                attempt: None,
            },
            challenge: info.clone(),
        })
        .await
        .expect("wave 42 runs");
    assert_eq!(
        payload,
        ProcessingPayload::Stage {
            status: StageStatus::Completed,
            ticks: 166,
        },
    );

    let custom_data = verify_wave_rows(&client, challenge_id, player_id).await;
    let stored_data = repository
        .load_challenge(uuid)
        .await
        .expect("challenge file");
    let events = repository
        .load_stage_events(uuid, Stage::InfernoWave42, None)
        .await
        .expect("stage events");
    golden::assert_stage_artifacts("inferno_wave_42", &custom_data, &stored_data, &events);

    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("challenge cleanup");
    client
        .execute("DELETE FROM players WHERE id = $1", &[&player_id])
        .await
        .expect("player cleanup");
}

/// Returns the challenge and player IDs.
async fn verify_creation(client: &Object, uuid: Uuid, repository: &DataRepository) -> (i32, i32) {
    let row = client
        .query_one("SELECT id FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("challenge row");
    let challenge_id: i32 = row.get(0);

    // Creation inserts a stats row, player, and an empty data file.
    let row = client
        .query_one(
            "SELECT meleer_digs, mager_revives, west_pillar_collapse_wave,
                    east_pillar_collapse_wave, south_pillar_collapse_wave
             FROM inferno_challenge_stats WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("stats row");
    assert_eq!(row.get::<_, Option<i32>>(0), Some(0));
    assert_eq!(row.get::<_, Option<i32>>(1), Some(0));
    assert_eq!(row.get::<_, Option<i32>>(2), None);
    assert_eq!(row.get::<_, Option<i32>>(3), None);
    assert_eq!(row.get::<_, Option<i32>>(4), None);

    let row = client
        .query_one(
            "SELECT id, total_recordings FROM players WHERE normalized_username = 'player1'",
            &[],
        )
        .await
        .expect("player row");
    let player_id: i32 = row.get(0);
    assert_eq!(row.get::<_, i32>(1), 1);

    assert_eq!(
        repository
            .load_challenge(uuid)
            .await
            .expect("challenge file"),
        ChallengeData {
            challenge_id: uuid.to_string(),
            stage_data: Some(challenge_data::StageData::Inferno(
                challenge_data::Inferno { waves: Vec::new() }
            )),
        },
    );

    (challenge_id, player_id)
}

/// Checks every row the wave run writes, returning its stored custom data.
async fn verify_wave_rows(client: &Object, challenge_id: i32, player_id: i32) -> serde_json::Value {
    let row = client
        .query_one(
            "SELECT type, mode, scale, stage, status, challenge_ticks, total_deaths, start_time
             FROM challenges WHERE id = $1",
            &[&challenge_id],
        )
        .await
        .expect("challenge row");
    assert_eq!(row.get::<_, i16>(0), ChallengeType::Inferno as i16);
    assert_eq!(row.get::<_, i16>(1), ChallengeMode::NoMode as i16);
    assert_eq!(row.get::<_, i16>(2), 1);
    assert_eq!(row.get::<_, i16>(3), Stage::InfernoWave42 as i16);
    assert_eq!(row.get::<_, i16>(4), ChallengeStatus::InProgress as i16);
    assert_eq!(row.get::<_, i32>(5), 4077);
    assert_eq!(row.get::<_, i32>(6), 0);
    assert_eq!(
        row.get::<_, std::time::SystemTime>(7),
        UNIX_EPOCH + Duration::from_millis(CREATED_UNIX_MS),
    );

    let row = client
        .query_one(
            "SELECT username, orb, primary_gear, stage_deaths FROM challenge_players
             WHERE challenge_id = $1 AND player_id = $2",
            &[&challenge_id, &player_id],
        )
        .await
        .expect("membership row");
    assert_eq!(row.get::<_, &str>(0), "player1");
    assert_eq!(row.get::<_, i16>(1), 0);
    assert_eq!(row.get::<_, i16>(2), PrimaryMeleeGear::Bandos as i16);
    assert_eq!(row.get::<_, Vec<i16>>(3), Vec::<i16>::new());

    let row = client
        .query_one(
            "SELECT meleer_digs, mager_revives, west_pillar_collapse_wave,
                    east_pillar_collapse_wave, south_pillar_collapse_wave
             FROM inferno_challenge_stats WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("stats row");
    assert_eq!(row.get::<_, Option<i32>>(0), Some(1));
    assert_eq!(row.get::<_, Option<i32>>(1), Some(1));
    assert_eq!(row.get::<_, Option<i32>>(2), None);
    assert_eq!(row.get::<_, Option<i32>>(3), None);
    assert_eq!(row.get::<_, Option<i32>>(4), None);

    let splits = client
        .query(
            "SELECT id, type, scale, ticks, accurate FROM challenge_splits
             WHERE challenge_id = $1 ORDER BY type",
            &[&challenge_id],
        )
        .await
        .expect("split rows");
    assert_eq!(splits.len(), 2);
    let expected = [
        (SplitType::InfernoWave42Start, 3911),
        (SplitType::InfernoWave42Time, 166),
    ];
    for (row, (split, ticks)) in splits.iter().zip(expected) {
        assert_eq!(row.get::<_, i16>(1), split as i16, "{split:?}");
        assert_eq!(row.get::<_, i16>(2), 1, "{split:?}");
        assert_eq!(row.get::<_, i32>(3), ticks, "{split:?}");
        assert!(!row.get::<_, bool>(4), "{split:?}");
    }

    let pbs = client
        .query(
            "SELECT 1 FROM personal_best_history WHERE player_id = $1",
            &[&player_id],
        )
        .await
        .expect("pb rows");
    assert!(pbs.is_empty());

    let row = client
        .query_one(
            "SELECT processed_seq, outcome_status, outcome_ticks, custom_data
             FROM challenge_processing_state WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("processing state");
    assert_eq!(row.get::<_, i64>(0), 2);
    assert_eq!(
        row.get::<_, Option<i16>>(1),
        Some(StageStatus::Completed as i16),
    );
    assert_eq!(row.get::<_, Option<i32>>(2), Some(166));
    row.get::<_, Option<serde_json::Value>>(3)
        .expect("custom data present")
}

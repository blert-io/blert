//! Runs real recorded Colosseum waves through the processor, verifying results.

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

/// Properties of the test challenge, fixed so runs are deterministic.
const CREATED_UNIX_MS: u64 = 1_786_716_274_057;
const UUID: &str = "3f9b2a71-88d4-4c5e-9c0f-5b1de60a2f13";

#[tokio::test]
#[expect(clippy::too_many_lines)]
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

    prepare_fixture(
        uuid,
        Stage::ColosseumWave1,
        &load_fixture("colosseum_wave_1"),
    )
    .await;
    prepare_fixture(
        uuid,
        Stage::ColosseumWave2,
        &load_fixture("colosseum_wave_2"),
    )
    .await;

    let dir = tempfile::tempdir().expect("tempdir");
    let pipeline = Pipeline::new(
        Arc::new(db),
        Arc::new(redis),
        DataRepository::new(Box::new(FilesystemBackend::new(dir.path().to_path_buf()))),
        Arc::new(PriceResolver::new(None)),
        ProcessorConfig::default(),
    );

    let mut info = ChallengeInfo {
        uuid,
        session_uuid: Uuid::new_v4(),
        challenge_type: ChallengeType::Colosseum,
        mode: ChallengeMode::NoMode,
        party: vec!["player1".to_string()],
        party_changed: false,
        stage: Stage::ColosseumWave1,
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
                stage: Stage::ColosseumWave1,
                attempt: None,
            },
            challenge: info.clone(),
        })
        .await
        .expect("wave 1 runs");
    assert_eq!(
        payload,
        ProcessingPayload::Stage {
            status: StageStatus::Completed,
            ticks: 23,
        },
    );

    let custom_data = verify_wave_1_rows(&client, challenge_id, player_id).await;
    verify_stage_artifacts(
        "colosseum_wave_1",
        uuid,
        Stage::ColosseumWave1,
        &repository,
        &custom_data,
    )
    .await;

    info.stage = Stage::ColosseumWave2;
    let payload = pipeline
        .process(ProcessingRequest {
            trigger: Trigger::StageStart {
                seq: JournalSeq(3),
                stage: Stage::ColosseumWave2,
            },
            challenge: info.clone(),
        })
        .await
        .expect("stage start runs");
    assert_eq!(payload, ProcessingPayload::None);

    let payload = pipeline
        .process(ProcessingRequest {
            trigger: Trigger::Stage {
                seq: JournalSeq(4),
                stage: Stage::ColosseumWave2,
                attempt: None,
            },
            challenge: info.clone(),
        })
        .await
        .expect("wave 2 runs");
    assert_eq!(
        payload,
        ProcessingPayload::Stage {
            status: StageStatus::Completed,
            ticks: 48,
        },
    );

    let custom_data = verify_wave_2_rows(&client, challenge_id, player_id).await;
    verify_stage_artifacts(
        "colosseum_wave_2",
        uuid,
        Stage::ColosseumWave2,
        &repository,
        &custom_data,
    )
    .await;

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
            "SELECT handicaps FROM colosseum_challenge_stats WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("stats row");
    assert_eq!(row.get::<_, Vec<i16>>(0), Vec::<i16>::new());

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
            stage_data: Some(challenge_data::StageData::Colosseum(
                challenge_data::Colosseum {
                    waves: Vec::new(),
                    all_handicaps: Vec::new(),
                },
            )),
        },
    );

    (challenge_id, player_id)
}

async fn verify_wave_1_rows(
    client: &Object,
    challenge_id: i32,
    player_id: i32,
) -> serde_json::Value {
    let row = client
        .query_one(
            "SELECT handicaps FROM colosseum_challenge_stats WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("stats row");
    assert_eq!(row.get::<_, Vec<i16>>(0), vec![4]);

    let splits = client
        .query(
            "SELECT id, type, scale, ticks, accurate FROM challenge_splits
             WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("split rows");
    assert_eq!(splits.len(), 1);
    let split_id: i32 = splits[0].get(0);
    assert_eq!(splits[0].get::<_, i16>(1), SplitType::ColosseumWave1 as i16);
    assert_eq!(splits[0].get::<_, i16>(2), 1);
    assert_eq!(splits[0].get::<_, i32>(3), 23);
    assert!(splits[0].get::<_, bool>(4));

    let pbs = client
        .query(
            "SELECT challenge_split_id FROM personal_best_history WHERE player_id = $1",
            &[&player_id],
        )
        .await
        .expect("pb rows");
    assert_eq!(pbs.len(), 1);
    assert_eq!(pbs[0].get::<_, i32>(0), split_id);

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
    assert_eq!(row.get::<_, Option<i32>>(2), Some(23));
    row.get::<_, Option<serde_json::Value>>(3)
        .expect("custom data present")
}

async fn verify_wave_2_rows(
    client: &Object,
    challenge_id: i32,
    player_id: i32,
) -> serde_json::Value {
    let row = client
        .query_one(
            "SELECT type, mode, scale, stage, status, challenge_ticks, total_deaths, start_time
             FROM challenges WHERE id = $1",
            &[&challenge_id],
        )
        .await
        .expect("challenge row");
    assert_eq!(row.get::<_, i16>(0), ChallengeType::Colosseum as i16);
    assert_eq!(row.get::<_, i16>(1), ChallengeMode::NoMode as i16);
    assert_eq!(row.get::<_, i16>(2), 1);
    assert_eq!(row.get::<_, i16>(3), Stage::ColosseumWave2 as i16);
    assert_eq!(row.get::<_, i16>(4), ChallengeStatus::InProgress as i16);
    assert_eq!(row.get::<_, i32>(5), 71);
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
    assert_eq!(
        row.get::<_, i16>(2),
        PrimaryMeleeGear::RadiantOathplate as i16
    );
    assert_eq!(row.get::<_, Vec<i16>>(3), Vec::<i16>::new());

    let row = client
        .query_one(
            "SELECT handicaps FROM colosseum_challenge_stats WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("stats row");
    assert_eq!(row.get::<_, Vec<i16>>(0), vec![4, 4]);

    let splits = client
        .query(
            "SELECT id, type, scale, ticks, accurate FROM challenge_splits
             WHERE challenge_id = $1 ORDER BY type",
            &[&challenge_id],
        )
        .await
        .expect("split rows");
    assert_eq!(splits.len(), 3);
    let expected = [
        (SplitType::ColosseumWave1, 23),
        (SplitType::ColosseumWave2, 48),
        (SplitType::ColosseumWave3Start, 71),
    ];
    for (row, (split, ticks)) in splits.iter().zip(expected) {
        assert_eq!(row.get::<_, i16>(1), split as i16, "{split:?}");
        assert_eq!(row.get::<_, i16>(2), 1, "{split:?}");
        assert_eq!(row.get::<_, i32>(3), ticks, "{split:?}");
        assert!(row.get::<_, bool>(4), "{split:?}");
    }

    let pbs = client
        .query(
            "SELECT DISTINCT challenge_split_id FROM personal_best_history
             WHERE player_id = $1",
            &[&player_id],
        )
        .await
        .expect("pb rows");
    assert_eq!(pbs.len(), 3); // wave 1, wave 2, wave 3 entry

    let row = client
        .query_one(
            "SELECT processed_seq, outcome_status, outcome_ticks, custom_data
             FROM challenge_processing_state WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("processing state");
    assert_eq!(row.get::<_, i64>(0), 4);
    assert_eq!(
        row.get::<_, Option<i16>>(1),
        Some(StageStatus::Completed as i16),
    );
    assert_eq!(row.get::<_, Option<i32>>(2), Some(48));
    row.get::<_, Option<serde_json::Value>>(3)
        .expect("custom data present")
}

async fn verify_stage_artifacts(
    name: &str,
    uuid: Uuid,
    stage: Stage,
    repository: &DataRepository,
    custom_data: &serde_json::Value,
) {
    let stored_data = repository
        .load_challenge(uuid)
        .await
        .expect("challenge file");
    let events = repository
        .load_stage_events(uuid, stage, None)
        .await
        .expect("stage events");
    golden::assert_stage_artifacts(name, custom_data, &stored_data, &events);
}

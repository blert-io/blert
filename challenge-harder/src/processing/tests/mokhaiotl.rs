//! Runs a real recorded delve 8 stage through the processor, verifying results.

use std::collections::BTreeMap;
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
use crate::processing::effects::EventKind;
use crate::processing::split::SplitType;
use crate::processing::{Pipeline, ProcessingRequest, ProcessorConfig, StageProcessor, db};
use crate::proto::{ChallengeData, challenge_data, event};
use crate::redis;
use crate::repository::{DataRepository, FilesystemBackend};

/// Properties of the test challenge, fixed so runs are deterministic.
const CREATED_UNIX_MS: u64 = 1_782_864_000_000;
const UUID: &str = "a8cb035f-410a-45de-a4d3-2b0a5d8b464d";

#[tokio::test]
#[expect(clippy::too_many_lines)]
async fn delve_test() {
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
    client
        .execute(
            "DELETE FROM effect_events WHERE key LIKE $1",
            &[&format!("{uuid}%")],
        )
        .await
        .unwrap();

    prepare_fixture(
        uuid,
        Stage::MokhaiotlDelve8,
        &load_fixture("mokhaiotl_delve_8"),
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

    let info = ChallengeInfo {
        uuid,
        session_uuid: Uuid::new_v4(),
        challenge_type: ChallengeType::Mokhaiotl,
        mode: ChallengeMode::NoMode,
        party: vec!["player1".to_string()],
        party_changed: false,
        stage: Stage::MokhaiotlDelve8,
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
                stage: Stage::MokhaiotlDelve8,
                attempt: None,
            },
            challenge: info.clone(),
        })
        .await
        .expect("stage runs");
    assert_eq!(
        payload,
        ProcessingPayload::Stage {
            status: StageStatus::Completed,
            ticks: 192,
        },
    );

    let custom_data = verify_stage_rows(&client, challenge_id, player_id).await;
    verify_stage_artifacts(uuid, &repository, &custom_data).await;

    let events = client
        .query(
            "SELECT kind, key FROM effect_events WHERE key LIKE $1",
            &[&format!("{uuid}%")],
        )
        .await
        .expect("outbox query");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].get::<_, i16>(0), EventKind::StageFinished as i16);
    assert_eq!(
        events[0].get::<_, String>(1),
        format!("{uuid}:{}", Stage::MokhaiotlDelve8 as i32),
    );

    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("challenge cleanup");
    client
        .execute("DELETE FROM players WHERE id = $1", &[&player_id])
        .await
        .expect("player cleanup");
}

/// Checks everything the create run writes, returning the challenge and
/// player IDs it assigned.
async fn verify_creation(client: &Object, uuid: Uuid, repository: &DataRepository) -> (i32, i32) {
    let row = client
        .query_one("SELECT id FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("challenge row");
    let challenge_id: i32 = row.get(0);

    // Creation writes the stats row, the player, and an empty data file.
    let row = client
        .query_one(
            "SELECT delve, larvae_leaked, max_completed_delve
             FROM mokhaiotl_challenge_stats WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("stats row");
    assert_eq!(row.get::<_, i32>(0), 8);
    assert_eq!(row.get::<_, Option<i32>>(1), Some(0));
    assert_eq!(row.get::<_, i32>(2), 0);

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
            stage_data: Some(challenge_data::StageData::Mokhaiotl(
                challenge_data::Mokhaiotl { delves: Vec::new() },
            )),
        },
    );

    (challenge_id, player_id)
}

/// Checks every database row the stage run writes, returning the stored
/// custom data.
#[expect(clippy::too_many_lines)]
async fn verify_stage_rows(
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
    assert_eq!(row.get::<_, i16>(0), ChallengeType::Mokhaiotl as i16);
    assert_eq!(row.get::<_, i16>(1), ChallengeMode::NoMode as i16);
    assert_eq!(row.get::<_, i16>(2), 1);
    assert_eq!(row.get::<_, i16>(3), Stage::MokhaiotlDelve8 as i16);
    assert_eq!(row.get::<_, i16>(4), ChallengeStatus::InProgress as i16);
    assert_eq!(row.get::<_, i32>(5), 192);
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
    assert_eq!(row.get::<_, i16>(2), PrimaryMeleeGear::Unknown as i16);
    assert_eq!(row.get::<_, Vec<i16>>(3), Vec::<i16>::new());

    // The stage completed delve 8 with three leaked larvae.
    let row = client
        .query_one(
            "SELECT delve, larvae_leaked, max_completed_delve
             FROM mokhaiotl_challenge_stats WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("stats row");
    assert_eq!(row.get::<_, i32>(0), 8);
    assert_eq!(row.get::<_, Option<i32>>(1), Some(3));
    assert_eq!(row.get::<_, i32>(2), 8);

    // The stage is fully accurate, so all its splits are.
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
    assert_eq!(
        splits[0].get::<_, i16>(1),
        SplitType::MokhaiotlDelve8 as i16
    );
    assert_eq!(splits[0].get::<_, i16>(2), 1);
    assert_eq!(splits[0].get::<_, i32>(3), 192);
    assert!(splits[0].get::<_, bool>(4));

    // The player receives PBs.
    let pbs = client
        .query(
            "SELECT challenge_split_id FROM personal_best_history WHERE player_id = $1",
            &[&player_id],
        )
        .await
        .expect("pb rows");
    assert_eq!(pbs.len(), 1);
    assert_eq!(pbs[0].get::<_, i32>(0), split_id);

    // Stats applied.
    let stats = client
        .query(
            "SELECT mokhaiotl_total_delves, mokhaiotl_delves_completed,
                    mokhaiotl_deep_delves_completed
             FROM player_stats WHERE player_id = $1",
            &[&player_id],
        )
        .await
        .expect("player stats");
    assert_eq!(stats.len(), 1);
    assert_eq!(stats[0].get::<_, i32>(0), 1);
    assert_eq!(stats[0].get::<_, i32>(1), 1);
    assert_eq!(stats[0].get::<_, i32>(2), 1);

    // All queryable events are written.
    let rows = client
        .query(
            "SELECT event_type, count(*) FROM queryable_events
             WHERE challenge_id = $1 GROUP BY event_type",
            &[&challenge_id],
        )
        .await
        .expect("queryable counts");
    let counts: BTreeMap<i16, i64> = rows.iter().map(|row| (row.get(0), row.get(1))).collect();
    assert_eq!(
        counts,
        BTreeMap::from([
            (event::Type::PlayerAttack as i16, 32),
            (event::Type::PlayerSpell as i16, 3),
            (event::Type::NpcSpawn as i16, 38),
            (event::Type::NpcDeath as i16, 37),
            (event::Type::NpcAttack as i16, 27),
        ]),
    );

    // The processing cursor advanced, with the delve appended to custom data.
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
    assert_eq!(row.get::<_, Option<i32>>(2), Some(192));
    row.get::<_, Option<serde_json::Value>>(3)
        .expect("custom data present")
}

async fn verify_stage_artifacts(
    uuid: Uuid,
    repository: &DataRepository,
    custom_data: &serde_json::Value,
) {
    let stored_data = repository
        .load_challenge(uuid)
        .await
        .expect("challenge file");
    let events = repository
        .load_stage_events(uuid, Stage::MokhaiotlDelve8, None)
        .await
        .expect("delve 8 events");
    golden::assert_stage_artifacts("mokhaiotl_delve_8", custom_data, &stored_data, &events);
}

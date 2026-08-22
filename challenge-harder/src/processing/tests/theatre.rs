//! Runs real recorded Theatre rooms through the processor, verifying results.
#![allow(clippy::too_many_lines)]

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use deadpool_postgres::Object;

use super::golden;
use super::{load_fixture, prepare_fixture};
use crate::item;
use crate::lifecycle::core::state::Trigger;
use crate::lifecycle::core::types::{
    ChallengeInfo, ChallengeMode, ChallengeStatus, ChallengeType, JournalSeq, PrimaryMeleeGear,
    ProcessingPayload, Stage, StageStatus, Uuid,
};
use crate::price::PriceResolver;
use crate::processing::split::SplitType;
use crate::processing::{Pipeline, ProcessingRequest, ProcessorConfig, StageProcessor, db};
use crate::proto::{ChallengeData, challenge_data, event};
use crate::redis;
use crate::repository::{DataRepository, FilesystemBackend};

const CREATED_UNIX_MS: u64 = 1_787_050_224_318;
const PARTY: [&str; 5] = ["player1", "player2", "player3", "player4", "player5"];

const BLACK_CHINCHOMPA_PRICE: u64 = 3_067;

/// Returns the challenge ID and the party's player IDs in orb order.
async fn verify_creation(
    client: &Object,
    uuid: Uuid,
    repository: &DataRepository,
    scale: usize,
) -> (i32, Vec<i32>) {
    let row = client
        .query_one("SELECT id FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("challenge row");
    let challenge_id: i32 = row.get(0);

    // Creation inserts a stats row, the players, and an empty data file.
    client
        .query_one(
            "SELECT id FROM tob_challenge_stats WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("stats row");

    let rows = client
        .query(
            "SELECT p.id, p.total_recordings
             FROM challenge_players cp JOIN players p ON p.id = cp.player_id
             WHERE cp.challenge_id = $1 ORDER BY cp.orb",
            &[&challenge_id],
        )
        .await
        .expect("player rows");
    assert_eq!(rows.len(), scale);
    let player_ids: Vec<i32> = rows.iter().map(|row| row.get(0)).collect();
    for row in &rows {
        assert_eq!(row.get::<_, i32>(1), 1);
    }

    assert_eq!(
        repository
            .load_challenge(uuid)
            .await
            .expect("challenge file"),
        ChallengeData {
            challenge_id: uuid.to_string(),
            stage_data: Some(challenge_data::StageData::TobRooms(
                challenge_data::TobRooms::default()
            )),
        },
    );

    (challenge_id, player_ids)
}

const MAIDEN_UUID: &str = "5b1e6f3a-8d27-4c9e-a1f0-3e7b9c2d4a61";

#[tokio::test]
async fn maiden_test() {
    let Some(db) = db::test_database().await else {
        return;
    };
    let Some(redis) = redis::tests::test_store().await else {
        return;
    };
    let _fixture_lock = super::FIXTURE_TESTS.lock().await;
    let client = db.checkout().await.expect("client");

    let uuid: Uuid = MAIDEN_UUID.parse().expect("uuid is valid");
    let party: Vec<String> = PARTY.iter().map(ToString::to_string).collect();

    // Clean the DB from previous runs.
    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .unwrap();
    client
        .execute(
            "DELETE FROM players WHERE normalized_username = ANY($1)",
            &[&party],
        )
        .await
        .unwrap();

    prepare_fixture(uuid, Stage::TobMaiden, &load_fixture("tob_maiden")).await;

    let price_resolver = Arc::new(PriceResolver::new(None));
    price_resolver.populate([(item::id::BLACK_CHINCHOMPA, BLACK_CHINCHOMPA_PRICE)]);

    let dir = tempfile::tempdir().expect("tempdir");
    let pipeline = Pipeline::new(
        Arc::new(db),
        Arc::new(redis),
        DataRepository::new(Box::new(FilesystemBackend::new(dir.path().to_path_buf()))),
        price_resolver,
        ProcessorConfig::default(),
    );

    let info = ChallengeInfo {
        uuid,
        session_uuid: Uuid::new_v4(),
        challenge_type: ChallengeType::Tob,
        mode: ChallengeMode::TobHard,
        party,
        party_changed: false,
        stage: Stage::TobMaiden,
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
    let (challenge_id, player_ids) = verify_creation(&client, uuid, &repository, PARTY.len()).await;

    let payload = pipeline
        .process(ProcessingRequest {
            trigger: Trigger::Stage {
                seq: JournalSeq(2),
                stage: Stage::TobMaiden,
                attempt: None,
            },
            challenge: info.clone(),
        })
        .await
        .expect("maiden runs");
    assert_eq!(
        payload,
        ProcessingPayload::Stage {
            status: StageStatus::Completed,
            ticks: 151,
        },
    );

    let custom_data = verify_maiden_rows(&client, challenge_id, &player_ids).await;
    let stored_data = repository
        .load_challenge(uuid)
        .await
        .expect("challenge file");
    let events = repository
        .load_stage_events(uuid, Stage::TobMaiden, None)
        .await
        .expect("stage events");
    golden::assert_stage_artifacts("tob_maiden", &custom_data, &stored_data, &events);

    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("challenge cleanup");
    client
        .execute("DELETE FROM players WHERE id = ANY($1)", &[&player_ids])
        .await
        .expect("player cleanup");
}

/// Checks every row the Maiden test writes, returning its stored custom data.
async fn verify_maiden_rows(
    client: &Object,
    challenge_id: i32,
    player_ids: &[i32],
) -> serde_json::Value {
    let row = client
        .query_one(
            "SELECT type, mode, scale, stage, status, challenge_ticks, total_deaths, start_time
             FROM challenges WHERE id = $1",
            &[&challenge_id],
        )
        .await
        .expect("challenge row");
    assert_eq!(row.get::<_, i16>(0), ChallengeType::Tob as i16);
    assert_eq!(row.get::<_, i16>(1), ChallengeMode::TobHard as i16);
    assert_eq!(row.get::<_, i16>(2), 5);
    assert_eq!(row.get::<_, i16>(3), Stage::TobMaiden as i16);
    assert_eq!(row.get::<_, i16>(4), ChallengeStatus::InProgress as i16);
    assert_eq!(row.get::<_, i32>(5), 151);
    assert_eq!(row.get::<_, i32>(6), 0);
    assert_eq!(
        row.get::<_, std::time::SystemTime>(7),
        UNIX_EPOCH + Duration::from_millis(CREATED_UNIX_MS),
    );

    let rows = client
        .query(
            "SELECT username, orb, primary_gear, stage_deaths FROM challenge_players
             WHERE challenge_id = $1 ORDER BY orb",
            &[&challenge_id],
        )
        .await
        .expect("membership rows");
    let expected_gear = [
        PrimaryMeleeGear::Unknown,
        PrimaryMeleeGear::RadiantOathplate,
        PrimaryMeleeGear::Oathplate,
        PrimaryMeleeGear::Unknown,
        PrimaryMeleeGear::RadiantOathplate,
    ];
    assert_eq!(rows.len(), PARTY.len());
    for (orb, (row, gear)) in rows.iter().zip(expected_gear).enumerate() {
        assert_eq!(row.get::<_, &str>(0), PARTY[orb]);
        assert_eq!(row.get::<_, i16>(1), i16::try_from(orb).unwrap());
        assert_eq!(row.get::<_, i16>(2), gear as i16, "{}", PARTY[orb]);
        assert_eq!(row.get::<_, Vec<i16>>(3), Vec::<i16>::new());
    }

    let row = client
        .query_one(
            "SELECT maiden_deaths, maiden_full_leaks, maiden_scuffed_spawns
             FROM tob_challenge_stats WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("stats row");
    assert_eq!(row.get::<_, Option<i32>>(0), Some(0));
    assert_eq!(row.get::<_, Option<i32>>(1), Some(0));
    assert_eq!(row.get::<_, Option<bool>>(2), Some(true));

    let splits = client
        .query(
            "SELECT id, type, scale, ticks, accurate FROM challenge_splits
             WHERE challenge_id = $1 ORDER BY type",
            &[&challenge_id],
        )
        .await
        .expect("split rows");
    let expected = [
        (SplitType::TobHmMaiden, 151),
        (SplitType::TobHmMaiden70s, 32),
        (SplitType::TobHmMaiden50s, 54),
        (SplitType::TobHmMaiden30s, 107),
        (SplitType::TobHmMaiden70s50s, 22),
        (SplitType::TobHmMaiden50s30s, 53),
        (SplitType::TobHmMaiden30sEnd, 44),
    ];
    assert_eq!(splits.len(), expected.len());
    for (row, (split, ticks)) in splits.iter().zip(expected) {
        assert_eq!(row.get::<_, i16>(1), split as i16, "{split:?}");
        assert_eq!(row.get::<_, i16>(2), 5, "{split:?}");
        assert_eq!(row.get::<_, i32>(3), ticks, "{split:?}");
        assert!(row.get::<_, bool>(4), "{split:?}");
    }
    let split_ids: Vec<i32> = splits.iter().map(|row| row.get(0)).collect();

    for &player_id in player_ids {
        let pbs = client
            .query(
                "SELECT challenge_split_id FROM personal_best_history
                 WHERE player_id = $1 ORDER BY challenge_split_id",
                &[&player_id],
            )
            .await
            .expect("pb rows");
        let pb_split_ids: Vec<i32> = pbs.iter().map(|row| row.get(0)).collect();
        assert_eq!(pb_split_ids, split_ids, "player {player_id}");
    }

    // player3 throws chins with two from the wrong distance.
    let stats = client
        .query(
            "SELECT player_id, chins_thrown_total, chins_thrown_black, chins_thrown_red,
                    chins_thrown_grey, chins_thrown_maiden, chins_thrown_nylocas,
                    chins_thrown_value, chins_thrown_incorrectly_maiden, deaths_total
             FROM player_stats WHERE player_id = ANY($1)",
            &[&player_ids],
        )
        .await
        .expect("player stats");
    assert_eq!(stats.len(), 1);
    assert_eq!(stats[0].get::<_, i32>(0), player_ids[2]);
    assert_eq!(stats[0].get::<_, i32>(1), 7);
    assert_eq!(stats[0].get::<_, i32>(2), 7);
    assert_eq!(stats[0].get::<_, i32>(3), 0);
    assert_eq!(stats[0].get::<_, i32>(4), 0);
    assert_eq!(stats[0].get::<_, i32>(5), 7);
    assert_eq!(stats[0].get::<_, i32>(6), 0);
    assert_eq!(
        stats[0].get::<_, i32>(7),
        7 * i32::try_from(BLACK_CHINCHOMPA_PRICE).unwrap(),
    );
    assert_eq!(stats[0].get::<_, i32>(8), 2);
    assert_eq!(stats[0].get::<_, i32>(9), 0);

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
            (event::Type::PlayerAttack as i16, 133),
            (event::Type::NpcSpawn as i16, 34),
            (event::Type::NpcDeath as i16, 34),
            (event::Type::NpcAttack as i16, 15),
            (event::Type::PlayerSpell as i16, 5),
            (event::Type::TobMaidenCrabLeak as i16, 3),
        ]),
    );

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
    assert_eq!(row.get::<_, Option<i32>>(2), Some(151));
    row.get::<_, Option<serde_json::Value>>(3)
        .expect("custom data present")
}

const BLOAT_UUID: &str = "54b8da8d-b6b4-4d9d-bb9b-d6c60b89448a";

#[tokio::test]
async fn bloat_test() {
    let Some(db) = db::test_database().await else {
        return;
    };
    let Some(redis) = redis::tests::test_store().await else {
        return;
    };
    let _fixture_lock = super::FIXTURE_TESTS.lock().await;
    let client = db.checkout().await.expect("client");

    let uuid: Uuid = BLOAT_UUID.parse().expect("uuid is valid");
    let party: Vec<String> = PARTY.iter().map(ToString::to_string).collect();

    // Clean the DB from previous runs.
    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .unwrap();
    client
        .execute(
            "DELETE FROM players WHERE normalized_username = ANY($1)",
            &[&party],
        )
        .await
        .unwrap();

    prepare_fixture(uuid, Stage::TobBloat, &load_fixture("tob_bloat")).await;

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
        challenge_type: ChallengeType::Tob,
        mode: ChallengeMode::TobHard,
        party,
        party_changed: false,
        stage: Stage::TobBloat,
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
    let (challenge_id, player_ids) = verify_creation(&client, uuid, &repository, PARTY.len()).await;

    let payload = pipeline
        .process(ProcessingRequest {
            trigger: Trigger::Stage {
                seq: JournalSeq(2),
                stage: Stage::TobBloat,
                attempt: None,
            },
            challenge: info.clone(),
        })
        .await
        .expect("bloat runs");
    assert_eq!(
        payload,
        ProcessingPayload::Stage {
            status: StageStatus::Completed,
            ticks: 213,
        },
    );

    let custom_data = verify_bloat_rows(&client, challenge_id, &player_ids).await;
    let stored_data = repository
        .load_challenge(uuid)
        .await
        .expect("challenge file");
    let events = repository
        .load_stage_events(uuid, Stage::TobBloat, None)
        .await
        .expect("stage events");
    golden::assert_stage_artifacts("tob_bloat", &custom_data, &stored_data, &events);

    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("challenge cleanup");
    client
        .execute("DELETE FROM players WHERE id = ANY($1)", &[&player_ids])
        .await
        .expect("player cleanup");
}

/// Checks every row the Bloat room writes, returning its stored custom data.
async fn verify_bloat_rows(
    client: &Object,
    challenge_id: i32,
    player_ids: &[i32],
) -> serde_json::Value {
    let row = client
        .query_one(
            "SELECT type, mode, scale, stage, status, challenge_ticks, total_deaths, start_time
             FROM challenges WHERE id = $1",
            &[&challenge_id],
        )
        .await
        .expect("challenge row");
    assert_eq!(row.get::<_, i16>(0), ChallengeType::Tob as i16);
    assert_eq!(row.get::<_, i16>(1), ChallengeMode::TobHard as i16);
    assert_eq!(row.get::<_, i16>(2), 5);
    assert_eq!(row.get::<_, i16>(3), Stage::TobBloat as i16);
    assert_eq!(row.get::<_, i16>(4), ChallengeStatus::InProgress as i16);
    assert_eq!(row.get::<_, i32>(5), 213);
    assert_eq!(row.get::<_, i32>(6), 1);
    assert_eq!(
        row.get::<_, std::time::SystemTime>(7),
        UNIX_EPOCH + Duration::from_millis(CREATED_UNIX_MS),
    );

    let rows = client
        .query(
            "SELECT username, orb, primary_gear, stage_deaths FROM challenge_players
             WHERE challenge_id = $1 ORDER BY orb",
            &[&challenge_id],
        )
        .await
        .expect("membership rows");
    let expected_gear = [
        PrimaryMeleeGear::RadiantOathplate,
        PrimaryMeleeGear::RadiantOathplate,
        PrimaryMeleeGear::Oathplate,
        PrimaryMeleeGear::Oathplate,
        PrimaryMeleeGear::Bandos,
    ];
    assert_eq!(rows.len(), PARTY.len());
    for (orb, (row, gear)) in rows.iter().zip(expected_gear).enumerate() {
        assert_eq!(row.get::<_, &str>(0), PARTY[orb]);
        assert_eq!(row.get::<_, i16>(1), i16::try_from(orb).unwrap());
        assert_eq!(row.get::<_, i16>(2), gear as i16, "{}", PARTY[orb]);
        let deaths = if orb == 4 {
            vec![Stage::TobBloat as i16]
        } else {
            Vec::new()
        };
        assert_eq!(row.get::<_, Vec<i16>>(3), deaths, "{}", PARTY[orb]);
    }

    let row = client
        .query_one(
            "SELECT bloat_deaths, bloat_down_count, bloat_first_down_hp_percent
             FROM tob_challenge_stats WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("stats row");
    assert_eq!(row.get::<_, Option<i32>>(0), Some(1));
    assert_eq!(row.get::<_, Option<i16>>(1), Some(3));
    let first_down = row.get::<_, Option<f32>>(2).expect("first down percent");
    assert!(
        (first_down - 2380.0 / 2400.0 * 100.0).abs() < 1e-3,
        "{first_down}"
    );

    let splits = client
        .query(
            "SELECT id, type, scale, ticks, accurate FROM challenge_splits
             WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("split rows");
    assert_eq!(splits.len(), 1);
    assert_eq!(splits[0].get::<_, i16>(1), SplitType::TobHmBloat as i16);
    assert_eq!(splits[0].get::<_, i16>(2), 5);
    assert_eq!(splits[0].get::<_, i32>(3), 213);
    assert!(splits[0].get::<_, bool>(4));
    let split_id: i32 = splits[0].get(0);

    for &player_id in player_ids {
        let pbs = client
            .query(
                "SELECT challenge_split_id FROM personal_best_history WHERE player_id = $1",
                &[&player_id],
            )
            .await
            .expect("pb rows");
        assert_eq!(pbs.len(), 1, "player {player_id}");
        assert_eq!(pbs[0].get::<_, i32>(0), split_id, "player {player_id}");
    }

    let downs = client
        .query(
            "SELECT down_number, down_tick, walk_ticks, accurate FROM bloat_downs
             WHERE challenge_id = $1 ORDER BY down_number",
            &[&i64::from(challenge_id)],
        )
        .await
        .expect("down rows");
    let downs: Vec<(i16, i32, i16, bool)> = downs
        .iter()
        .map(|row| (row.get(0), row.get(1), row.get(2), row.get(3)))
        .collect();
    assert_eq!(
        downs,
        vec![(1, 42, 42, true), (2, 113, 37, true), (3, 193, 46, true)],
    );

    let hands = client
        .query(
            "SELECT wave_number, count(*) FROM bloat_hands
             WHERE challenge_id = $1 GROUP BY wave_number ORDER BY wave_number",
            &[&i64::from(challenge_id)],
        )
        .await
        .expect("hand waves");
    let by_wave: Vec<(i16, i64)> = hands.iter().map(|row| (row.get(0), row.get(1))).collect();
    let expected_counts = [
        16, 16, 16, 16, 16, 16, 16, 15, 16, 14, 15, 16, 16, 16, 16, 15, 16, 16, 16, 16, 16, 15, 16,
        16, 16, 16, 15, 15, 16, 16, 15, 16, 14, 16, 16, 16, 16, 15, 16, 16, 14, 15,
    ];
    assert_eq!(
        by_wave,
        expected_counts
            .iter()
            .enumerate()
            .map(|(index, &count)| (i16::try_from(index + 1).unwrap(), count))
            .collect::<Vec<_>>(),
    );

    // player5 BGS smacks and dies.
    let stats = client
        .query(
            "SELECT player_id, deaths_total, deaths_bloat, bgs_smacks, chally_pokes,
                    hammer_bops, elder_maul_smacks, ralos_autos
             FROM player_stats WHERE player_id = ANY($1)",
            &[&player_ids],
        )
        .await
        .expect("player stats");
    assert_eq!(stats.len(), 1);
    assert_eq!(stats[0].get::<_, i32>(0), player_ids[4]);
    assert_eq!(stats[0].get::<_, i32>(1), 1);
    assert_eq!(stats[0].get::<_, i32>(2), 1);
    assert_eq!(stats[0].get::<_, i32>(3), 1);
    assert_eq!(stats[0].get::<_, i32>(4), 1);
    assert_eq!(stats[0].get::<_, i32>(5), 0);
    assert_eq!(stats[0].get::<_, i32>(6), 0);
    assert_eq!(stats[0].get::<_, i32>(7), 0);

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
            (event::Type::PlayerAttack as i16, 56),
            (event::Type::PlayerDeath as i16, 1),
            (event::Type::NpcSpawn as i16, 1),
            (event::Type::NpcDeath as i16, 1),
            (event::Type::NpcAttack as i16, 2),
            (event::Type::PlayerSpell as i16, 2),
            (event::Type::TobBloatDown as i16, 3),
        ]),
    );

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
    assert_eq!(row.get::<_, Option<i32>>(2), Some(213));
    row.get::<_, Option<serde_json::Value>>(3)
        .expect("custom data present")
}

const NYLOCAS_UUID: &str = "4a9f3e87-31fd-4777-9d87-c6fa12dbc669";

#[tokio::test]
async fn nylocas_test() {
    let Some(db) = db::test_database().await else {
        return;
    };
    let Some(redis) = redis::tests::test_store().await else {
        return;
    };
    let _fixture_lock = super::FIXTURE_TESTS.lock().await;
    let client = db.checkout().await.expect("client");

    let uuid: Uuid = NYLOCAS_UUID.parse().expect("uuid is valid");
    let party: Vec<String> = PARTY[..3].iter().map(ToString::to_string).collect();

    // Clean the DB from previous runs.
    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .unwrap();
    client
        .execute(
            "DELETE FROM players WHERE normalized_username = ANY($1)",
            &[&party],
        )
        .await
        .unwrap();

    prepare_fixture(uuid, Stage::TobNylocas, &load_fixture("tob_nylocas")).await;

    let price_resolver = Arc::new(PriceResolver::new(None));
    price_resolver.populate([(item::id::BLACK_CHINCHOMPA, BLACK_CHINCHOMPA_PRICE)]);

    let dir = tempfile::tempdir().expect("tempdir");
    let pipeline = Pipeline::new(
        Arc::new(db),
        Arc::new(redis),
        DataRepository::new(Box::new(FilesystemBackend::new(dir.path().to_path_buf()))),
        price_resolver,
        ProcessorConfig::default(),
    );

    let info = ChallengeInfo {
        uuid,
        session_uuid: Uuid::new_v4(),
        challenge_type: ChallengeType::Tob,
        mode: ChallengeMode::TobHard,
        party,
        party_changed: false,
        stage: Stage::TobNylocas,
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
    let (challenge_id, player_ids) = verify_creation(&client, uuid, &repository, 3).await;

    let payload = pipeline
        .process(ProcessingRequest {
            trigger: Trigger::Stage {
                seq: JournalSeq(2),
                stage: Stage::TobNylocas,
                attempt: None,
            },
            challenge: info.clone(),
        })
        .await
        .expect("nylocas runs");
    assert_eq!(
        payload,
        ProcessingPayload::Stage {
            status: StageStatus::Completed,
            ticks: 444,
        },
    );

    let custom_data = verify_nylocas_rows(&client, challenge_id, &player_ids).await;
    let stored_data = repository
        .load_challenge(uuid)
        .await
        .expect("challenge file");
    let events = repository
        .load_stage_events(uuid, Stage::TobNylocas, None)
        .await
        .expect("stage events");
    golden::assert_stage_artifacts("tob_nylocas", &custom_data, &stored_data, &events);

    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("challenge cleanup");
    client
        .execute("DELETE FROM players WHERE id = ANY($1)", &[&player_ids])
        .await
        .expect("player cleanup");
}

/// Checks every row the Nylocas room writes, returning its stored custom data.
async fn verify_nylocas_rows(
    client: &Object,
    challenge_id: i32,
    player_ids: &[i32],
) -> serde_json::Value {
    let row = client
        .query_one(
            "SELECT type, mode, scale, stage, status, challenge_ticks, total_deaths, start_time
             FROM challenges WHERE id = $1",
            &[&challenge_id],
        )
        .await
        .expect("challenge row");
    assert_eq!(row.get::<_, i16>(0), ChallengeType::Tob as i16);
    assert_eq!(row.get::<_, i16>(1), ChallengeMode::TobHard as i16);
    assert_eq!(row.get::<_, i16>(2), 3);
    assert_eq!(row.get::<_, i16>(3), Stage::TobNylocas as i16);
    assert_eq!(row.get::<_, i16>(4), ChallengeStatus::InProgress as i16);
    assert_eq!(row.get::<_, i32>(5), 444);
    assert_eq!(row.get::<_, i32>(6), 1);
    assert_eq!(
        row.get::<_, std::time::SystemTime>(7),
        UNIX_EPOCH + Duration::from_millis(CREATED_UNIX_MS),
    );

    let rows = client
        .query(
            "SELECT username, orb, primary_gear, stage_deaths FROM challenge_players
             WHERE challenge_id = $1 ORDER BY orb",
            &[&challenge_id],
        )
        .await
        .expect("membership rows");

    let expected_gear = [
        PrimaryMeleeGear::RadiantOathplate,
        PrimaryMeleeGear::RadiantOathplate,
        PrimaryMeleeGear::Oathplate,
    ];
    let expected_deaths = [
        Vec::<i16>::new(),
        Vec::<i16>::new(),
        vec![Stage::TobNylocas as i16],
    ];
    assert_eq!(rows.len(), 3);
    for (orb, ((row, gear), deaths)) in rows
        .iter()
        .zip(expected_gear)
        .zip(expected_deaths)
        .enumerate()
    {
        assert_eq!(row.get::<_, &str>(0), PARTY[orb]);
        assert_eq!(row.get::<_, i16>(1), i16::try_from(orb).unwrap());
        assert_eq!(row.get::<_, i16>(2), gear as i16, "{}", PARTY[orb]);
        assert_eq!(row.get::<_, Vec<i16>>(3), deaths, "{}", PARTY[orb]);
    }

    let row = client
        .query_one(
            "SELECT nylocas_deaths, nylocas_stalls, nylocas_pre_cap_stalls,
                    nylocas_post_cap_stalls, nylocas_mage_splits, nylocas_ranged_splits,
                    nylocas_melee_splits, nylocas_boss_mage, nylocas_boss_ranged,
                    nylocas_boss_melee
             FROM tob_challenge_stats WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("stats row");
    let mut stalls = vec![0i32; 31];
    stalls[10] = 1;
    stalls[20] = 1;
    stalls[26] = 1;
    stalls[27] = 3;
    assert_eq!(row.get::<_, Option<i32>>(0), Some(1));
    assert_eq!(row.get::<_, Option<Vec<i32>>>(1), Some(stalls));
    assert_eq!(row.get::<_, Option<i32>>(2), Some(1));
    assert_eq!(row.get::<_, Option<i32>>(3), Some(5));
    assert_eq!(row.get::<_, Option<i32>>(4), Some(22));
    assert_eq!(row.get::<_, Option<i32>>(5), Some(30));
    assert_eq!(row.get::<_, Option<i32>>(6), Some(34));
    assert_eq!(row.get::<_, Option<i32>>(7), Some(4));
    assert_eq!(row.get::<_, Option<i32>>(8), Some(4));
    assert_eq!(row.get::<_, Option<i32>>(9), Some(3));

    let splits = client
        .query(
            "SELECT id, type, scale, ticks, accurate FROM challenge_splits
             WHERE challenge_id = $1 ORDER BY type",
            &[&challenge_id],
        )
        .await
        .expect("split rows");
    let expected = [
        (SplitType::TobHmNyloRoom, 444),
        (SplitType::TobHmNyloCap, 164),
        (SplitType::TobHmNyloWaves, 280),
        (SplitType::TobHmNyloCleanup, 320),
        (SplitType::TobHmNyloBossSpawn, 336),
        (SplitType::TobHmNyloBoss, 108),
    ];
    assert_eq!(splits.len(), expected.len());
    for (row, (split, ticks)) in splits.iter().zip(expected) {
        assert_eq!(row.get::<_, i16>(1), split as i16, "{split:?}");
        assert_eq!(row.get::<_, i16>(2), 3, "{split:?}");
        assert_eq!(row.get::<_, i32>(3), ticks, "{split:?}");
        assert!(row.get::<_, bool>(4), "{split:?}");
    }
    let split_ids: Vec<i32> = splits.iter().map(|row| row.get(0)).collect();

    for &player_id in player_ids {
        let pbs = client
            .query(
                "SELECT challenge_split_id FROM personal_best_history
                 WHERE player_id = $1 ORDER BY challenge_split_id",
                &[&player_id],
            )
            .await
            .expect("pb rows");
        let pb_split_ids: Vec<i32> = pbs.iter().map(|row| row.get(0)).collect();
        assert_eq!(pb_split_ids, split_ids, "player {player_id}");
    }

    // player2 chins; player3 dies to the boss.
    let stats = client
        .query(
            "SELECT player_id, chins_thrown_total, chins_thrown_black, chins_thrown_maiden,
                    chins_thrown_nylocas, chins_thrown_value, chins_thrown_incorrectly_maiden,
                    chally_pokes, deaths_total
             FROM player_stats WHERE player_id = ANY($1) ORDER BY player_id",
            &[&player_ids],
        )
        .await
        .expect("player stats");
    assert_eq!(stats.len(), 2);
    assert_eq!(stats[0].get::<_, i32>(0), player_ids[1]);
    assert_eq!(stats[0].get::<_, i32>(1), 6);
    assert_eq!(stats[0].get::<_, i32>(2), 6);
    assert_eq!(stats[0].get::<_, i32>(3), 0);
    assert_eq!(stats[0].get::<_, i32>(4), 6);
    assert_eq!(
        stats[0].get::<_, i32>(5),
        6 * i32::try_from(BLACK_CHINCHOMPA_PRICE).unwrap(),
    );
    assert_eq!(stats[0].get::<_, i32>(6), 0);
    assert_eq!(stats[0].get::<_, i32>(7), 0);
    assert_eq!(stats[0].get::<_, i32>(8), 0);
    assert_eq!(stats[1].get::<_, i32>(0), player_ids[2]);
    assert_eq!(stats[1].get::<_, i32>(1), 0);
    assert_eq!(stats[1].get::<_, i32>(7), 0);
    assert_eq!(stats[1].get::<_, i32>(8), 1);

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
            (event::Type::PlayerAttack as i16, 302),
            (event::Type::NpcSpawn as i16, 213),
            (event::Type::NpcDeath as i16, 210),
            (event::Type::NpcAttack as i16, 32),
            (event::Type::PlayerSpell as i16, 2),
            (event::Type::PlayerDeath as i16, 1),
            (event::Type::TobNyloWaveStall as i16, 6),
        ]),
    );

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
    assert_eq!(row.get::<_, Option<i32>>(2), Some(444));
    row.get::<_, Option<serde_json::Value>>(3)
        .expect("custom data present")
}

const SOTETSEG_UUID: &str = "4c388ead-567d-4969-a0f7-5f61b8a7bbfb";

#[tokio::test]
async fn sotetseg_test() {
    let Some(db) = db::test_database().await else {
        return;
    };
    let Some(redis) = redis::tests::test_store().await else {
        return;
    };
    let _fixture_lock = super::FIXTURE_TESTS.lock().await;
    let client = db.checkout().await.expect("client");

    let uuid: Uuid = SOTETSEG_UUID.parse().expect("uuid is valid");
    let party: Vec<String> = PARTY[..3].iter().map(ToString::to_string).collect();

    // Clean the DB from previous runs.
    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .unwrap();
    client
        .execute(
            "DELETE FROM players WHERE normalized_username = ANY($1)",
            &[&party],
        )
        .await
        .unwrap();

    prepare_fixture(uuid, Stage::TobSotetseg, &load_fixture("tob_sotetseg")).await;

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
        challenge_type: ChallengeType::Tob,
        mode: ChallengeMode::TobRegular,
        party,
        party_changed: false,
        stage: Stage::TobSotetseg,
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
    let (challenge_id, player_ids) = verify_creation(&client, uuid, &repository, 3).await;

    let payload = pipeline
        .process(ProcessingRequest {
            trigger: Trigger::Stage {
                seq: JournalSeq(2),
                stage: Stage::TobSotetseg,
                attempt: None,
            },
            challenge: info.clone(),
        })
        .await
        .expect("sotetseg runs");
    assert_eq!(
        payload,
        ProcessingPayload::Stage {
            status: StageStatus::Completed,
            ticks: 207,
        },
    );

    let custom_data = verify_sotetseg_rows(&client, challenge_id, &player_ids).await;
    let stored_data = repository
        .load_challenge(uuid)
        .await
        .expect("challenge file");
    let events = repository
        .load_stage_events(uuid, Stage::TobSotetseg, None)
        .await
        .expect("stage events");
    golden::assert_stage_artifacts("tob_sotetseg", &custom_data, &stored_data, &events);

    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("challenge cleanup");
    client
        .execute("DELETE FROM players WHERE id = ANY($1)", &[&player_ids])
        .await
        .expect("player cleanup");
}

/// Checks every row the Sotetseg room writes, returning its stored custom data.
async fn verify_sotetseg_rows(
    client: &Object,
    challenge_id: i32,
    player_ids: &[i32],
) -> serde_json::Value {
    let row = client
        .query_one(
            "SELECT type, mode, scale, stage, status, challenge_ticks, total_deaths, start_time
             FROM challenges WHERE id = $1",
            &[&challenge_id],
        )
        .await
        .expect("challenge row");
    assert_eq!(row.get::<_, i16>(0), ChallengeType::Tob as i16);
    assert_eq!(row.get::<_, i16>(1), ChallengeMode::TobRegular as i16);
    assert_eq!(row.get::<_, i16>(2), 3);
    assert_eq!(row.get::<_, i16>(3), Stage::TobSotetseg as i16);
    assert_eq!(row.get::<_, i16>(4), ChallengeStatus::InProgress as i16);
    assert_eq!(row.get::<_, i32>(5), 207);
    assert_eq!(row.get::<_, i32>(6), 1);
    assert_eq!(
        row.get::<_, std::time::SystemTime>(7),
        UNIX_EPOCH + Duration::from_millis(CREATED_UNIX_MS),
    );

    // player3 dies during P3.
    let rows = client
        .query(
            "SELECT username, orb, primary_gear, stage_deaths FROM challenge_players
             WHERE challenge_id = $1 ORDER BY orb",
            &[&challenge_id],
        )
        .await
        .expect("membership rows");
    assert_eq!(rows.len(), 3);
    for (orb, row) in rows.iter().enumerate() {
        assert_eq!(row.get::<_, &str>(0), PARTY[orb]);
        assert_eq!(row.get::<_, i16>(1), i16::try_from(orb).unwrap());
        assert_eq!(
            row.get::<_, i16>(2),
            PrimaryMeleeGear::RadiantOathplate as i16,
            "{}",
            PARTY[orb]
        );
        let deaths = if orb == 2 {
            vec![Stage::TobSotetseg as i16]
        } else {
            Vec::new()
        };
        assert_eq!(row.get::<_, Vec<i16>>(3), deaths, "{}", PARTY[orb]);
    }

    let row = client
        .query_one(
            "SELECT sotetseg_deaths FROM tob_challenge_stats WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("stats row");
    assert_eq!(row.get::<_, Option<i32>>(0), Some(1));

    // Maze 1 procs at 42 and ends at 70, maze 2 procs at 123 and ends at 147.
    let splits = client
        .query(
            "SELECT id, type, scale, ticks, accurate FROM challenge_splits
             WHERE challenge_id = $1 ORDER BY type",
            &[&challenge_id],
        )
        .await
        .expect("split rows");
    let expected = [
        (SplitType::TobRegSotetseg, 207),
        (SplitType::TobRegSotetseg66, 42),
        (SplitType::TobRegSotetseg33, 123),
        (SplitType::TobRegSotetsegMaze1, 28),
        (SplitType::TobRegSotetsegMaze2, 24),
        (SplitType::TobRegSotetsegP2, 53),
        (SplitType::TobRegSotetsegP3, 60),
    ];
    assert_eq!(splits.len(), expected.len());
    for (row, (split, ticks)) in splits.iter().zip(expected) {
        assert_eq!(row.get::<_, i16>(1), split as i16, "{split:?}");
        assert_eq!(row.get::<_, i16>(2), 3, "{split:?}");
        assert_eq!(row.get::<_, i32>(3), ticks, "{split:?}");
        assert!(row.get::<_, bool>(4), "{split:?}");
    }
    let split_ids: Vec<i32> = splits.iter().map(|row| row.get(0)).collect();

    for &player_id in player_ids {
        let pbs = client
            .query(
                "SELECT challenge_split_id FROM personal_best_history
                 WHERE player_id = $1 ORDER BY challenge_split_id",
                &[&player_id],
            )
            .await
            .expect("pb rows");
        let pb_split_ids: Vec<i32> = pbs.iter().map(|row| row.get(0)).collect();
        assert_eq!(pb_split_ids, split_ids, "player {player_id}");
    }

    // Death is tracked for player3
    let stats = client
        .query(
            "SELECT player_id, deaths_total, deaths_sotetseg, elder_maul_smacks, chally_pokes
             FROM player_stats WHERE player_id = ANY($1)",
            &[&player_ids],
        )
        .await
        .expect("player stats");
    assert_eq!(stats.len(), 1);
    assert_eq!(stats[0].get::<_, i32>(0), player_ids[2]);
    assert_eq!(stats[0].get::<_, i32>(1), 1);
    assert_eq!(stats[0].get::<_, i32>(2), 1);
    assert_eq!(stats[0].get::<_, i32>(3), 0);
    assert_eq!(stats[0].get::<_, i32>(4), 0);

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
            (event::Type::PlayerAttack as i16, 83),
            (event::Type::PlayerDeath as i16, 1),
            (event::Type::NpcSpawn as i16, 1),
            (event::Type::NpcDeath as i16, 1),
            (event::Type::NpcAttack as i16, 29),
            (event::Type::PlayerSpell as i16, 7),
        ]),
    );

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
    assert_eq!(row.get::<_, Option<i32>>(2), Some(207));
    row.get::<_, Option<serde_json::Value>>(3)
        .expect("custom data present")
}

const XARPUS_UUID: &str = "01e4d4be-c0ac-4f24-8055-11f7b6e08392";

#[tokio::test]
async fn xarpus_test() {
    let Some(db) = db::test_database().await else {
        return;
    };
    let Some(redis) = redis::tests::test_store().await else {
        return;
    };
    let _fixture_lock = super::FIXTURE_TESTS.lock().await;
    let client = db.checkout().await.expect("client");

    let uuid: Uuid = XARPUS_UUID.parse().expect("uuid is valid");
    let party: Vec<String> = PARTY[..4].iter().map(ToString::to_string).collect();

    // Clean the DB from previous runs.
    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .unwrap();
    client
        .execute(
            "DELETE FROM players WHERE normalized_username = ANY($1)",
            &[&party],
        )
        .await
        .unwrap();

    prepare_fixture(uuid, Stage::TobXarpus, &load_fixture("tob_xarpus")).await;

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
        challenge_type: ChallengeType::Tob,
        mode: ChallengeMode::TobRegular,
        party,
        party_changed: false,
        stage: Stage::TobXarpus,
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
    let (challenge_id, player_ids) = verify_creation(&client, uuid, &repository, 4).await;

    let payload = pipeline
        .process(ProcessingRequest {
            trigger: Trigger::Stage {
                seq: JournalSeq(2),
                stage: Stage::TobXarpus,
                attempt: None,
            },
            challenge: info.clone(),
        })
        .await
        .expect("xarpus runs");
    assert_eq!(
        payload,
        ProcessingPayload::Stage {
            status: StageStatus::Completed,
            ticks: 239,
        },
    );

    let custom_data = verify_xarpus_rows(&client, challenge_id, &player_ids).await;
    let stored_data = repository
        .load_challenge(uuid)
        .await
        .expect("challenge file");
    let events = repository
        .load_stage_events(uuid, Stage::TobXarpus, None)
        .await
        .expect("stage events");
    golden::assert_stage_artifacts("tob_xarpus", &custom_data, &stored_data, &events);

    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("challenge cleanup");
    client
        .execute("DELETE FROM players WHERE id = ANY($1)", &[&player_ids])
        .await
        .expect("player cleanup");
}

/// Checks every row the Xarpus room writes, returning its stored custom data.
async fn verify_xarpus_rows(
    client: &Object,
    challenge_id: i32,
    player_ids: &[i32],
) -> serde_json::Value {
    let row = client
        .query_one(
            "SELECT type, mode, scale, stage, status, challenge_ticks, total_deaths, start_time
             FROM challenges WHERE id = $1",
            &[&challenge_id],
        )
        .await
        .expect("challenge row");
    assert_eq!(row.get::<_, i16>(0), ChallengeType::Tob as i16);
    assert_eq!(row.get::<_, i16>(1), ChallengeMode::TobRegular as i16);
    assert_eq!(row.get::<_, i16>(2), 4);
    assert_eq!(row.get::<_, i16>(3), Stage::TobXarpus as i16);
    assert_eq!(row.get::<_, i16>(4), ChallengeStatus::InProgress as i16);
    assert_eq!(row.get::<_, i32>(5), 239);
    assert_eq!(row.get::<_, i32>(6), 1);
    assert_eq!(
        row.get::<_, std::time::SystemTime>(7),
        UNIX_EPOCH + Duration::from_millis(CREATED_UNIX_MS),
    );

    // player2 dies during P3.
    let rows = client
        .query(
            "SELECT username, orb, primary_gear, stage_deaths FROM challenge_players
             WHERE challenge_id = $1 ORDER BY orb",
            &[&challenge_id],
        )
        .await
        .expect("membership rows");
    let expected_gear = [
        PrimaryMeleeGear::RadiantOathplate,
        PrimaryMeleeGear::Oathplate,
        PrimaryMeleeGear::RadiantOathplate,
        PrimaryMeleeGear::RadiantOathplate,
    ];
    assert_eq!(rows.len(), 4);
    for (orb, (row, gear)) in rows.iter().zip(expected_gear).enumerate() {
        assert_eq!(row.get::<_, &str>(0), PARTY[orb]);
        assert_eq!(row.get::<_, i16>(1), i16::try_from(orb).unwrap());
        assert_eq!(row.get::<_, i16>(2), gear as i16, "{}", PARTY[orb]);
        let deaths = if orb == 1 {
            vec![Stage::TobXarpus as i16]
        } else {
            Vec::new()
        };
        assert_eq!(row.get::<_, Vec<i16>>(3), deaths, "{}", PARTY[orb]);
    }

    // 18(!) heals.
    let row = client
        .query_one(
            "SELECT xarpus_deaths, xarpus_healing FROM tob_challenge_stats
             WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("stats row");
    assert_eq!(row.get::<_, Option<i32>>(0), Some(1));
    assert_eq!(row.get::<_, Option<i32>>(1), Some(162));

    // Screech at 180.
    let splits = client
        .query(
            "SELECT id, type, scale, ticks, accurate FROM challenge_splits
             WHERE challenge_id = $1 ORDER BY type",
            &[&challenge_id],
        )
        .await
        .expect("split rows");
    let expected = [
        (SplitType::TobRegXarpus, 239),
        (SplitType::TobRegXarpusExhumes, 84),
        (SplitType::TobRegXarpusScreech, 180),
        (SplitType::TobRegXarpusP2, 96),
        (SplitType::TobRegXarpusP3, 59),
    ];
    assert_eq!(splits.len(), expected.len());
    for (row, (split, ticks)) in splits.iter().zip(expected) {
        assert_eq!(row.get::<_, i16>(1), split as i16, "{split:?}");
        assert_eq!(row.get::<_, i16>(2), 4, "{split:?}");
        assert_eq!(row.get::<_, i32>(3), ticks, "{split:?}");
        assert!(row.get::<_, bool>(4), "{split:?}");
    }
    let split_ids: Vec<i32> = splits.iter().map(|row| row.get(0)).collect();

    for &player_id in player_ids {
        let pbs = client
            .query(
                "SELECT challenge_split_id FROM personal_best_history
                 WHERE player_id = $1 ORDER BY challenge_split_id",
                &[&player_id],
            )
            .await
            .expect("pb rows");
        let pb_split_ids: Vec<i32> = pbs.iter().map(|row| row.get(0)).collect();
        assert_eq!(pb_split_ids, split_ids, "player {player_id}");
    }

    // player2 dies and player4 chally swipes.
    let stats = client
        .query(
            "SELECT player_id, deaths_total, deaths_xarpus, chally_pokes, elder_maul_smacks,
                    bgs_smacks, tob_verzik_p1_troll_specs
             FROM player_stats WHERE player_id = ANY($1)",
            &[&player_ids],
        )
        .await
        .expect("player stats");
    let stats: BTreeMap<i32, (i32, i32, i32, i32, i32, i32)> = stats
        .iter()
        .map(|row| {
            (
                row.get(0),
                (
                    row.get(1),
                    row.get(2),
                    row.get(3),
                    row.get(4),
                    row.get(5),
                    row.get(6),
                ),
            )
        })
        .collect();
    assert_eq!(
        stats,
        BTreeMap::from([
            (player_ids[1], (1, 1, 0, 0, 0, 0)),
            (player_ids[3], (0, 0, 1, 0, 0, 0)),
        ]),
    );

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
            (event::Type::PlayerAttack as i16, 109),
            (event::Type::PlayerDeath as i16, 1),
            (event::Type::NpcSpawn as i16, 1),
            (event::Type::NpcDeath as i16, 1),
            (event::Type::NpcAttack as i16, 30),
            (event::Type::PlayerSpell as i16, 2),
            (event::Type::TobXarpusExhumed as i16, 15),
        ]),
    );

    let rows = client
        .query(
            "SELECT tick, custom_short_1 FROM queryable_events
             WHERE challenge_id = $1 AND event_type = $2 ORDER BY tick",
            &[&challenge_id, &(event::Type::TobXarpusExhumed as i16)],
        )
        .await
        .expect("exhumed rows");
    let exhumeds: Vec<(i32, i16)> = rows.iter().map(|row| (row.get(0), row.get(1))).collect();
    assert_eq!(
        exhumeds,
        vec![
            (8, 1),
            (12, 4),
            (16, 1),
            (20, 0),
            (24, 2),
            (28, 0),
            (32, 2),
            (36, 1),
            (40, 1),
            (44, 1),
            (48, 0),
            (52, 1),
            (56, 2),
            (60, 1),
            (64, 1),
        ],
    );

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
    assert_eq!(row.get::<_, Option<i32>>(2), Some(239));
    row.get::<_, Option<serde_json::Value>>(3)
        .expect("custom data present")
}

const VERZIK_UUID: &str = "ca97e660-d6bc-4c08-bc25-73c09577d8e7";

#[tokio::test]
async fn verzik_test() {
    let Some(db) = db::test_database().await else {
        return;
    };
    let Some(redis) = redis::tests::test_store().await else {
        return;
    };
    let _fixture_lock = super::FIXTURE_TESTS.lock().await;
    let client = db.checkout().await.expect("client");

    let uuid: Uuid = VERZIK_UUID.parse().expect("uuid is valid");
    let party: Vec<String> = PARTY[..3].iter().map(ToString::to_string).collect();

    // Clean the DB from previous runs.
    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .unwrap();
    client
        .execute(
            "DELETE FROM players WHERE normalized_username = ANY($1)",
            &[&party],
        )
        .await
        .unwrap();

    prepare_fixture(uuid, Stage::TobVerzik, &load_fixture("tob_verzik")).await;

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
        challenge_type: ChallengeType::Tob,
        mode: ChallengeMode::TobRegular,
        party,
        party_changed: false,
        stage: Stage::TobVerzik,
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
    let (challenge_id, player_ids) = verify_creation(&client, uuid, &repository, 3).await;

    let payload = pipeline
        .process(ProcessingRequest {
            trigger: Trigger::Stage {
                seq: JournalSeq(2),
                stage: Stage::TobVerzik,
                attempt: None,
            },
            challenge: info.clone(),
        })
        .await
        .expect("verzik runs");
    assert_eq!(
        payload,
        ProcessingPayload::Stage {
            status: StageStatus::Completed,
            ticks: 394,
        },
    );

    let custom_data = verify_verzik_rows(&client, challenge_id, &player_ids).await;
    let stored_data = repository
        .load_challenge(uuid)
        .await
        .expect("challenge file");
    let events = repository
        .load_stage_events(uuid, Stage::TobVerzik, None)
        .await
        .expect("stage events");
    golden::assert_stage_artifacts("tob_verzik", &custom_data, &stored_data, &events);

    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("challenge cleanup");
    client
        .execute("DELETE FROM players WHERE id = ANY($1)", &[&player_ids])
        .await
        .expect("player cleanup");
}

/// Checks every row the Verzik room writes, returning its stored custom data.
async fn verify_verzik_rows(
    client: &Object,
    challenge_id: i32,
    player_ids: &[i32],
) -> serde_json::Value {
    let row = client
        .query_one(
            "SELECT type, mode, scale, stage, status, challenge_ticks, total_deaths, start_time
             FROM challenges WHERE id = $1",
            &[&challenge_id],
        )
        .await
        .expect("challenge row");
    assert_eq!(row.get::<_, i16>(0), ChallengeType::Tob as i16);
    assert_eq!(row.get::<_, i16>(1), ChallengeMode::TobRegular as i16);
    assert_eq!(row.get::<_, i16>(2), 3);
    assert_eq!(row.get::<_, i16>(3), Stage::TobVerzik as i16);
    assert_eq!(row.get::<_, i16>(4), ChallengeStatus::InProgress as i16);
    assert_eq!(row.get::<_, i32>(5), 394);
    assert_eq!(row.get::<_, i32>(6), 0);
    assert_eq!(
        row.get::<_, std::time::SystemTime>(7),
        UNIX_EPOCH + Duration::from_millis(CREATED_UNIX_MS),
    );

    let rows = client
        .query(
            "SELECT username, orb, primary_gear, stage_deaths FROM challenge_players
             WHERE challenge_id = $1 ORDER BY orb",
            &[&challenge_id],
        )
        .await
        .expect("membership rows");
    let expected_gear = [
        PrimaryMeleeGear::RadiantOathplate,
        PrimaryMeleeGear::Oathplate,
        PrimaryMeleeGear::RadiantOathplate,
    ];
    assert_eq!(rows.len(), 3);
    for (orb, (row, gear)) in rows.iter().zip(expected_gear).enumerate() {
        assert_eq!(row.get::<_, &str>(0), PARTY[orb]);
        assert_eq!(row.get::<_, i16>(1), i16::try_from(orb).unwrap());
        assert_eq!(row.get::<_, i16>(2), gear as i16, "{}", PARTY[orb]);
        assert_eq!(row.get::<_, Vec<i16>>(3), Vec::<i16>::new());
    }

    // Two reds at 200 and 244.
    let row = client
        .query_one(
            "SELECT verzik_deaths, verzik_reds_count FROM tob_challenge_stats
             WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("stats row");
    assert_eq!(row.get::<_, Option<i32>>(0), Some(0));
    assert_eq!(row.get::<_, Option<i32>>(1), Some(2));

    // P1 ends at 84, P2 at 266.
    let splits = client
        .query(
            "SELECT id, type, scale, ticks, accurate FROM challenge_splits
             WHERE challenge_id = $1 ORDER BY type",
            &[&challenge_id],
        )
        .await
        .expect("split rows");
    let expected = [
        (SplitType::TobRegVerzikRoom, 394),
        (SplitType::TobRegVerzikP1End, 84),
        (SplitType::TobRegVerzikReds, 200),
        (SplitType::TobRegVerzikP2End, 266),
        (SplitType::TobRegVerzikP2, 169),
        (SplitType::TobRegVerzikP3, 122),
    ];
    assert_eq!(splits.len(), expected.len());
    for (row, (split, ticks)) in splits.iter().zip(expected) {
        assert_eq!(row.get::<_, i16>(1), split as i16, "{split:?}");
        assert_eq!(row.get::<_, i16>(2), 3, "{split:?}");
        assert_eq!(row.get::<_, i32>(3), ticks, "{split:?}");
        assert!(row.get::<_, bool>(4), "{split:?}");
    }
    let split_ids: Vec<i32> = splits.iter().map(|row| row.get(0)).collect();

    for &player_id in player_ids {
        let pbs = client
            .query(
                "SELECT challenge_split_id FROM personal_best_history
                 WHERE player_id = $1 ORDER BY challenge_split_id",
                &[&player_id],
            )
            .await
            .expect("pb rows");
        let pb_split_ids: Vec<i32> = pbs.iter().map(|row| row.get(0)).collect();
        assert_eq!(pb_split_ids, split_ids, "player {player_id}");
    }

    // player2 melees once.
    let stats = client
        .query(
            "SELECT player_id, tob_verzik_p3_melees, tob_verzik_p1_troll_specs, deaths_total
             FROM player_stats WHERE player_id = ANY($1)",
            &[&player_ids],
        )
        .await
        .expect("player stats");
    assert_eq!(stats.len(), 1);
    assert_eq!(stats[0].get::<_, i32>(0), player_ids[1]);
    assert_eq!(stats[0].get::<_, i32>(1), 1);
    assert_eq!(stats[0].get::<_, i32>(2), 0);
    assert_eq!(stats[0].get::<_, i32>(3), 0);

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
            (event::Type::PlayerAttack as i16, 213),
            (event::Type::NpcSpawn as i16, 20),
            (event::Type::NpcDeath as i16, 20),
            (event::Type::NpcAttack as i16, 51),
            (event::Type::PlayerSpell as i16, 18),
            (event::Type::TobVerzikBounce as i16, 35),
            (event::Type::TobVerzikDawnDrop as i16, 11),
        ]),
    );

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
    assert_eq!(row.get::<_, Option<i32>>(2), Some(394));
    row.get::<_, Option<serde_json::Value>>(3)
        .expect("custom data present")
}

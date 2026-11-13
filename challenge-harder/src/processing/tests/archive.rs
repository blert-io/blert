//! Fractured Archive processing.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use blert::Rsn;
use blert::proto::event;
use deadpool_postgres::Object;

use super::{golden, load_fixture, prepare_fixture};
use crate::lifecycle::core::state::Trigger;
use crate::lifecycle::core::types::{
    ChallengeInfo, ChallengeMode, ChallengeStatus, ChallengeType, JournalSeq, OverallTicks,
    PrimaryMeleeGear, ProcessingPayload, ServerTicks, Stage, StageStatus, Uuid,
};
use crate::price::PriceResolver;
use crate::processing::effects::EventKind;
use crate::processing::split::SplitType;
use crate::processing::{
    CaptureRates, Pipeline, ProcessingRequest, ProcessorConfig, StageProcessor, StreamCapturer, db,
};
use crate::proto::{ChallengeData, challenge_data};
use crate::redis;
use crate::repository::{DataRepository, FilesystemBackend};

#[tokio::test]
async fn route_sets_row_bits_at_stage_start() {
    let Some(db) = db::test_database().await else {
        return;
    };
    let Some(redis) = redis::tests::test_store().await else {
        return;
    };
    let client = db.checkout().await.expect("client");
    let dir = tempfile::tempdir().expect("tempdir");
    let pipeline = Pipeline::new(
        Arc::new(db),
        Arc::new(redis),
        DataRepository::new(Box::new(FilesystemBackend::new(dir.path().to_path_buf()))),
        Arc::new(PriceResolver::new(None)),
        ProcessorConfig::default(),
    );

    let uuid = Uuid::new_v4();
    let player = format!("1Ogp {}", &uuid.to_string()[..7]);
    let mut info = ChallengeInfo {
        uuid,
        session_uuid: Uuid::new_v4(),
        challenge_type: ChallengeType::Tfa,
        mode: ChallengeMode::NoMode,
        party: vec![Rsn::try_from(player.clone()).unwrap()],
        party_changed: false,
        stage: Stage::TfaGuardian,
        stage_attempt: None,
        status: ChallengeStatus::InProgress,
        created_unix_ms: 1_792_561_330_000,
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
    let route: Option<i16> = client
        .query_one(
            "SELECT s.route FROM tfa_challenge_stats s
             JOIN challenges c ON c.id = s.challenge_id
             WHERE c.uuid = $1",
            &[&uuid],
        )
        .await
        .expect("stats row")
        .get(0);
    assert_eq!(route, Some(0));

    info.stage = Stage::TfaBork;
    let payload = pipeline
        .process(ProcessingRequest {
            trigger: Trigger::StageStart {
                seq: JournalSeq(2),
                stage: Stage::TfaBork,
                overall_ticks: None,
            },
            challenge: info.clone(),
        })
        .await
        .expect("bork start runs");
    assert_eq!(payload, ProcessingPayload::None);
    let route: Option<i16> = client
        .query_one(
            "SELECT s.route FROM tfa_challenge_stats s
             JOIN challenges c ON c.id = s.challenge_id
             WHERE c.uuid = $1",
            &[&uuid],
        )
        .await
        .expect("stats row")
        .get(0);
    assert_eq!(route, Some(1));

    info.stage = Stage::TfaMoia;
    let payload = pipeline
        .process(ProcessingRequest {
            trigger: Trigger::StageStart {
                seq: JournalSeq(3),
                stage: Stage::TfaMoia,
                overall_ticks: None,
            },
            challenge: info.clone(),
        })
        .await
        .expect("moia start runs");
    assert_eq!(payload, ProcessingPayload::None);
    let route: Option<i16> = client
        .query_one(
            "SELECT s.route FROM tfa_challenge_stats s
             JOIN challenges c ON c.id = s.challenge_id
             WHERE c.uuid = $1",
            &[&uuid],
        )
        .await
        .expect("stats row")
        .get(0);
    assert_eq!(route, Some(1));

    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("cleanup");
    client
        .execute("DELETE FROM players WHERE username = $1", &[&player])
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
async fn route_is_set_for_challenge_that_started_recording_late() {
    let Some(db) = db::test_database().await else {
        return;
    };
    let Some(redis) = redis::tests::test_store().await else {
        return;
    };
    let client = db.checkout().await.expect("client");
    let dir = tempfile::tempdir().expect("tempdir");
    let pipeline = Pipeline::new(
        Arc::new(db),
        Arc::new(redis),
        DataRepository::new(Box::new(FilesystemBackend::new(dir.path().to_path_buf()))),
        Arc::new(PriceResolver::new(None)),
        ProcessorConfig::default(),
    );

    let uuid = Uuid::new_v4();
    let player = format!("1Ogp {}", &uuid.to_string()[..7]);
    let info = ChallengeInfo {
        uuid,
        session_uuid: Uuid::new_v4(),
        challenge_type: ChallengeType::Tfa,
        mode: ChallengeMode::NoMode,
        party: vec![Rsn::try_from(player.clone()).unwrap()],
        party_changed: false,
        stage: Stage::TfaBork,
        stage_attempt: None,
        status: ChallengeStatus::InProgress,
        created_unix_ms: 1_792_562_018_000,
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
    let route: Option<i16> = client
        .query_one(
            "SELECT s.route FROM tfa_challenge_stats s
             JOIN challenges c ON c.id = s.challenge_id
             WHERE c.uuid = $1",
            &[&uuid],
        )
        .await
        .expect("stats row")
        .get(0);
    assert_eq!(route, Some(1));

    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("cleanup");
    client
        .execute("DELETE FROM players WHERE username = $1", &[&player])
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
async fn route_is_null_for_a_recording_starting_past_the_second_row() {
    let Some(db) = db::test_database().await else {
        return;
    };
    let Some(redis) = redis::tests::test_store().await else {
        return;
    };
    let client = db.checkout().await.expect("client");
    let dir = tempfile::tempdir().expect("tempdir");
    let pipeline = Pipeline::new(
        Arc::new(db),
        Arc::new(redis),
        DataRepository::new(Box::new(FilesystemBackend::new(dir.path().to_path_buf()))),
        Arc::new(PriceResolver::new(None)),
        ProcessorConfig::default(),
    );

    let uuid = Uuid::new_v4();
    let player = format!("1Ogp {}", &uuid.to_string()[..7]);
    let info = ChallengeInfo {
        uuid,
        session_uuid: Uuid::new_v4(),
        challenge_type: ChallengeType::Tfa,
        mode: ChallengeMode::NoMode,
        party: vec![Rsn::try_from(player.clone()).unwrap()],
        party_changed: false,
        stage: Stage::TfaMoia,
        stage_attempt: None,
        status: ChallengeStatus::InProgress,
        created_unix_ms: 1_792_562_455_000,
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
    let route: Option<i16> = client
        .query_one(
            "SELECT s.route FROM tfa_challenge_stats s
             JOIN challenges c ON c.id = s.challenge_id
             WHERE c.uuid = $1",
            &[&uuid],
        )
        .await
        .expect("stats row")
        .get(0);
    assert_eq!(route, None);

    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("cleanup");
    client
        .execute("DELETE FROM players WHERE username = $1", &[&player])
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
async fn route_is_null_after_a_row_without_a_start() {
    let Some(db) = db::test_database().await else {
        return;
    };
    let Some(redis) = redis::tests::test_store().await else {
        return;
    };
    let client = db.checkout().await.expect("client");
    let dir = tempfile::tempdir().expect("tempdir");
    let pipeline = Pipeline::new(
        Arc::new(db),
        Arc::new(redis),
        DataRepository::new(Box::new(FilesystemBackend::new(dir.path().to_path_buf()))),
        Arc::new(PriceResolver::new(None)),
        ProcessorConfig::default(),
    );

    let uuid = Uuid::new_v4();
    let player = format!("1Ogp {}", &uuid.to_string()[..7]);
    let mut info = ChallengeInfo {
        uuid,
        session_uuid: Uuid::new_v4(),
        challenge_type: ChallengeType::Tfa,
        mode: ChallengeMode::NoMode,
        party: vec![Rsn::try_from(player.clone()).unwrap()],
        party_changed: false,
        stage: Stage::TfaGuardian,
        stage_attempt: None,
        status: ChallengeStatus::InProgress,
        created_unix_ms: 1_792_563_102_000,
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
    let route: Option<i16> = client
        .query_one(
            "SELECT s.route FROM tfa_challenge_stats s
             JOIN challenges c ON c.id = s.challenge_id
             WHERE c.uuid = $1",
            &[&uuid],
        )
        .await
        .expect("stats row")
        .get(0);
    assert_eq!(route, Some(0));

    info.stage = Stage::TfaEzekiel;
    let payload = pipeline
        .process(ProcessingRequest {
            trigger: Trigger::StageStart {
                seq: JournalSeq(2),
                stage: Stage::TfaEzekiel,
                overall_ticks: None,
            },
            challenge: info.clone(),
        })
        .await
        .expect("ezekiel start runs");
    assert_eq!(payload, ProcessingPayload::None);
    let route: Option<i16> = client
        .query_one(
            "SELECT s.route FROM tfa_challenge_stats s
             JOIN challenges c ON c.id = s.challenge_id
             WHERE c.uuid = $1",
            &[&uuid],
        )
        .await
        .expect("stats row")
        .get(0);
    assert_eq!(route, Some(0));

    info.stage = Stage::TfaXarth;
    let payload = pipeline
        .process(ProcessingRequest {
            trigger: Trigger::StageStart {
                seq: JournalSeq(3),
                stage: Stage::TfaXarth,
                overall_ticks: None,
            },
            challenge: info.clone(),
        })
        .await
        .expect("xarth start runs");
    assert_eq!(payload, ProcessingPayload::None);
    let route: Option<i16> = client
        .query_one(
            "SELECT s.route FROM tfa_challenge_stats s
             JOIN challenges c ON c.id = s.challenge_id
             WHERE c.uuid = $1",
            &[&uuid],
        )
        .await
        .expect("stats row")
        .get(0);
    assert_eq!(route, None);

    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("cleanup");
    client
        .execute("DELETE FROM players WHERE username = $1", &[&player])
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
async fn stage_start_writes_the_reported_overall_ticks() {
    let Some(db) = db::test_database().await else {
        return;
    };
    let Some(redis) = redis::tests::test_store().await else {
        return;
    };
    let client = db.checkout().await.expect("client");
    let dir = tempfile::tempdir().expect("tempdir");
    let pipeline = Pipeline::new(
        Arc::new(db),
        Arc::new(redis),
        DataRepository::new(Box::new(FilesystemBackend::new(dir.path().to_path_buf()))),
        Arc::new(PriceResolver::new(None)),
        ProcessorConfig::default(),
    );

    let uuid = Uuid::new_v4();
    let player = format!("1Ogp {}", &uuid.to_string()[..7]);
    let mut info = ChallengeInfo {
        uuid,
        session_uuid: Uuid::new_v4(),
        challenge_type: ChallengeType::Tfa,
        mode: ChallengeMode::NoMode,
        party: vec![Rsn::try_from(player.clone()).unwrap()],
        party_changed: false,
        stage: Stage::TfaGuardian,
        stage_attempt: None,
        status: ChallengeStatus::InProgress,
        created_unix_ms: 1_793_121_127_000,
        reported_times: None,
        finished_unix_ms: None,
    };

    pipeline
        .process(ProcessingRequest {
            trigger: Trigger::Create { seq: JournalSeq(1) },
            challenge: info.clone(),
        })
        .await
        .expect("create runs");

    info.stage = Stage::TfaBork;
    let payload = pipeline
        .process(ProcessingRequest {
            trigger: Trigger::StageStart {
                seq: JournalSeq(2),
                stage: Stage::TfaBork,
                overall_ticks: Some(OverallTicks::Server(ServerTicks {
                    count: 228,
                    precise: true,
                })),
            },
            challenge: info.clone(),
        })
        .await
        .expect("bork start runs");
    assert_eq!(payload, ProcessingPayload::None);
    let row = client
        .query_one(
            "SELECT stage, overall_ticks FROM challenges WHERE uuid = $1",
            &[&uuid],
        )
        .await
        .expect("challenge row");
    assert_eq!(row.get::<_, i16>(0), Stage::TfaBork as i16);
    assert_eq!(row.get::<_, Option<i32>>(1), Some(228));

    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("cleanup");
    client
        .execute("DELETE FROM players WHERE username = $1", &[&player])
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

/// Checks the state of the database after a new TFA challenge is created.
async fn verify_creation(
    client: &Object,
    uuid: Uuid,
    repository: &DataRepository,
    scale: usize,
    route: Option<i16>,
) -> (i32, Vec<i32>) {
    let challenge_id: i32 = client
        .query_one("SELECT id FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("challenge row")
        .get(0);

    let row = client
        .query_one(
            "SELECT route, guardian_deaths, guardian_down_count
             FROM tfa_challenge_stats WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("stats row");
    assert_eq!(row.get::<_, Option<i16>>(0), route);
    assert_eq!(row.get::<_, Option<i32>>(1), None);
    assert_eq!(row.get::<_, Option<i16>>(2), None);

    let party = &GUARDIAN_PARTY[..scale];
    let players = client
        .query(
            "SELECT id, normalized_username, total_recordings FROM players
             WHERE normalized_username = ANY($1) ORDER BY id",
            &[&party],
        )
        .await
        .expect("player rows");
    assert_eq!(
        players
            .iter()
            .map(|row| (row.get::<_, &str>(1), row.get::<_, i32>(2)))
            .collect::<Vec<_>>(),
        party.iter().map(|name| (*name, 1)).collect::<Vec<_>>(),
    );

    assert_eq!(
        repository
            .load_challenge(uuid)
            .await
            .expect("challenge file"),
        ChallengeData {
            challenge_id: uuid.to_string(),
            stage_data: Some(challenge_data::StageData::Tfa(challenge_data::TfaRaid {
                bosses: Vec::new(),
            })),
        },
    );

    (challenge_id, players.iter().map(|row| row.get(0)).collect())
}

const GUARDIAN_CREATED_UNIX_MS: u64 = 1_793_597_191_000;
const GUARDIAN_UUID: &str = "6f0b2c4e-93d1-4a57-8e2b-c51f7a90d3e8";
const GUARDIAN_PARTY: [&str; 5] = ["player1", "player2", "player3", "player4", "player5"];

#[tokio::test]
async fn guardian_test() {
    let Some(db) = db::test_database().await else {
        return;
    };
    let Some(redis) = redis::tests::test_store().await else {
        return;
    };
    let _fixture_lock = super::FIXTURE_TESTS.lock().await;
    let client = db.checkout().await.expect("client");

    let uuid: Uuid = GUARDIAN_UUID.parse().expect("uuid is valid");

    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .unwrap();
    client
        .execute(
            "DELETE FROM players WHERE normalized_username = ANY($1)",
            &[&GUARDIAN_PARTY.as_slice()],
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

    let fixture = load_fixture("tfa_guardian");
    prepare_fixture(uuid, Stage::TfaGuardian, &fixture.records).await;

    let dir = tempfile::tempdir().expect("tempdir");
    let pipeline = Pipeline::new(
        Arc::new(db),
        Arc::new(redis),
        DataRepository::new(Box::new(FilesystemBackend::new(dir.path().to_path_buf()))),
        Arc::new(PriceResolver::new(None)),
        ProcessorConfig {
            latest_config_version: fixture.latest_config_version,
            ..ProcessorConfig::default()
        },
    )
    .with_capturer(StreamCapturer::new(
        DataRepository::new(Box::new(FilesystemBackend::new(dir.path().to_path_buf()))),
        false,
        CaptureRates {
            baseline: 1.0,
            ..CaptureRates::default()
        },
    ));

    let info = ChallengeInfo {
        uuid,
        session_uuid: Uuid::new_v4(),
        challenge_type: ChallengeType::Tfa,
        mode: ChallengeMode::NoMode,
        party: GUARDIAN_PARTY
            .iter()
            .map(|name| Rsn::try_from(*name).unwrap())
            .collect(),
        party_changed: false,
        stage: Stage::TfaGuardian,
        stage_attempt: None,
        status: ChallengeStatus::InProgress,
        created_unix_ms: GUARDIAN_CREATED_UNIX_MS,
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
    let (challenge_id, player_ids) = verify_creation(&client, uuid, &repository, 5, Some(0)).await;

    let payload = pipeline
        .process(ProcessingRequest {
            trigger: Trigger::Stage {
                seq: JournalSeq(2),
                stage: Stage::TfaGuardian,
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
            ticks: 355,
        },
    );

    let custom_data = verify_guardian_stage_rows(&client, challenge_id, &player_ids).await;
    let merge_report = super::merge_report_rows(&client, challenge_id, Stage::TfaGuardian).await;
    let stored_data = repository
        .load_challenge(uuid)
        .await
        .expect("challenge file");
    let events = repository
        .load_stage_events(uuid, Stage::TfaGuardian, None)
        .await
        .expect("guardian events");
    let capture = super::capture_file(&repository, uuid, Stage::TfaGuardian).await;
    golden::assert_stage_artifacts(
        "tfa_guardian",
        &custom_data,
        &stored_data,
        &events,
        &merge_report,
        &capture,
    );

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
        format!("{uuid}:{}", Stage::TfaGuardian as i32),
    );

    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("challenge cleanup");
    client
        .execute("DELETE FROM players WHERE id = ANY($1)", &[&player_ids])
        .await
        .expect("player cleanup");
    client
        .execute(
            "DELETE FROM challenge_sessions WHERE uuid = $1",
            &[&info.session_uuid],
        )
        .await
        .expect("session cleanup");
    client
        .execute(
            "DELETE FROM effect_events WHERE key LIKE $1",
            &[&format!("{uuid}%")],
        )
        .await
        .expect("outbox cleanup");
}

async fn verify_guardian_stage_rows(
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
    assert_eq!(row.get::<_, i16>(0), ChallengeType::Tfa as i16);
    assert_eq!(row.get::<_, i16>(1), ChallengeMode::NoMode as i16);
    assert_eq!(row.get::<_, i16>(2), 5);
    assert_eq!(row.get::<_, i16>(3), Stage::TfaGuardian as i16);
    assert_eq!(row.get::<_, i16>(4), ChallengeStatus::InProgress as i16);
    assert_eq!(row.get::<_, i32>(5), 355);
    assert_eq!(row.get::<_, i32>(6), 0);
    assert_eq!(
        row.get::<_, std::time::SystemTime>(7),
        UNIX_EPOCH + Duration::from_millis(GUARDIAN_CREATED_UNIX_MS),
    );

    let rows = client
        .query(
            "SELECT player_id, username, orb, primary_gear, stage_deaths FROM challenge_players
             WHERE challenge_id = $1 ORDER BY orb",
            &[&challenge_id],
        )
        .await
        .expect("membership rows");
    assert_eq!(
        rows.iter()
            .map(|row| (
                row.get::<_, i32>(0),
                row.get::<_, &str>(1),
                row.get::<_, i16>(2),
                row.get::<_, i16>(3),
                row.get::<_, Vec<i16>>(4),
            ))
            .collect::<Vec<_>>(),
        player_ids
            .iter()
            .zip(GUARDIAN_PARTY)
            .zip(0..)
            .map(
                |((&id, name), orb)| (id, name, orb, PrimaryMeleeGear::Unknown as i16, Vec::new(),)
            )
            .collect::<Vec<_>>(),
    );

    let row = client
        .query_one(
            "SELECT route, guardian_deaths, guardian_down_count
             FROM tfa_challenge_stats WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("stats row");
    assert_eq!(row.get::<_, Option<i16>>(0), Some(0));
    assert_eq!(row.get::<_, Option<i32>>(1), Some(0));
    assert_eq!(row.get::<_, Option<i16>>(2), Some(3));

    let splits = client
        .query(
            "SELECT type, scale, ticks, accurate FROM challenge_splits
             WHERE challenge_id = $1 ORDER BY type",
            &[&challenge_id],
        )
        .await
        .expect("split rows");
    assert_eq!(
        splits
            .iter()
            .map(|row| (
                row.get::<_, i16>(0),
                row.get::<_, i16>(1),
                row.get::<_, i32>(2),
                row.get::<_, bool>(3),
            ))
            .collect::<Vec<_>>(),
        vec![
            (SplitType::TfaGuardian as i16, 5, 355, true),
            (SplitType::TfaGuardianEnrage as i16, 5, 285, true),
        ],
    );

    let pbs = client
        .query(
            "SELECT p.player_id, s.type FROM personal_best_history p
             JOIN challenge_splits s ON s.id = p.challenge_split_id
             WHERE s.challenge_id = $1 ORDER BY p.player_id, s.type",
            &[&challenge_id],
        )
        .await
        .expect("pb rows");
    assert_eq!(
        pbs.iter()
            .map(|row| (row.get::<_, i32>(0), row.get::<_, i16>(1)))
            .collect::<Vec<_>>(),
        player_ids
            .iter()
            .flat_map(|&player| {
                [
                    (player, SplitType::TfaGuardian as i16),
                    (player, SplitType::TfaGuardianEnrage as i16),
                ]
            })
            .collect::<Vec<_>>(),
    );

    let stats = client
        .query_one(
            "SELECT count(*) FROM player_stats WHERE player_id = ANY($1)",
            &[&player_ids],
        )
        .await
        .expect("player stats");
    assert_eq!(stats.get::<_, i64>(0), 0);

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
            (event::Type::PlayerAttack as i16, 335),
            (event::Type::NpcSpawn as i16, 109),
            (event::Type::NpcDeath as i16, 108),
            (event::Type::NpcAttack as i16, 46),
            (event::Type::PlayerSpell as i16, 4),
            (event::Type::TfaGuardianDown as i16, 3),
            (event::Type::TfaGuardianBrazier as i16, 4),
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
    assert_eq!(row.get::<_, Option<i32>>(2), Some(355));
    row.get::<_, Option<serde_json::Value>>(3)
        .expect("custom data present")
}

const GUARDIAN_MERGE_CLEAN_UUID: &str = "713a5a42-cdde-428b-984d-d933e4d883a8";

#[tokio::test]
async fn guardian_merge_clean_test() {
    let Some(db) = db::test_database().await else {
        return;
    };
    let Some(redis) = redis::tests::test_store().await else {
        return;
    };
    let _fixture_lock = super::FIXTURE_TESTS.lock().await;
    let client = db.checkout().await.expect("client");

    let uuid: Uuid = GUARDIAN_MERGE_CLEAN_UUID.parse().expect("uuid is valid");
    let party = &GUARDIAN_PARTY[..2];

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

    let fixture = load_fixture("tfa_guardian_merge_clean");
    prepare_fixture(uuid, Stage::TfaGuardian, &fixture.records).await;

    let dir = tempfile::tempdir().expect("tempdir");
    let pipeline = Pipeline::new(
        Arc::new(db),
        Arc::new(redis),
        DataRepository::new(Box::new(FilesystemBackend::new(dir.path().to_path_buf()))),
        Arc::new(PriceResolver::new(None)),
        ProcessorConfig {
            latest_config_version: fixture.latest_config_version,
            ..ProcessorConfig::default()
        },
    )
    .with_capturer(StreamCapturer::new(
        DataRepository::new(Box::new(FilesystemBackend::new(dir.path().to_path_buf()))),
        false,
        CaptureRates {
            baseline: 1.0,
            unmerged_clients: 1.0,
            ..CaptureRates::default()
        },
    ));

    let info = ChallengeInfo {
        uuid,
        session_uuid: Uuid::new_v4(),
        challenge_type: ChallengeType::Tfa,
        mode: ChallengeMode::NoMode,
        party: party
            .iter()
            .map(|name| Rsn::try_from(*name).unwrap())
            .collect(),
        party_changed: false,
        stage: Stage::TfaGuardian,
        stage_attempt: None,
        status: ChallengeStatus::InProgress,
        created_unix_ms: GUARDIAN_CREATED_UNIX_MS,
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
    let (challenge_id, player_ids) = verify_creation(&client, uuid, &repository, 2, Some(0)).await;

    let payload = pipeline
        .process(ProcessingRequest {
            trigger: Trigger::Stage {
                seq: JournalSeq(2),
                stage: Stage::TfaGuardian,
                attempt: None,
            },
            challenge: info.clone(),
        })
        .await
        .expect("stage runs");
    assert_eq!(
        payload,
        ProcessingPayload::Stage {
            status: StageStatus::Wiped,
            ticks: 217,
        },
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
        Some(StageStatus::Wiped as i16),
    );
    assert_eq!(row.get::<_, Option<i32>>(2), Some(217));
    let custom_data = row
        .get::<_, Option<serde_json::Value>>(3)
        .expect("custom data present");

    let stored_data = repository
        .load_challenge(uuid)
        .await
        .expect("challenge file");
    let events = repository
        .load_stage_events(uuid, Stage::TfaGuardian, None)
        .await
        .expect("guardian events");
    let merge_report = super::merge_report_rows(&client, challenge_id, Stage::TfaGuardian).await;
    let capture = super::capture_file(&repository, uuid, Stage::TfaGuardian).await;
    golden::assert_stage_artifacts(
        "tfa_guardian_merge_clean",
        &custom_data,
        &stored_data,
        &events,
        &merge_report,
        &capture,
    );

    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("challenge cleanup");
    client
        .execute("DELETE FROM players WHERE id = ANY($1)", &[&player_ids])
        .await
        .expect("player cleanup");
    client
        .execute(
            "DELETE FROM challenge_sessions WHERE uuid = $1",
            &[&info.session_uuid],
        )
        .await
        .expect("session cleanup");
    client
        .execute(
            "DELETE FROM effect_events WHERE key LIKE $1",
            &[&format!("{uuid}%")],
        )
        .await
        .expect("outbox cleanup");
}

const XARTH_UUID: &str = "075f7af2-0a4c-4a0b-a4ca-db13f9545244";

#[tokio::test]
async fn xarth_test() {
    let Some(db) = db::test_database().await else {
        return;
    };
    let Some(redis) = redis::tests::test_store().await else {
        return;
    };
    let _fixture_lock = super::FIXTURE_TESTS.lock().await;
    let client = db.checkout().await.expect("client");

    let uuid: Uuid = XARTH_UUID.parse().expect("uuid is valid");
    let party = &GUARDIAN_PARTY[..4];

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
    client
        .execute(
            "DELETE FROM effect_events WHERE key LIKE $1",
            &[&format!("{uuid}%")],
        )
        .await
        .unwrap();

    let fixture = load_fixture("tfa_xarth");
    prepare_fixture(uuid, Stage::TfaXarth, &fixture.records).await;

    let dir = tempfile::tempdir().expect("tempdir");
    let pipeline = Pipeline::new(
        Arc::new(db),
        Arc::new(redis),
        DataRepository::new(Box::new(FilesystemBackend::new(dir.path().to_path_buf()))),
        Arc::new(PriceResolver::new(None)),
        ProcessorConfig {
            latest_config_version: fixture.latest_config_version,
            ..ProcessorConfig::default()
        },
    )
    .with_capturer(StreamCapturer::new(
        DataRepository::new(Box::new(FilesystemBackend::new(dir.path().to_path_buf()))),
        false,
        CaptureRates {
            baseline: 1.0,
            ..CaptureRates::default()
        },
    ));

    let info = ChallengeInfo {
        uuid,
        session_uuid: Uuid::new_v4(),
        challenge_type: ChallengeType::Tfa,
        mode: ChallengeMode::NoMode,
        party: party
            .iter()
            .map(|name| Rsn::try_from(*name).unwrap())
            .collect(),
        party_changed: false,
        stage: Stage::TfaXarth,
        stage_attempt: None,
        status: ChallengeStatus::InProgress,
        created_unix_ms: GUARDIAN_CREATED_UNIX_MS,
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
    let (challenge_id, player_ids) = verify_creation(&client, uuid, &repository, 4, None).await;

    let payload = pipeline
        .process(ProcessingRequest {
            trigger: Trigger::Stage {
                seq: JournalSeq(2),
                stage: Stage::TfaXarth,
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
            ticks: 311,
        },
    );

    let custom_data = verify_xarth_stage_rows(&client, challenge_id, &player_ids).await;
    let merge_report = super::merge_report_rows(&client, challenge_id, Stage::TfaXarth).await;
    let stored_data = repository
        .load_challenge(uuid)
        .await
        .expect("challenge file");
    let events = repository
        .load_stage_events(uuid, Stage::TfaXarth, None)
        .await
        .expect("xarth events");
    let capture = super::capture_file(&repository, uuid, Stage::TfaXarth).await;
    golden::assert_stage_artifacts(
        "tfa_xarth",
        &custom_data,
        &stored_data,
        &events,
        &merge_report,
        &capture,
    );

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
        format!("{uuid}:{}", Stage::TfaXarth as i32),
    );

    client
        .execute("DELETE FROM challenges WHERE uuid = $1", &[&uuid])
        .await
        .expect("challenge cleanup");
    client
        .execute("DELETE FROM players WHERE id = ANY($1)", &[&player_ids])
        .await
        .expect("player cleanup");
    client
        .execute(
            "DELETE FROM challenge_sessions WHERE uuid = $1",
            &[&info.session_uuid],
        )
        .await
        .expect("session cleanup");
    client
        .execute(
            "DELETE FROM effect_events WHERE key LIKE $1",
            &[&format!("{uuid}%")],
        )
        .await
        .expect("outbox cleanup");
}

async fn verify_xarth_stage_rows(
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
    assert_eq!(row.get::<_, i16>(0), ChallengeType::Tfa as i16);
    assert_eq!(row.get::<_, i16>(1), ChallengeMode::NoMode as i16);
    assert_eq!(row.get::<_, i16>(2), 4);
    assert_eq!(row.get::<_, i16>(3), Stage::TfaXarth as i16);
    assert_eq!(row.get::<_, i16>(4), ChallengeStatus::InProgress as i16);
    assert_eq!(row.get::<_, i32>(5), 311);
    assert_eq!(row.get::<_, i32>(6), 3);
    assert_eq!(
        row.get::<_, std::time::SystemTime>(7),
        UNIX_EPOCH + Duration::from_millis(GUARDIAN_CREATED_UNIX_MS),
    );

    let rows = client
        .query(
            "SELECT player_id, username, orb, primary_gear, stage_deaths FROM challenge_players
             WHERE challenge_id = $1 ORDER BY orb",
            &[&challenge_id],
        )
        .await
        .expect("membership rows");
    assert_eq!(
        rows.iter()
            .map(|row| (
                row.get::<_, i32>(0),
                row.get::<_, &str>(1),
                row.get::<_, i16>(2),
                row.get::<_, i16>(3),
                row.get::<_, Vec<i16>>(4),
            ))
            .collect::<Vec<_>>(),
        vec![
            (
                player_ids[0],
                "player1",
                0,
                PrimaryMeleeGear::Blorva as i16,
                vec![Stage::TfaXarth as i16],
            ),
            (
                player_ids[1],
                "player2",
                1,
                PrimaryMeleeGear::Unknown as i16,
                vec![Stage::TfaXarth as i16],
            ),
            (
                player_ids[2],
                "player3",
                2,
                PrimaryMeleeGear::Unknown as i16,
                Vec::new(),
            ),
            (
                player_ids[3],
                "player4",
                3,
                PrimaryMeleeGear::Unknown as i16,
                vec![Stage::TfaXarth as i16],
            ),
        ],
    );

    let row = client
        .query_one(
            "SELECT route, xarth_deaths, xarth_corpses_leaked, xarth_corpses_ignored,
                    xarth_corpses_doused, xarth_p2_blasts
             FROM tfa_challenge_stats WHERE challenge_id = $1",
            &[&challenge_id],
        )
        .await
        .expect("stats row");
    assert_eq!(row.get::<_, Option<i16>>(0), None);
    assert_eq!(row.get::<_, Option<i32>>(1), Some(3));
    assert_eq!(row.get::<_, Option<i16>>(2), Some(3));
    assert_eq!(row.get::<_, Option<i16>>(3), Some(2));
    assert_eq!(row.get::<_, Option<i16>>(4), Some(0));
    assert_eq!(row.get::<_, Option<i16>>(5), Some(1));

    let splits = client
        .query(
            "SELECT type, scale, ticks, accurate FROM challenge_splits
             WHERE challenge_id = $1 ORDER BY type",
            &[&challenge_id],
        )
        .await
        .expect("split rows");
    assert_eq!(
        splits
            .iter()
            .map(|row| (
                row.get::<_, i16>(0),
                row.get::<_, i16>(1),
                row.get::<_, i32>(2),
                row.get::<_, bool>(3),
            ))
            .collect::<Vec<_>>(),
        vec![(SplitType::TfaXarth as i16, 4, 311, true)],
    );

    let pbs = client
        .query(
            "SELECT p.player_id, s.type FROM personal_best_history p
             JOIN challenge_splits s ON s.id = p.challenge_split_id
             WHERE s.challenge_id = $1 ORDER BY p.player_id, s.type",
            &[&challenge_id],
        )
        .await
        .expect("pb rows");
    assert_eq!(
        pbs.iter()
            .map(|row| (row.get::<_, i32>(0), row.get::<_, i16>(1)))
            .collect::<Vec<_>>(),
        player_ids
            .iter()
            .map(|&player| (player, SplitType::TfaXarth as i16))
            .collect::<Vec<_>>(),
    );

    let stats = client
        .query_one(
            "SELECT count(*) FROM player_stats WHERE player_id = ANY($1)",
            &[&player_ids],
        )
        .await
        .expect("player stats");
    assert_eq!(stats.get::<_, i64>(0), 0);

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
            (event::Type::PlayerAttack as i16, 209),
            (event::Type::PlayerSpell as i16, 6),
            (event::Type::PlayerDeath as i16, 3),
            (event::Type::NpcSpawn as i16, 22),
            (event::Type::NpcDeath as i16, 22),
            (event::Type::NpcAttack as i16, 78),
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
    assert_eq!(row.get::<_, Option<i32>>(2), Some(311));
    row.get::<_, Option<serde_json::Value>>(3)
        .expect("custom data present")
}

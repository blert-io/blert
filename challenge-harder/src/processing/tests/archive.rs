//! Fractured Archive processing.

use std::sync::Arc;

use blert::Rsn;

use crate::lifecycle::core::state::Trigger;
use crate::lifecycle::core::types::{
    ChallengeInfo, ChallengeMode, ChallengeStatus, ChallengeType, JournalSeq, OverallTicks,
    ProcessingPayload, ServerTicks, Stage, Uuid,
};
use crate::price::PriceResolver;
use crate::processing::{Pipeline, ProcessingRequest, ProcessorConfig, StageProcessor, db};
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

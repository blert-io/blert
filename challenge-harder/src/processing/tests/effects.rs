//! Checks effect writes from a processing run.

use crate::lifecycle::core::state::Trigger;
use crate::lifecycle::core::types::{JournalSeq, ProcessingPayload, Stage, Uuid};
use crate::processing::db;
use crate::processing::effects::{Event, emit};

async fn insert_challenge(db: &db::Postgres, uuid: Uuid) {
    let client = db.checkout().await.expect("client");
    client
        .execute(
            "INSERT INTO challenges (uuid, type, scale) VALUES ($1, $2, $3)",
            &[&uuid, &1_i16, &1_i16],
        )
        .await
        .expect("fixture challenge insert");
}

/// Returns the outbox rows for a challenge, as `(kind, key, subject)`.
async fn events_for(db: &db::Postgres, uuid: Uuid) -> Vec<(i16, String, serde_json::Value)> {
    let client = db.checkout().await.expect("client");
    client
        .query(
            "SELECT kind, key, subject FROM effect_events
             WHERE key LIKE $1 ORDER BY id",
            &[&format!("{uuid}%")],
        )
        .await
        .expect("outbox query")
        .iter()
        .map(|row| (row.get(0), row.get(1), row.get(2)))
        .collect()
}

#[tokio::test]
async fn finish_writes_a_finish_event() {
    let Some(db) = db::test_database().await else {
        return;
    };
    let uuid = Uuid::new_v4();
    insert_challenge(&db, uuid).await;

    let txn = db
        .start_transaction(uuid, Trigger::Create { seq: JournalSeq(1) })
        .await
        .expect("transaction");
    emit(&txn, &Event::ChallengeFinished { uuid })
        .await
        .expect("emit should succeed");
    txn.commit(&ProcessingPayload::None, None)
        .await
        .expect("commit");

    let events = events_for(&db, uuid).await;
    assert_eq!(
        events,
        vec![(
            0,
            uuid.to_string(),
            serde_json::json!({ "uuid": uuid.to_string() }),
        )]
    );
}

#[tokio::test]
async fn each_stage_finish_writes_a_stage_event() {
    let Some(db) = db::test_database().await else {
        return;
    };
    let uuid = Uuid::new_v4();
    insert_challenge(&db, uuid).await;

    let txn = db
        .start_transaction(uuid, Trigger::Create { seq: JournalSeq(1) })
        .await
        .expect("transaction");
    for (stage, attempt) in [
        (Stage::MokhaiotlDelve7, None),
        (Stage::MokhaiotlDelve8, None),
        (Stage::MokhaiotlDelve8plus, Some(1)),
        (Stage::MokhaiotlDelve8plus, Some(2)),
    ] {
        emit(
            &txn,
            &Event::StageFinished {
                uuid,
                stage,
                attempt,
            },
        )
        .await
        .expect("emit should succeed");
    }
    txn.commit(&ProcessingPayload::None, None)
        .await
        .expect("commit");

    let events = events_for(&db, uuid).await;
    let keys: Vec<&str> = events.iter().map(|(_, key, _)| key.as_str()).collect();
    assert_eq!(
        keys,
        vec![
            format!("{uuid}:{}", Stage::MokhaiotlDelve7 as i32),
            format!("{uuid}:{}", Stage::MokhaiotlDelve8 as i32),
            format!("{uuid}:{}:1", Stage::MokhaiotlDelve8plus as i32),
            format!("{uuid}:{}:2", Stage::MokhaiotlDelve8plus as i32),
        ]
    );
    assert!(events.iter().all(|(kind, _, _)| *kind == 1));
    assert_eq!(
        events[0].2,
        serde_json::json!({
            "uuid": uuid.to_string(),
            "stage": Stage::MokhaiotlDelve7 as i32,
            "attempt": null,
        })
    );
}

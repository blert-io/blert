//! Test fixture processing and verification.
//!
//! Fixtures exist under `tests/fixtures/` and are recordings of real stages.

use std::sync::LazyLock;

use serde::Deserialize;

use crate::lifecycle::core::types::{ClientStageStream, Stage, StageUpdate, Uuid};

mod colosseum;
mod effects;
mod finish;
mod golden;
mod inferno;
mod mokhaiotl;
mod theatre;

// All fixture tests share the same database and write the same rows, so they
// need to be serialized behind a lock.
static FIXTURE_TESTS: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    raw_events: Vec<FixtureRecord>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureRecord {
    r#type: u8,
    client_id: i64,
    user_id: Option<i64>,
    plugin_version: Option<String>,
    rune_lite_version: Option<String>,
    update: Option<StageUpdate>,
    #[serde(default)]
    events: Vec<u8>,
}

fn load_fixture(name: &str) -> Vec<FixtureRecord> {
    let path = format!(
        "{}/tests/fixtures/{name}.json.gz",
        env!("CARGO_MANIFEST_DIR"),
    );
    let file = std::fs::File::open(path).expect("fixture file exists");
    let fixture: Fixture =
        serde_json::from_reader(flate2::read::GzDecoder::new(file)).expect("fixture deserializes");
    fixture.raw_events
}

/// Loads a stage stream fixture into Redis.
async fn prepare_fixture(uuid: Uuid, stage: Stage, records: &[FixtureRecord]) {
    let uri = std::env::var("BLERT_TEST_REDIS_URI").expect("checked by test_store");
    let mut connection = redis::Client::open(uri)
        .expect("valid redis uri")
        .get_multiplexed_async_connection()
        .await
        .expect("test redis unreachable");

    let key = format!("challenge-events:{uuid}:{}", stage as i32);
    let _: () = redis::cmd("DEL")
        .arg(&key)
        .query_async(&mut connection)
        .await
        .expect("stream cleared");

    for record in records {
        let mut fields: Vec<(&str, Vec<u8>)> = vec![
            ("type", record.r#type.to_string().into_bytes()),
            ("clientId", record.client_id.to_string().into_bytes()),
        ];
        match record.r#type {
            ClientStageStream::EVENTS_TAG => {
                fields.push(("events", record.events.clone()));
            }
            ClientStageStream::STAGE_END_TAG => {
                let update = record
                    .update
                    .as_ref()
                    .expect("end record should have an update");
                fields.push((
                    "update",
                    serde_json::to_vec(update).expect("update serializes"),
                ));
            }
            ClientStageStream::METADATA_TAG => {
                let user_id = record.user_id.expect("metadata record should have a user");
                fields.push(("userId", user_id.to_string().into_bytes()));
                let plugin = record
                    .plugin_version
                    .clone()
                    .expect("metadata record should have a plugin");
                fields.push(("pluginVersion", plugin.into_bytes()));
                let runelite = record
                    .rune_lite_version
                    .clone()
                    .expect("metadata record should have a RuneLite version");
                fields.push(("runeLiteVersion", runelite.into_bytes()));
            }
            other => panic!("unknown record type {other}"),
        }

        let mut cmd = redis::cmd("XADD");
        cmd.arg(&key).arg("*");
        for (name, value) in &fields {
            cmd.arg(*name).arg(value.as_slice());
        }
        let _: String = cmd
            .query_async(&mut connection)
            .await
            .expect("record written");
    }
}

//! Test fixture processing and verification.
//!
//! Fixtures exist under `tests/fixtures/` and are recordings of real stages.
#![allow(clippy::too_many_lines)]

use std::io::Read;
use std::sync::LazyLock;

use deadpool_postgres::Object;

use crate::lifecycle::core::types::{ClientStageStream, Stage, Uuid};
use crate::merging::MergeCapture;
use crate::repository::DataRepository;

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

fn load_fixture(name: &str) -> Vec<ClientStageStream> {
    let path = format!(
        "{}/tests/fixtures/{name}.json.gz",
        env!("CARGO_MANIFEST_DIR"),
    );
    let file = std::fs::File::open(path).expect("fixture file exists");
    let mut contents = Vec::new();
    flate2::read::GzDecoder::new(file)
        .read_to_end(&mut contents)
        .expect("fixture decompresses");
    MergeCapture::decode(&contents)
        .expect("fixture is a capture")
        .records
}

/// Loads a stage stream fixture into Redis.
async fn prepare_fixture(uuid: Uuid, stage: Stage, records: &[ClientStageStream]) {
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
        let mut fields: Vec<(&str, Vec<u8>)> =
            vec![("clientId", record.client_id().0.to_string().into_bytes())];
        match record {
            ClientStageStream::Events { events, .. } => {
                fields.push((
                    "type",
                    ClientStageStream::EVENTS_TAG.to_string().into_bytes(),
                ));
                fields.push(("events", events.to_vec()));
            }
            ClientStageStream::End { update, .. } => {
                fields.push((
                    "type",
                    ClientStageStream::STAGE_END_TAG.to_string().into_bytes(),
                ));
                fields.push((
                    "update",
                    serde_json::to_vec(update).expect("update serializes"),
                ));
            }
            ClientStageStream::Metadata {
                user_id,
                plugin_version,
                runelite_version,
                ..
            } => {
                fields.push((
                    "type",
                    ClientStageStream::METADATA_TAG.to_string().into_bytes(),
                ));
                fields.push(("userId", user_id.0.to_string().into_bytes()));
                fields.push(("pluginVersion", plugin_version.clone().into_bytes()));
                fields.push(("runeLiteVersion", runelite_version.clone().into_bytes()));
            }
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

async fn merge_report_rows(client: &Object, challenge_id: i32, stage: Stage) -> serde_json::Value {
    client
        .query_one(
            "SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'merge', to_jsonb(m) - 'id' - 'challenge_id' - 'created_at',
                 'clients', (
                     SELECT COALESCE(jsonb_agg(to_jsonb(c) - 'id' - 'merge_id'
                                               ORDER BY c.client_id), '[]'::jsonb)
                     FROM challenge_merge_clients c WHERE c.merge_id = m.id
                 )
             ) ORDER BY m.id), '[]'::jsonb)
             FROM challenge_stage_merges m WHERE m.challenge_id = $1 AND m.stage = $2",
            &[&challenge_id, &(stage as i16)],
        )
        .await
        .expect("merge report rows")
        .get(0)
}

async fn capture_file(repository: &DataRepository, uuid: Uuid, stage: Stage) -> String {
    let contents = repository
        .load_file(&format!(
            "merge-captures/{uuid}:{}_events.json",
            stage as i32
        ))
        .await
        .expect("capture file");
    String::from_utf8(contents).expect("capture is utf-8")
}

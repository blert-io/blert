//! Utilities for checking and updating golden test files.

use std::path::PathBuf;
use std::sync::LazyLock;

use blert::golden::assert_golden;
use blert::proto::Event;
use prost_reflect::{DescriptorPool, DynamicMessage};

use crate::proto::ChallengeData;

static DESCRIPTOR_POOL: LazyLock<DescriptorPool> = LazyLock::new(|| {
    DescriptorPool::decode(
        include_bytes!(concat!(env!("OUT_DIR"), "/blert_descriptor.bin")).as_slice(),
    )
    .expect("descriptor pool decodes")
});

/// Compares a stage scenario's output artifacts against its golden files.
///
/// If the `UPDATE_GOLDEN` environment variable is set to `name`, or `all` for
/// all tests, the output is written to the golden files.
pub(super) fn assert_stage_artifacts(
    name: &str,
    custom_data: &serde_json::Value,
    challenge: &ChallengeData,
    events: &[Event],
    merge_report: &serde_json::Value,
    capture: &str,
) {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden/processing");
    assert_golden(
        name,
        &dir.join(format!("{name}_custom_data.json.gz")),
        &serde_json::to_string_pretty(custom_data).expect("custom data serializes"),
    );
    assert_golden(
        name,
        &dir.join(format!("{name}_merge_report.json.gz")),
        &serde_json::to_string_pretty(merge_report).expect("merge report rows serialize"),
    );
    assert_golden(name, &dir.join(format!("{name}_capture.json.gz")), capture);
    assert_golden(
        name,
        &dir.join(format!("{name}_challenge.json.gz")),
        &serde_json::to_string_pretty(&proto_json("blert.ChallengeData", challenge))
            .expect("challenge data serializes"),
    );
    let events = events
        .iter()
        .map(|event| proto_json("blert.Event", event).to_string())
        .collect::<Vec<_>>()
        .join("\n");
    assert_golden(name, &dir.join(format!("{name}_events.jsonl.gz")), &events);
}

/// Renders a proto message as canonical JSON.
fn proto_json<M: prost::Message>(full_name: &str, message: &M) -> serde_json::Value {
    let descriptor = DESCRIPTOR_POOL
        .get_message_by_name(full_name)
        .expect("message descriptor exists");
    let dynamic = DynamicMessage::decode(descriptor, message.encode_to_vec().as_slice())
        .expect("message re-decodes");
    serde_json::to_value(&dynamic).expect("message serializes")
}

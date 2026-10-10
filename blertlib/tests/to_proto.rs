use std::collections::BTreeMap;
use std::fs::File;
use std::io::Read;
use std::path::PathBuf;
use std::sync::LazyLock;

use blert::golden::assert_golden;
use blert::{
    ChallengeMode, ClientId, Mokhaiotl, NpcProperties, RecordingBuilder, Rsn, Stage, Tick,
    TickState, Timeline, proto,
};
use flate2::read::GzDecoder;
use prost::Message;
use prost_reflect::{DescriptorPool, DynamicMessage};
use serde::Deserialize;

static DESCRIPTOR_POOL: LazyLock<DescriptorPool> = LazyLock::new(|| {
    DescriptorPool::decode(
        include_bytes!(concat!(env!("OUT_DIR"), "/blert_descriptor.bin")).as_slice(),
    )
    .expect("descriptor pool decodes")
});

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Capture {
    challenge_info: ChallengeInfo,
    stage: i32,
    raw_events: Vec<Record>,
}

#[derive(Deserialize)]
struct ChallengeInfo {
    mode: i32,
    party: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    client_id: u32,
    events: Option<Vec<u8>>,
    update: Option<StageUpdate>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StageUpdate {
    recorded_ticks: u32,
}

struct Fixture {
    name: &'static str,
    stage: Stage,
    mode: ChallengeMode,
    party: Vec<Rsn>,
    clients: BTreeMap<ClientId, Client>,
}

#[derive(Default)]
struct Client {
    batches: Vec<Vec<proto::Event>>,
    last_tick: Option<Tick>,
}

impl Fixture {
    fn load(name: &'static str) -> Self {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(format!("{name}.json.gz"));
        let mut contents = String::new();
        GzDecoder::new(File::open(path).expect("fixture exists"))
            .read_to_string(&mut contents)
            .expect("fixture decompresses");
        let capture: Capture = serde_json::from_str(&contents).expect("fixture is a capture");

        let mut clients = BTreeMap::<ClientId, Client>::new();
        for record in capture.raw_events {
            let client = clients.entry(ClientId(record.client_id)).or_default();
            if let Some(events) = record.events {
                let batch = proto::EventStream::decode(events.as_slice()).expect("batch decodes");
                client.batches.push(batch.events);
            }
            if let Some(update) = record.update {
                client.last_tick = Some(Tick(update.recorded_ticks));
            }
        }

        Self {
            name,
            stage: Stage::try_from(capture.stage).expect("stage is known"),
            mode: ChallengeMode::try_from(capture.challenge_info.mode).expect("mode is known"),
            party: capture
                .challenge_info
                .party
                .into_iter()
                .map(|name| Rsn::try_from(name).expect("party name is valid"))
                .collect(),
            clients,
        }
    }
}

fn proto_json(event: &proto::Event) -> serde_json::Value {
    let descriptor = DESCRIPTOR_POOL
        .get_message_by_name("blert.Event")
        .expect("event descriptor exists");
    let dynamic = DynamicMessage::decode(descriptor, event.encode_to_vec().as_slice())
        .expect("event decodes");
    serde_json::to_value(&dynamic).expect("event serializes")
}

fn assert_golden_output(fixture: &Fixture) {
    for (client_id, client) in &fixture.clients {
        let mut builder = RecordingBuilder::new(
            *client_id,
            fixture.stage,
            fixture.mode,
            fixture.party.clone(),
            client.last_tick,
        );
        for batch in &client.batches {
            builder.ingest(batch.iter().cloned());
        }
        let timeline = builder
            .into_recording()
            .expect("fixture has events")
            .finalize();

        let output = timeline
            .to_proto()
            .map(|event| proto_json(&event).to_string())
            .collect::<Vec<_>>()
            .join("\n");
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/golden")
            .join(format!("{}_client{client_id}.jsonl.gz", fixture.name));
        assert_golden(fixture.name, &path, &output);
    }
}

fn assert_refresh_matches_snapshot(fixture: &Fixture) {
    for (client_id, client) in &fixture.clients {
        let mut builder = RecordingBuilder::new(
            *client_id,
            fixture.stage,
            fixture.mode,
            fixture.party.clone(),
            None,
        );
        let mut timeline: Option<Timeline> = None;
        for batch in &client.batches {
            let Some(changed) = builder.ingest(batch.iter().cloned()) else {
                continue;
            };
            let recording = builder.recording().expect("exists after ingest");
            match &mut timeline {
                Some(timeline) => timeline.refresh(recording, changed),
                None => timeline = Some(recording.snapshot()),
            }
        }

        let refreshed = timeline.expect("fixture has events");
        let snapshot = builder.recording().expect("fixture has events").snapshot();
        assert_eq!(
            refreshed.npcs().collect::<Vec<_>>(),
            snapshot.npcs().collect::<Vec<_>>(),
            "client {client_id}"
        );

        let refreshed = refreshed.to_proto().collect::<Vec<_>>();
        let snapshot = snapshot.to_proto().collect::<Vec<_>>();
        for (refreshed, snapshot) in refreshed
            .chunk_by(|a, b| a.tick == b.tick)
            .zip(snapshot.chunk_by(|a, b| a.tick == b.tick))
        {
            assert_eq!(
                refreshed, snapshot,
                "client {client_id} diverges on tick {}",
                snapshot[0].tick
            );
        }
        assert_eq!(refreshed.len(), snapshot.len(), "client {client_id}");
    }
}

fn mokhaiotl_charging(state: &TickState) -> bool {
    state
        .npcs
        .values()
        .find_map(|npc| match npc.properties {
            Some(NpcProperties::Mokhaiotl(Mokhaiotl { charging })) => Some(charging),
            _ => None,
        })
        .expect("mokhaiotl has properties")
}

#[test]
fn tob_maiden() {
    let fixture = Fixture::load("tob_maiden");
    assert_golden_output(&fixture);
    assert_refresh_matches_snapshot(&fixture);
}

#[test]
fn tob_bloat() {
    let fixture = Fixture::load("tob_bloat");
    assert_golden_output(&fixture);
    assert_refresh_matches_snapshot(&fixture);
}

#[test]
fn tob_nylocas() {
    let fixture = Fixture::load("tob_nylocas");
    assert_golden_output(&fixture);
    assert_refresh_matches_snapshot(&fixture);
}

#[test]
fn tob_sotetseg() {
    let fixture = Fixture::load("tob_sotetseg");
    assert_golden_output(&fixture);
    assert_refresh_matches_snapshot(&fixture);
}

#[test]
fn tob_xarpus() {
    let fixture = Fixture::load("tob_xarpus");
    assert_golden_output(&fixture);
    assert_refresh_matches_snapshot(&fixture);
}

#[test]
fn tob_verzik() {
    let fixture = Fixture::load("tob_verzik");
    assert_golden_output(&fixture);
    assert_refresh_matches_snapshot(&fixture);
}

#[test]
fn colosseum_wave_9() {
    let fixture = Fixture::load("colosseum_wave_9");
    assert_golden_output(&fixture);
    assert_refresh_matches_snapshot(&fixture);
}

#[test]
fn colosseum_wave_12() {
    let fixture = Fixture::load("colosseum_wave_12");
    assert_golden_output(&fixture);
    assert_refresh_matches_snapshot(&fixture);
}

#[test]
fn inferno_wave_47() {
    let fixture = Fixture::load("inferno_wave_47");
    assert_golden_output(&fixture);
    assert_refresh_matches_snapshot(&fixture);
}

#[test]
fn mokhaiotl_delve_8() {
    let fixture = Fixture::load("mokhaiotl_delve_8");
    assert_golden_output(&fixture);
    assert_refresh_matches_snapshot(&fixture);

    let (&client_id, client) = fixture
        .clients
        .first_key_value()
        .expect("fixture has a client");
    let mut builder = RecordingBuilder::new(
        client_id,
        fixture.stage,
        fixture.mode,
        fixture.party.clone(),
        None,
    );
    let mut refreshed: Option<Timeline> = None;
    for batch in &client.batches {
        let Some(changed) = builder.ingest(batch.iter().cloned()) else {
            continue;
        };
        let recording = builder.recording().expect("exists after ingest");
        match &mut refreshed {
            Some(timeline) => timeline.refresh(recording, changed),
            None => refreshed = Some(recording.snapshot()),
        }
    }
    let refreshed = refreshed.expect("fixture has events");
    let snapshot = builder.recording().expect("fixture has events").snapshot();

    let charge = [
        false, true, true, true, true, true, true, true, true, true, false,
    ];
    for timeline in [&snapshot, &refreshed] {
        let charging: Vec<_> = Tick(12)
            .through(Tick(22))
            .map(|tick| mokhaiotl_charging(timeline.get_state(tick).expect("tick has state")))
            .collect();
        assert_eq!(charging, charge);
    }
}

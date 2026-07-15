//! End-to-end smoke of the replay engine, driving the built binary through
//! boot, a played window, and drain. Requires `BLERT_TEST_REDIS_URI`.

use std::process::Command;
use std::sync::{Mutex, MutexGuard, PoisonError};

/// Serializes the replay tests as they share a Redis instance.
fn lock() -> MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A minimal, whole challenge.
const WINDOW: &str = concat!(
    r#"{"ts":1000,"op":"start","host":"sock-a","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":10,"userId":20,"request":{"userId":20,"clientId":10,"sessionToken":"tok-smoke","pluginVersion":"0.0.0","runeLiteVersion":"0.0.0","type":1,"mode":11,"party":["Skitter"],"stage":12,"recordingType":0},"http":{"ok":true,"statusCode":200,"response":{"uuid":"11111111-1111-1111-1111-111111111111","mode":11,"stage":12,"stageAttempt":null}}}"#,
    "\n",
    r#"{"ts":1500,"op":"update","host":"sock-a","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":10,"userId":20,"request":{"userId":20,"clientId":10,"sessionToken":"tok-smoke","update":{"stage":{"stage":12,"status":1}}},"http":{"ok":true,"statusCode":200,"response":{"uuid":"11111111-1111-1111-1111-111111111111","mode":11,"stage":12,"stageAttempt":null}}}"#,
    "\n",
    r#"{"ts":2500,"op":"finish","host":"sock-a","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":10,"userId":20,"request":{"userId":20,"clientId":10,"sessionToken":"tok-smoke","times":null,"soft":true},"http":{"ok":true,"statusCode":200,"response":null}}"#,
    "\n",
    r#"{"ts":3000,"op":"server-update","host":"sock-a","challengeUuid":"11111111-1111-1111-1111-111111111111","clientId":null,"userId":null,"request":{"id":"11111111-1111-1111-1111-111111111111","action":"FINISH"},"http":null}"#,
    "\n",
);

#[test]
fn replay_plays_a_window_end_to_end() {
    let Ok(redis) = std::env::var("BLERT_TEST_REDIS_URI") else {
        eprintln!("BLERT_TEST_REDIS_URI is not set; skipping replay smoke");
        return;
    };
    let _lock = lock();

    let scratch = std::env::temp_dir().join(format!("blert-replay-smoke-{}", std::process::id()));
    std::fs::create_dir_all(&scratch).expect("scratch dir");
    let window = scratch.join("window.jsonl");
    std::fs::write(&window, WINDOW).expect("window fixture");

    let output = Command::new(env!("CARGO_BIN_EXE_challenge-harder"))
        .args(["shadow", "replay"])
        .arg(&window)
        .args(["--redis", &redis, "--time-scale", "20", "--out"])
        .arg(&scratch)
        .output()
        .expect("driver runs");

    assert!(
        output.status.success(),
        "driver failed\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );

    let run_dir = std::fs::read_dir(&scratch)
        .expect("scratch dir listing")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| path.is_dir())
        .expect("run directory created");

    // Every command was accepted by the server, with the challenge mapped.
    let commands =
        std::fs::read_to_string(run_dir.join("commands.jsonl")).expect("commands written");
    let lines: Vec<serde_json::Value> = commands
        .lines()
        .map(|line| serde_json::from_str(line).expect("command line parses"))
        .collect();
    assert_eq!(lines.len(), 3, "{commands}");
    for line in &lines {
        assert_eq!(line["status"], 200, "{line}");
    }
    assert_eq!(lines[0]["op"], "start", "{commands}");
    assert_eq!(lines[0]["mapping"], "new", "{commands}");
    assert_eq!(lines[1]["mapping"], "match", "{commands}");

    let remap: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(run_dir.join("remap.json")).expect("remap written"),
    )
    .expect("remap parses");
    let replayed = remap["11111111-1111-1111-1111-111111111111"]
        .as_str()
        .expect("challenge was mapped");
    assert_eq!(lines[0]["response"]["uuid"], replayed, "{remap}");

    // The FINISH announcement arrived on the async channel after the finish
    // command was accepted.
    let pubsub = std::fs::read_to_string(run_dir.join("pubsub.jsonl")).expect("pubsub written");
    let announcements: Vec<serde_json::Value> = pubsub
        .lines()
        .map(|line| serde_json::from_str(line).expect("announcement line parses"))
        .collect();
    assert_eq!(announcements.len(), 1, "{pubsub}");
    assert_eq!(announcements[0]["payload"]["action"], "FINISH", "{pubsub}");
    assert_eq!(announcements[0]["payload"]["id"], replayed, "{pubsub}");
    assert!(
        announcements[0]["offsetMs"].as_f64() >= lines[2]["sentMs"].as_f64(),
        "{pubsub}",
    );

    let journal =
        std::fs::read_to_string(run_dir.join("journals").join(format!("{replayed}.jsonl")))
            .expect("journal dumped");
    for line in journal.lines() {
        let _: serde_json::Value = serde_json::from_str(line).expect("journal entry parses");
    }
    assert!(journal.contains("ChallengeCreated"), "{journal}");
    assert!(journal.contains("ChallengeTerminated"), "{journal}");

    let summary = std::fs::read_to_string(run_dir.join("summary.json")).expect("summary written");
    assert!(summary.contains(r#""commands": 3"#), "{summary}");
    assert!(summary.contains(r#""incomplete": []"#), "{summary}");
    assert!(summary.contains(r#""gracefulShutdown": true"#), "{summary}");

    let log = std::fs::read_to_string(run_dir.join("server.log")).expect("server log written");
    assert!(log.contains("challenge_server_listening"), "{log}");

    // The differ reads the run back and finds nothing to report.
    let diff = Command::new(env!("CARGO_BIN_EXE_challenge-harder"))
        .args(["shadow", "diff"])
        .arg(&window)
        .arg(&run_dir)
        .output()
        .expect("differ runs");
    let stdout = String::from_utf8_lossy(&diff.stdout);
    assert!(
        diff.status.success(),
        "differ failed\nstdout: {stdout}\nstderr: {}",
        String::from_utf8_lossy(&diff.stderr),
    );
    assert!(stdout.contains("DIVERGENCES\n  (none)"), "{stdout}");
    assert!(stdout.contains("finished 1 (100%)"), "{stdout}");
    let divergences =
        std::fs::read_to_string(run_dir.join("divergences.jsonl")).expect("divergences written");
    assert_eq!(divergences, "", "{divergences}");

    std::fs::remove_dir_all(&scratch).ok();
}

/// A challenge whose only client disconnects. Its reconnected socket then
/// sends a finish under a fresh session token without rejoining;
/// the challenge ends through the reconnection window.
const DISCONNECT_WINDOW: &str = concat!(
    r#"{"ts":1000,"op":"start","host":"sock-a","challengeUuid":"22222222-2222-2222-2222-222222222222","clientId":11,"userId":21,"request":{"userId":21,"clientId":11,"sessionToken":"tok-gone","pluginVersion":"0.0.0","runeLiteVersion":"0.0.0","type":1,"mode":11,"party":["Skitter"],"stage":12,"recordingType":0},"http":{"ok":true,"statusCode":200,"response":{"uuid":"22222222-2222-2222-2222-222222222222"}}}"#,
    "\n",
    r#"{"ts":2000,"op":"status","host":"sock-a","challengeUuid":"22222222-2222-2222-2222-222222222222","clientId":11,"userId":21,"request":{"type":0,"userId":21,"clientId":11,"sessionToken":"tok-gone","status":2},"http":null}"#,
    "\n",
    r#"{"ts":2500,"op":"finish","host":"sock-a","challengeUuid":"22222222-2222-2222-2222-222222222222","clientId":11,"userId":21,"request":{"userId":21,"clientId":11,"sessionToken":"tok-back","times":null,"soft":true},"http":{"ok":true,"statusCode":200,"response":null}}"#,
    "\n",
    r#"{"ts":3000,"op":"server-update","host":"sock-a","challengeUuid":"22222222-2222-2222-2222-222222222222","clientId":null,"userId":null,"request":{"id":"22222222-2222-2222-2222-222222222222","action":"FINISH"},"http":null}"#,
    "\n",
);

#[test]
fn replay_waits_out_a_disconnect_ended_challenge() {
    let Ok(redis) = std::env::var("BLERT_TEST_REDIS_URI") else {
        eprintln!("BLERT_TEST_REDIS_URI is not set; skipping replay smoke");
        return;
    };
    let _lock = lock();

    let scratch =
        std::env::temp_dir().join(format!("blert-replay-disconnect-{}", std::process::id(),));
    std::fs::create_dir_all(&scratch).expect("scratch dir");
    let window = scratch.join("window.jsonl");
    std::fs::write(&window, DISCONNECT_WINDOW).expect("window fixture");

    let output = Command::new(env!("CARGO_BIN_EXE_challenge-harder"))
        .args(["shadow", "replay"])
        .arg(&window)
        .args(["--redis", &redis, "--time-scale", "20", "--out"])
        .arg(&scratch)
        .output()
        .expect("driver runs");

    assert!(
        output.status.success(),
        "driver failed\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );

    let run_dir = std::fs::read_dir(&scratch)
        .expect("scratch dir listing")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| path.is_dir())
        .expect("run directory created");

    let summary = std::fs::read_to_string(run_dir.join("summary.json")).expect("summary written");
    assert!(summary.contains(r#""incomplete": []"#), "{summary}");
    assert!(summary.contains(r#""gracefulShutdown": true"#), "{summary}");

    // The finish was accepted and ignored.
    let commands =
        std::fs::read_to_string(run_dir.join("commands.jsonl")).expect("commands written");
    let lines: Vec<serde_json::Value> = commands
        .lines()
        .map(|line| serde_json::from_str(line).expect("command line parses"))
        .collect();
    assert_eq!(lines.len(), 3, "{commands}");
    for line in &lines {
        assert_eq!(line["status"], 200, "{line}");
    }
    let log = std::fs::read_to_string(run_dir.join("server.log")).expect("server log written");
    assert!(!log.contains("panicked"), "{log}");

    let pubsub = std::fs::read_to_string(run_dir.join("pubsub.jsonl")).expect("pubsub written");
    let announcements: Vec<serde_json::Value> = pubsub
        .lines()
        .map(|line| serde_json::from_str(line).expect("announcement line parses"))
        .collect();
    assert_eq!(announcements.len(), 1, "{pubsub}");
    assert_eq!(announcements[0]["payload"]["action"], "FINISH", "{pubsub}");

    std::fs::remove_dir_all(&scratch).ok();
}

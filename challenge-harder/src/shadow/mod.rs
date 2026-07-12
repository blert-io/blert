//! The shadow harness. Replays captured production traffic against this
//! build of the server and diffs its decisions against the old server's
//! recorded ones.

mod capture;
mod remap;
mod replay;
mod schedule;
mod server;

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::Subcommand;
use serde_json::{Value, json};

use crate::lifecycle::core::deadline::LifecycleConfig;
use capture::{Capture, Census};
use remap::Mapping;
use replay::{Event, ReplayResult};

/// Shadow harness tools.
#[derive(Subcommand)]
pub enum Command {
    /// Run the server under test with scaled lifecycle windows.
    Serve {
        /// Divide every temporal window for accelerated replay.
        #[arg(long, default_value_t = 1,
              value_parser = clap::value_parser!(u32).range(1..))]
        time_scale: u32,
    },
    /// Replay a captured socket server recording against a server under test.
    Replay {
        /// Path to the capture file.
        capture: PathBuf,
        /// Scratch Redis URI. Must name a dedicated database, which is
        /// flushed at the start of the run.
        #[arg(long)]
        redis: String,
        /// Divides every lifecycle window and inter-command delta.
        #[arg(long, default_value_t = 1,
              value_parser = clap::value_parser!(u32).range(1..))]
        time_scale: u32,
        /// Directory to which to write run artifacts.
        #[arg(long, default_value = ".data/shadow")]
        out: PathBuf,
    },
    /// Summarize capture windows.
    Census {
        /// Verify that capture files hold required invariants.
        #[arg(long)]
        check: bool,
        /// List of capture files to inspect.
        #[arg(required = true)]
        captures: Vec<PathBuf>,
    },
}

pub async fn run(command: Command) -> ExitCode {
    match command {
        Command::Serve { time_scale } => {
            crate::serve(LifecycleConfig::default().scaled(time_scale)).await;
            ExitCode::SUCCESS
        }
        Command::Replay {
            capture,
            redis,
            time_scale,
            out,
        } => replay_command(&capture, &redis, time_scale, &out).await,
        Command::Census { check, captures } => census(check, &captures),
    }
}

async fn replay_command(
    capture_path: &Path,
    redis_uri: &str,
    time_scale: u32,
    out: &Path,
) -> ExitCode {
    let capture = match Capture::load(capture_path) {
        Ok(capture) => capture,
        Err(e) => {
            eprintln!("{}", error_chain(&e));
            return ExitCode::FAILURE;
        }
    };
    let census = Census::of(&capture.records);
    print_census(&capture.name(), &census);

    let run_dir = match create_run_dir(out, &capture) {
        Ok(run_dir) => run_dir,
        Err(e) => {
            eprintln!("failed to create run directory: {e}");
            return ExitCode::FAILURE;
        }
    };

    let result = match replay::run(&capture, redis_uri, time_scale, &run_dir).await {
        Ok(result) => result,
        Err(e) => {
            eprintln!("{}", error_chain(&e));
            return ExitCode::FAILURE;
        }
    };

    if let Err(e) = write_artifacts(&run_dir, &capture, &census, time_scale, &result) {
        eprintln!("failed to write {e}");
        return ExitCode::FAILURE;
    }
    println!(
        "replayed {} commands; artifacts in {}",
        result.events.len(),
        run_dir.display(),
    );
    ExitCode::SUCCESS
}

fn create_run_dir(out: &Path, capture: &Capture) -> Result<PathBuf, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    let stem = capture.path.file_stem().map_or_else(
        || "capture".to_owned(),
        |stem| stem.to_string_lossy().into_owned(),
    );
    let run_dir = out.join(format!("{stem}-{stamp}"));
    std::fs::create_dir_all(&run_dir).map_err(|e| format!("{}: {e}", run_dir.display()))?;
    Ok(run_dir)
}

/// Writes a replay run's artifacts into `run_dir`.
fn write_artifacts(
    run_dir: &Path,
    capture: &Capture,
    census: &Census,
    time_scale: u32,
    result: &ReplayResult,
) -> Result<(), String> {
    let mut commands = String::new();
    for event in &result.events {
        commands.push_str(&event_line(event).to_string());
        commands.push('\n');
    }
    write_file(run_dir, "commands.jsonl", commands.as_bytes())?;

    let mut announcements = String::new();
    for announcement in &result.announcements {
        announcements.push_str(
            &json!({
                "offsetMs": announcement.offset.as_secs_f64() * 1000.0,
                "payload": &announcement.payload,
            })
            .to_string(),
        );
        announcements.push('\n');
    }
    write_file(run_dir, "pubsub.jsonl", announcements.as_bytes())?;

    let remapped: BTreeMap<String, String> = result
        .remapped
        .iter()
        .map(|(captured, replayed)| (captured.to_string(), replayed.to_string()))
        .collect();
    write_file(
        run_dir,
        "remap.json",
        &serde_json::to_vec_pretty(&remapped).expect("remapped serializes"),
    )?;

    let journals = run_dir.join("journals");
    std::fs::create_dir_all(&journals).map_err(|e| format!("journals: {e}"))?;
    for (uuid, entries) in &result.journals {
        let mut lines = String::new();
        for entry in entries {
            lines.push_str(&serde_json::to_string(entry).expect("journal entry serializes"));
            lines.push('\n');
        }
        std::fs::write(journals.join(format!("{uuid}.jsonl")), lines)
            .map_err(|e| format!("journals/{uuid}.jsonl: {e}"))?;
    }

    let summary = json!({
        "captureFile": capture.name(),
        "records": census.records,
        "challenges": census.challenges,
        "commands": result.events.len(),
        "incomplete": result.incomplete,
        "timeScale": time_scale,
        "serverExit": result.exit.to_string(),
        "gracefulShutdown": result.graceful,
    });
    write_file(
        run_dir,
        "summary.json",
        &serde_json::to_vec_pretty(&summary).expect("summary serializes"),
    )
}

fn write_file(run_dir: &Path, name: &str, contents: &[u8]) -> Result<(), String> {
    std::fs::write(run_dir.join(name), contents).map_err(|e| format!("{name}: {e}"))
}

fn event_line(event: &Event) -> Value {
    match event {
        Event::CommandSent {
            index,
            op,
            client,
            captured,
            scheduled,
            sent,
            latency,
            status,
            response,
            mapping,
        } => json!({
            "index": index,
            "op": op.to_string(),
            "client": client.0,
            "challenge": captured.map(|uuid| uuid.to_string()),
            "scheduledMs": scheduled.as_secs_f64() * 1000.0,
            "sentMs": sent.as_secs_f64() * 1000.0,
            "latencyMs": latency.as_secs_f64() * 1000.0,
            "status": status,
            "response": response,
            "mapping": mapping.map(mapping_line),
        }),
        Event::CommandUnmapped {
            index,
            op,
            client,
            captured,
        } => json!({
            "index": index,
            "op": op.to_string(),
            "client": client.0,
            "challenge": captured.to_string(),
            "unmapped": true,
        }),
    }
}

fn mapping_line(mapping: Mapping) -> Value {
    match mapping {
        Mapping::New => json!("new"),
        Mapping::Match => json!("match"),
        Mapping::Mismatch { existing } => json!({ "mismatch": existing.to_string() }),
    }
}

fn census(check: bool, paths: &[PathBuf]) -> ExitCode {
    let mut all = Vec::new();
    let mut violations = 0;
    for path in paths {
        let capture = match Capture::load(path) {
            Ok(capture) => capture,
            Err(e) => {
                eprintln!("{}", error_chain(&e));
                return ExitCode::FAILURE;
            }
        };
        let census = Census::of(&capture.records);
        print_census(&capture.name(), &census);
        if check {
            violations += check_capture(&capture.name(), &census);
        }
        all.extend(capture.records);
    }

    if paths.len() > 1 {
        print_census("combined", &Census::of(&all));
    }

    if violations > 0 {
        eprintln!("{violations} check violation(s)");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

/// Checks that a capture file satisfies required invariants.
/// Each recorded challenge in the file must be complete, running from a start
/// command through to a finish announcement.
fn check_capture(name: &str, census: &Census) -> usize {
    let mut violations = 0;
    if census.challenges == 0 {
        eprintln!("{name}: no challenges");
        violations += 1;
    }
    if census.finish_announces != census.challenges {
        eprintln!(
            "{name}: {} FINISH announces for {} challenges",
            census.finish_announces, census.challenges,
        );
        violations += 1;
    }
    let typed: usize = census.by_type.values().sum();
    if typed != census.challenges {
        eprintln!(
            "{name}: {typed} typed starts for {} challenges",
            census.challenges,
        );
        violations += 1;
    }
    violations
}

#[allow(clippy::cast_precision_loss)]
fn print_census(name: &str, census: &Census) {
    println!("{name}");
    println!(
        "  records {}   challenges {}   span {:.1}h",
        census.records,
        census.challenges,
        census.span_ms as f64 / 3_600_000.0,
    );
    let types = census
        .by_type
        .iter()
        .map(|(challenge_type, count)| format!("{}={count}", challenge_type.as_str_name()))
        .collect::<Vec<_>>()
        .join("  ");
    println!("  types {types}");
    let ops = census
        .ops
        .iter()
        .map(|(op, count)| format!("{op}={count}"))
        .collect::<Vec<_>>()
        .join("  ");
    println!("  ops {ops}");
    let hosts = census
        .hosts
        .iter()
        .map(|(host, count)| format!("{host}={count}"))
        .collect::<Vec<_>>()
        .join("  ");
    println!("  hosts {hosts}");
    let spread = census
        .announce_spread_ms
        .map(|ms| format!("   copy spread {ms}ms"))
        .unwrap_or_default();
    println!(
        "  announces FINISH={} STAGE_END={}{spread}",
        census.finish_announces, census.stage_end_announces,
    );
}

fn error_chain(error: &dyn std::error::Error) -> String {
    let mut message = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        let _ = write!(message, ": {cause}");
        source = cause.source();
    }
    message
}

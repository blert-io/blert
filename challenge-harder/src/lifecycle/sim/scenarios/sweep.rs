//! Seeded interleaving sweep over race-prone scenario templates.
//!
//! Each iteration perturbs a template with a seeded client shuffle and gap
//! jitter, then runs it twice. Runs must produce identical traces.
//!
//! Templates should script risky actions exactly on a deadline boundary so
//! that jitter lands it on either side.
//!
//! Iterations log `seed=N`; rerun one with `SWEEP_SEED=N SWEEP_ITERS=1`.

use core::time::Duration;

use super::*;
use crate::lifecycle::core::command::ClientStatus;
use crate::lifecycle::core::deadline::LifecycleConfig;
use crate::lifecycle::sim::{Rng, Scenario, ScenarioResult, hash, perturb, run_with};

const BASE_SEED: u64 = 0xb1e47;
const DEFAULT_ITERATIONS: u64 = 50;

const SWEEP_CONFIG: LifecycleConfig = LifecycleConfig {
    stage_end_timeout: Duration::from_secs(2),
    challenge_end_grace: Duration::from_secs(5),
    reconnection_window: Duration::from_secs(30),
    inactivity_timeout: Duration::from_mins(1),
};

fn ms(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).expect("window fits in u64 millis")
}

/// The largest jitter amplitude an iteration can draw.
const MAX_JITTER: u64 = 1_000;

/// The virtual time by which the consequences of a run's actions have settled.
fn quiet_after(clients: &[Client]) -> u64 {
    let drifted_end = clients
        .iter()
        .map(|client| {
            let last = client.actions.last().map_or(0, |&(at, _)| at);
            last + MAX_JITTER * client.actions.len() as u64
        })
        .max()
        .unwrap_or(0);
    drifted_end
        + ms(SWEEP_CONFIG.stage_end_timeout)
        + ms(SWEEP_CONFIG.challenge_end_grace)
        + ms(SWEEP_CONFIG.reconnection_window)
        + ms(SWEEP_CONFIG.inactivity_timeout)
}

/// Builds a scenario which runs until every consequence of its actions has
/// settled.
fn scenario(clients: Vec<Client>) -> Scenario {
    Scenario {
        run_until: quiet_after(&clients),
        clients,
    }
}

fn setting(name: &str, default: u64) -> u64 {
    match std::env::var(name) {
        Ok(value) => value
            .parse()
            .unwrap_or_else(|_| panic!("{name} must be an integer")),
        Err(_) => default,
    }
}

fn perturbed(mut scenario: Scenario, seed: u64) -> Scenario {
    let mut rng = Rng::new(seed);
    // Zero keeps the scripted times so only arrival order varies; the largest
    // amplitude crosses the deadline boundaries the templates sit on.
    let jitter_ms = match rng.below(4) {
        0 => 0,
        1 => 20,
        2 => 100,
        _ => MAX_JITTER,
    };
    perturb(&mut scenario, &mut rng, jitter_ms);
    scenario
}

/// Runs a scenario on its own fresh runtime, so that two runs of the same
/// seed observe identical scheduler state.
fn run_once(scenario: Scenario) -> ScenarioResult {
    tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .start_paused(true)
        .build()
        .expect("runtime builds")
        .block_on(run_with(SWEEP_CONFIG, scenario))
}

fn sweep(name: &str, template: fn() -> Scenario) {
    let base = setting("SWEEP_SEED", BASE_SEED);
    let iterations = setting("SWEEP_ITERS", DEFAULT_ITERATIONS);

    for i in 0..iterations {
        let seed = base.wrapping_add(i);
        let first = run_once(perturbed(template(), seed));
        let second = run_once(perturbed(template(), seed));

        let trace = first.normalized_trace();
        assert_eq!(
            trace,
            second.normalized_trace(),
            "{name}: same seed diverged (seed={seed})",
        );
        assert!(
            first.snapshots.is_empty(),
            "{name}: a challenge outlived its clients (seed={seed})",
        );
        println!("{name} seed={seed} hash={:016x}", hash(&trace));
        if std::env::var("SWEEP_DUMP").is_ok() {
            println!("{trace}");
        }
    }
}

/// Four clients race creation of the same party at once.
/// Under heavy jitter, fast clients can finish and terminate the challenge
/// before slow ones even start.
fn racing_creates() -> Scenario {
    fn racer(name: &'static str, id: i64) -> Client {
        Client::participant(name, id)
            .at(
                0,
                Action::Start {
                    challenge_type: ChallengeType::Tob,
                    mode: ChallengeMode::TobRegular,
                    party: vec!["a".into(), "b".into(), "c".into(), "d".into()],
                    stage: Stage::TobMaiden,
                },
            )
            .at(200, report(Stage::TobMaiden, StageStatus::Started))
            .at(1_200, report(Stage::TobMaiden, StageStatus::Wiped))
            .at(1_500, finish(false))
    }
    scenario(vec![
        racer("a", 1),
        racer("b", 2),
        racer("c", 3),
        racer("d", 4),
    ])
}

/// A challenge whose only client vanishes immediately after creation; nothing
/// else ever arrives.
fn create_then_vanish() -> Scenario {
    scenario(vec![
        Client::participant("a", 1)
            .at(0, tob_start())
            .at(50, Action::Status(ClientStatus::Disconnected)),
    ])
}

/// A straggler's stage end report arrives at the stage seal deadline.
fn straggler_vs_stage_end() -> Scenario {
    let seal = 1_000 + ms(SWEEP_CONFIG.stage_end_timeout);
    scenario(vec![
        Client::participant("a", 1)
            .at(0, tob_start())
            .at(100, report(Stage::TobMaiden, StageStatus::Started))
            .at(1_000, report(Stage::TobMaiden, StageStatus::Wiped))
            .at(seal + 1_000, finish(false)),
        Client::participant("b", 2)
            .at(0, tob_start())
            .at(100, report(Stage::TobMaiden, StageStatus::Started))
            .at(seal, report(Stage::TobMaiden, StageStatus::Wiped))
            .at(seal + 1_100, finish(false)),
    ])
}

/// The last client's finish arrives right as the finish grace period ends.
fn finish_vs_grace() -> Scenario {
    let cutoff = 1_000 + ms(SWEEP_CONFIG.stage_end_timeout) + ms(SWEEP_CONFIG.challenge_end_grace);
    scenario(vec![
        Client::participant("a", 1)
            .at(0, tob_start())
            .at(100, report(Stage::TobMaiden, StageStatus::Started))
            .at(1_000, report(Stage::TobMaiden, StageStatus::Wiped))
            .at(1_100, finish(false)),
        Client::participant("b", 2)
            .at(0, tob_start())
            .at(100, report(Stage::TobMaiden, StageStatus::Started))
            .at(cutoff, finish(false)),
    ])
}

/// A disconnected client's rejoin arrives at the end of the reconnection window.
fn rejoin_vs_reconnection_window() -> Scenario {
    let rejoin = 2_000 + ms(SWEEP_CONFIG.reconnection_window);
    scenario(vec![
        Client::participant("a", 1)
            .at(0, tob_start())
            .at(100, report(Stage::TobMaiden, StageStatus::Started))
            .at(1_000, report(Stage::TobMaiden, StageStatus::Wiped))
            .at(2_000, Action::Status(ClientStatus::Disconnected))
            .at(rejoin, tob_start())
            .at(rejoin + 100, report(Stage::TobMaiden, StageStatus::Started))
            .at(rejoin + 1_000, report(Stage::TobMaiden, StageStatus::Wiped))
            .at(rejoin + 1_500, finish(false)),
    ])
}

/// A duo that goes idle mid-stage and never returns.
fn all_idle_out() -> Scenario {
    scenario(vec![
        Client::participant("a", 1)
            .at(0, tob_start())
            .at(100, report(Stage::TobMaiden, StageStatus::Started))
            .at(5_000, Action::Status(ClientStatus::Idle)),
        Client::participant("b", 2)
            .at(0, tob_start())
            .at(100, report(Stage::TobMaiden, StageStatus::Started))
            .at(5_050, Action::Status(ClientStatus::Idle)),
    ])
}

#[test]
fn sweep_racing_creates() {
    sweep("racing_creates", racing_creates);
}

#[test]
fn sweep_create_then_vanish() {
    sweep("create_then_vanish", create_then_vanish);
}

#[test]
fn sweep_straggler_vs_stage_end() {
    sweep("straggler_vs_stage_end", straggler_vs_stage_end);
}

#[test]
fn sweep_finish_vs_grace() {
    sweep("finish_vs_grace", finish_vs_grace);
}

#[test]
fn sweep_rejoin_vs_reconnection_window() {
    sweep(
        "rejoin_vs_reconnection_window",
        rejoin_vs_reconnection_window,
    );
}

#[test]
fn sweep_all_idle_out() {
    sweep("all_idle_out", all_idle_out);
}

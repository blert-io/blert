//! Stage processing machinery scenarios, driven by a scripted processor.

use std::sync::Arc;

use tokio::sync::watch;

use super::*;
use crate::lifecycle::challenge::{ChallengeServerUpdate, ChallengeStore, run_challenge};
use crate::lifecycle::coordinator::Coordinator;
use crate::lifecycle::core::command::{Create, Finish, Update};
use crate::lifecycle::core::deadline::{DeadlineKind, LifecycleConfig};
use crate::lifecycle::core::state::{ProcessingConfig, Trigger};
use crate::lifecycle::core::types::{ChallengeStatus, ProcessingError, ProcessingPayload, Uuid};
use crate::lifecycle::sim::{
    Collector, ProcessingAttempt, RunOptions, Scenario, ScriptedProcessor, run_with,
};
use crate::processing::StageProcessor;

use core::time::Duration;

fn config() -> LifecycleConfig {
    LifecycleConfig {
        processing: ProcessingConfig {
            max_attempts: 2,
            run_timeout: Duration::from_secs(10),
            retry_backoff: Duration::from_secs(3),
        },
        ..LifecycleConfig::default()
    }
}

fn options(processor: &Arc<ScriptedProcessor>) -> RunOptions {
    RunOptions {
        config: config(),
        processor: Some(Arc::clone(processor) as Arc<dyn StageProcessor>),
    }
}

fn solo_hmt_start() -> Action {
    Action::Start {
        challenge_type: ChallengeType::Tob,
        mode: ChallengeMode::TobHard,
        party: vec!["aSaradomin".into()],
        stage: Stage::TobMaiden,
    }
}

fn outcome(status: StageStatus, ticks: u32) -> ProcessingPayload {
    ProcessingPayload::Stage { status, ticks }
}

/// An instantly resolving attempt with nothing for the fold.
fn no_payload() -> ProcessingAttempt {
    ProcessingAttempt::Resolve(0, Ok(ProcessingPayload::None))
}

fn retriable_failure() -> ProcessingError {
    ProcessingError {
        message: "scripted".into(),
        retriable: true,
    }
}

fn started(trigger: u64) -> LifecycleEvent {
    LifecycleEvent::ProcessingStarted {
        trigger: JournalSeq(trigger),
    }
}

fn finished(trigger: u64, payload: ProcessingPayload) -> LifecycleEvent {
    LifecycleEvent::ProcessingFinished {
        trigger: JournalSeq(trigger),
        payload,
    }
}

fn processing(trigger: u64) -> Cause {
    Cause::Processing(JournalSeq(trigger))
}

/// A solo `ToB` wiping on Maiden at 1s, sealing the stage as journal entry 5.
fn solo_maiden_wipe(finish_at: u64) -> Scenario {
    Scenario {
        clients: vec![
            Client::participant("a", 1)
                .at(0, solo_hmt_start())
                .at(10, report(Stage::TobMaiden, StageStatus::Started))
                .at(1_000, report(Stage::TobMaiden, StageStatus::Wiped))
                .at(finish_at, finish(false)),
        ],
        run_until: finish_at + 30_000,
    }
}

#[tokio::test(start_paused = true)]
async fn sealed_stage_processes_and_journals_its_run() {
    let processor = ScriptedProcessor::new(vec![
        no_payload(),
        no_payload(),
        ProcessingAttempt::Resolve(500, Ok(outcome(StageStatus::Completed, 237))),
    ]);
    let result = run_with(options(&processor), solo_maiden_wipe(2_000)).await;

    let (_, journal) = result.only_challenge();
    assert_eq!(
        journal[2..6],
        vec![
            entry(
                2,
                0,
                Cause::Deadline(DeadlineKind::ProcessingDue),
                started(0)
            ),
            entry(3, 0, processing(0), finished(0, ProcessingPayload::None)),
            entry(
                4,
                0,
                Cause::Deadline(DeadlineKind::ProcessingDue),
                started(1)
            ),
            entry(5, 0, processing(1), finished(1, ProcessingPayload::None)),
        ],
    );
    assert_eq!(
        journal[8..],
        vec![
            entry(
                8,
                1_000,
                cmd(3),
                reported(1, Stage::TobMaiden, StageStatus::Wiped)
            ),
            entry(
                9,
                1_000,
                cmd(3),
                LifecycleEvent::StageSealed {
                    stage: Stage::TobMaiden,
                    attempt: None,
                    forced: false,
                },
            ),
            entry(
                10,
                1_000,
                Cause::Deadline(DeadlineKind::ProcessingDue),
                started(9)
            ),
            entry(
                11,
                1_500,
                processing(9),
                finished(9, outcome(StageStatus::Completed, 237)),
            ),
            entry(
                12,
                2_000,
                cmd(4),
                LifecycleEvent::ClientFinished {
                    client_id: client_id(1),
                    definitive: true,
                    soft: false,
                    times: None,
                },
            ),
            entry(
                13,
                2_000,
                cmd(4),
                LifecycleEvent::ChallengeTerminated { empty: false },
            ),
            entry(
                14,
                2_000,
                Cause::Deadline(DeadlineKind::ProcessingDue),
                started(13)
            ),
            entry(
                15,
                2_000,
                processing(13),
                finished(13, ProcessingPayload::None),
            ),
        ],
    );

    assert_eq!(result.only_status(), ChallengeStatus::Reset);

    let triggers: Vec<Trigger> = processor.requests().iter().map(|r| r.trigger).collect();
    assert_eq!(
        triggers,
        vec![
            Trigger::Create { seq: JournalSeq(0) },
            Trigger::Recorder {
                seq: JournalSeq(1),
                user_id: UserId(1),
                recording_type: RecordingType::Participant,
            },
            Trigger::Stage {
                seq: JournalSeq(9),
                stage: Stage::TobMaiden,
                attempt: None,
            },
            Trigger::Finish {
                seq: JournalSeq(13)
            },
        ],
    );
}

#[tokio::test(start_paused = true)]
async fn timed_out_run_retries_after_backoff() {
    let processor = ScriptedProcessor::new(vec![
        no_payload(),
        no_payload(),
        ProcessingAttempt::Hang,
        ProcessingAttempt::Resolve(0, Ok(outcome(StageStatus::Wiped, 180))),
    ]);
    let result = run_with(options(&processor), solo_maiden_wipe(20_000)).await;

    let (_, journal) = result.only_challenge();
    assert_eq!(
        journal[10..13],
        vec![
            entry(
                10,
                1_000,
                Cause::Deadline(DeadlineKind::ProcessingDue),
                started(9)
            ),
            entry(
                11,
                11_000,
                Cause::Deadline(DeadlineKind::ProcessingTimeout),
                LifecycleEvent::ProcessingTimedOut {
                    trigger: JournalSeq(9),
                },
            ),
            entry(
                12,
                14_000,
                Cause::Deadline(DeadlineKind::ProcessingDue),
                started(9)
            ),
        ],
    );
    assert_eq!(
        journal[13].event,
        finished(9, outcome(StageStatus::Wiped, 180))
    );
    assert_eq!(result.only_status(), ChallengeStatus::Wiped);
    assert_eq!(processor.requests().len(), 5);
}

#[tokio::test(start_paused = true)]
async fn run_gives_up_after_max_retries_and_the_challenge_concludes() {
    let processor = ScriptedProcessor::new(vec![
        no_payload(),
        no_payload(),
        ProcessingAttempt::Resolve(0, Err(retriable_failure())),
        ProcessingAttempt::Resolve(0, Err(retriable_failure())),
    ]);
    let result = run_with(options(&processor), solo_maiden_wipe(10_000)).await;

    let (uuid, journal) = result.only_challenge();
    assert_eq!(
        journal[10..14],
        vec![
            entry(
                10,
                1_000,
                Cause::Deadline(DeadlineKind::ProcessingDue),
                started(9)
            ),
            entry(
                11,
                1_000,
                processing(9),
                LifecycleEvent::ProcessingFailed {
                    trigger: JournalSeq(9),
                    error: retriable_failure(),
                },
            ),
            entry(
                12,
                4_000,
                Cause::Deadline(DeadlineKind::ProcessingDue),
                started(9)
            ),
            entry(
                13,
                4_000,
                processing(9),
                LifecycleEvent::ProcessingFailed {
                    trigger: JournalSeq(9),
                    error: retriable_failure(),
                },
            ),
        ],
    );

    // With no processed outcome, the status falls back to the challenge's
    // own reported progress, and the challenge still concludes.
    assert_eq!(result.only_status(), ChallengeStatus::Wiped);
    assert!(result.deleted.contains(&uuid));
    assert_eq!(processor.requests().len(), 5);
}

#[tokio::test(start_paused = true)]
async fn non_retriable_failure_gives_up_immediately() {
    let processor = ScriptedProcessor::new(vec![
        no_payload(),
        no_payload(),
        ProcessingAttempt::Resolve(
            0,
            Err(ProcessingError {
                message: "scripted".into(),
                retriable: false,
            }),
        ),
    ]);
    let result = run_with(options(&processor), solo_maiden_wipe(5_000)).await;

    let (uuid, _) = result.only_challenge();
    assert!(result.deleted.contains(&uuid));
    assert_eq!(processor.requests().len(), 4);
}

#[tokio::test(start_paused = true)]
async fn finalization_waits_for_processing_to_finish_after_termination() {
    let processor = ScriptedProcessor::new(vec![
        no_payload(),
        no_payload(),
        ProcessingAttempt::Resolve(5_000, Ok(outcome(StageStatus::Completed, 237))),
    ]);
    let result = run_with(options(&processor), solo_maiden_wipe(2_000)).await;

    let (uuid, journal) = result.only_challenge();
    assert_eq!(
        journal[12..],
        vec![
            entry(
                12,
                2_000,
                cmd(4),
                LifecycleEvent::ChallengeTerminated { empty: false },
            ),
            entry(
                13,
                6_000,
                processing(9),
                finished(9, outcome(StageStatus::Completed, 237)),
            ),
            entry(
                14,
                6_000,
                Cause::Deadline(DeadlineKind::ProcessingDue),
                started(12)
            ),
            entry(
                15,
                6_000,
                processing(12),
                finished(12, ProcessingPayload::None),
            ),
        ],
    );

    assert!(result.deleted.contains(&uuid));
    assert_eq!(result.updates, vec![(uuid, ChallengeServerUpdate::Finish)],);
    assert_eq!(result.only_status(), ChallengeStatus::Reset);
}

#[tokio::test(start_paused = true)]
async fn queued_trigger_processes_after_the_active_run() {
    let processor = ScriptedProcessor::new(vec![
        no_payload(),
        no_payload(),
        ProcessingAttempt::Resolve(2_000, Ok(outcome(StageStatus::Completed, 100))),
        ProcessingAttempt::Resolve(0, Ok(outcome(StageStatus::Wiped, 50))),
    ]);
    let result = run_with(
        options(&processor),
        Scenario {
            clients: vec![
                Client::participant("a", 1)
                    .at(0, solo_hmt_start())
                    .at(10, report(Stage::TobMaiden, StageStatus::Started))
                    .at(1_000, report(Stage::TobMaiden, StageStatus::Completed))
                    .at(1_100, report(Stage::TobBloat, StageStatus::Started))
                    .at(1_600, report(Stage::TobBloat, StageStatus::Wiped))
                    .at(10_000, finish(false)),
            ],
            run_until: 40_000,
        },
    )
    .await;

    // The second stage waits for the first's run to finish before starting.
    let (_, journal) = result.only_challenge();
    let processing_events: Vec<&JournalEntry> = journal
        .iter()
        .filter(|entry| {
            matches!(entry.caused_by, Cause::Processing(_))
                || matches!(
                    entry.caused_by,
                    Cause::Deadline(DeadlineKind::ProcessingDue | DeadlineKind::ProcessingTimeout)
                )
        })
        .collect();
    assert_eq!(processing_events.len(), 10);
    assert_eq!(processing_events[0].event, started(0));
    assert_eq!(processing_events[0].at, Timestamp::ZERO);
    assert_eq!(
        processing_events[1].event,
        finished(0, ProcessingPayload::None)
    );
    assert_eq!(processing_events[2].event, started(1));
    assert_eq!(
        processing_events[3].event,
        finished(1, ProcessingPayload::None)
    );
    assert_eq!(processing_events[4].event, started(9));
    assert_eq!(processing_events[4].at, Timestamp::from_millis(1_000));
    assert_eq!(
        processing_events[5].event,
        finished(9, outcome(StageStatus::Completed, 100)),
    );
    assert_eq!(processing_events[5].at, Timestamp::from_millis(3_000));
    assert_eq!(processing_events[6].at, Timestamp::from_millis(3_000));
    assert_eq!(
        processing_events[7].event,
        finished(14, outcome(StageStatus::Wiped, 50)),
    );
    assert_eq!(processing_events[8].event, started(19));
    assert_eq!(
        processing_events[9].event,
        finished(19, ProcessingPayload::None)
    );

    let triggers: Vec<Trigger> = processor.requests().iter().map(|r| r.trigger).collect();
    assert_eq!(
        triggers,
        vec![
            Trigger::Create { seq: JournalSeq(0) },
            Trigger::Recorder {
                seq: JournalSeq(1),
                user_id: UserId(1),
                recording_type: RecordingType::Participant,
            },
            Trigger::Stage {
                seq: JournalSeq(9),
                stage: Stage::TobMaiden,
                attempt: None,
            },
            Trigger::Stage {
                seq: JournalSeq(14),
                stage: Stage::TobBloat,
                attempt: None,
            },
            Trigger::Finish {
                seq: JournalSeq(19)
            },
        ],
    );

    assert_eq!(result.only_status(), ChallengeStatus::Wiped);
}

#[tokio::test(start_paused = true)]
async fn late_commands_post_termination_while_processing() {
    let processor = ScriptedProcessor::new(vec![
        no_payload(),
        no_payload(),
        ProcessingAttempt::Resolve(5_000, Ok(outcome(StageStatus::Completed, 237))),
    ]);
    let result = run_with(
        options(&processor),
        Scenario {
            clients: vec![
                Client::participant("a", 1)
                    .at(0, solo_hmt_start())
                    .at(10, report(Stage::TobMaiden, StageStatus::Started))
                    .at(1_000, report(Stage::TobMaiden, StageStatus::Wiped))
                    .at(2_000, finish(false))
                    // Lands while the stage run is still processing.
                    .at(3_000, report(Stage::TobBloat, StageStatus::Started)),
            ],
            run_until: 40_000,
        },
    )
    .await;

    // The late report journals nothing, but its consumption advances the
    // published cursor so its sender's applied wait resolves.
    let (uuid, journal) = result.only_challenge();
    assert_eq!(
        journal[12..],
        vec![
            entry(
                12,
                2_000,
                cmd(4),
                LifecycleEvent::ChallengeTerminated { empty: false },
            ),
            entry(
                13,
                6_000,
                processing(9),
                finished(9, outcome(StageStatus::Completed, 237)),
            ),
            entry(
                14,
                6_000,
                Cause::Deadline(DeadlineKind::ProcessingDue),
                started(12)
            ),
            entry(
                15,
                6_000,
                processing(12),
                finished(12, ProcessingPayload::None),
            ),
        ],
    );
    assert!(journal.iter().all(|e| e.caused_by != cmd(5)));
    assert_eq!(result.projections[&uuid].cursor, MsgId::sequence(5));
    assert!(result.deleted.contains(&uuid));
}

#[tokio::test(start_paused = true)]
async fn failed_finish_run_concludes_afterwards() {
    let processor = ScriptedProcessor::new(vec![
        no_payload(),
        no_payload(),
        ProcessingAttempt::Resolve(0, Ok(outcome(StageStatus::Wiped, 60))),
        ProcessingAttempt::Resolve(0, Err(retriable_failure())),
        ProcessingAttempt::Resolve(0, Err(retriable_failure())),
    ]);
    let result = run_with(options(&processor), solo_maiden_wipe(2_000)).await;

    let (uuid, journal) = result.only_challenge();
    assert_eq!(
        journal[14..],
        vec![
            entry(
                14,
                2_000,
                Cause::Deadline(DeadlineKind::ProcessingDue),
                started(13)
            ),
            entry(
                15,
                2_000,
                processing(13),
                LifecycleEvent::ProcessingFailed {
                    trigger: JournalSeq(13),
                    error: retriable_failure(),
                },
            ),
            entry(
                16,
                5_000,
                Cause::Deadline(DeadlineKind::ProcessingDue),
                started(13)
            ),
            entry(
                17,
                5_000,
                processing(13),
                LifecycleEvent::ProcessingFailed {
                    trigger: JournalSeq(13),
                    error: retriable_failure(),
                },
            ),
        ],
    );

    assert!(result.deleted.contains(&uuid));
    assert_eq!(result.updates, vec![(uuid, ChallengeServerUpdate::Finish)]);
    assert_eq!(result.only_status(), ChallengeStatus::Wiped);
}

/// A fresh runtime starting with a paused clock. Dropping it kills every
/// spawned actor, as a server crash would.
fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .start_paused(true)
        .build()
        .expect("runtime builds")
}

async fn claim_only(store: &Collector, uuid: Uuid) -> crate::lifecycle::challenge::Claim {
    let mut claims = store
        .claim_unowned(2, &[])
        .await
        .expect("claim should succeed");
    assert_eq!(claims.len(), 1, "expected exactly one claimable challenge");
    let claim = claims.remove(0);
    assert_eq!(claim.uuid(), uuid);
    claim
}

fn hmt_creat() -> Create {
    Create {
        user_id: UserId(1),
        client_id: ClientId(10),
        session_token: "tok1".into(),
        plugin_version: "0.9.14".into(),
        runelite_version: "1.12.31.1".into(),
        challenge_type: ChallengeType::Tob,
        mode: ChallengeMode::TobHard,
        party: vec!["aSaradomin".into()],
        stage: Stage::TobMaiden,
        recording_type: RecordingType::Participant,
    }
}

fn maiden_wipe() -> Update {
    Update {
        user_id: UserId(1),
        client_id: ClientId(10),
        session_token: "tok1".into(),
        mode: None,
        stage: Some(StageProgress {
            stage: Stage::TobMaiden,
            status: StageStatus::Wiped,
        }),
        party: None,
    }
}

fn finish_request() -> Finish {
    Finish {
        user_id: UserId(1),
        client_id: ClientId(10),
        session_token: "tok1".into(),
        times: None,
        soft: false,
    }
}

async fn wipe_maiden(coordinator: &Coordinator) -> Uuid {
    let snapshot = coordinator
        .create_or_join_challenge(hmt_creat())
        .await
        .expect("create should apply");
    coordinator
        .update(snapshot.uuid, maiden_wipe())
        .await
        .expect("update should apply");
    snapshot.uuid
}

#[test]
fn killed_run_respawns_on_resume() {
    let collector = Collector::default();
    let (_tx, rx) = watch::channel(false);

    // The first server's stage run hangs, and the server dies mid-attempt.
    let store = collector.clone();
    let r1 = rx.clone();
    let first = ScriptedProcessor::new(vec![no_payload(), no_payload(), ProcessingAttempt::Hang]);
    let processor = Arc::clone(&first) as Arc<dyn StageProcessor>;
    let uuid = runtime().block_on(async move {
        let coordinator = Coordinator::with_store(Arc::new(store), r1)
            .with_config(config())
            .with_processor(processor);
        let uuid = wipe_maiden(&coordinator).await;
        tokio::time::sleep(Duration::from_secs(2)).await;
        uuid
    });

    let journal = collector.journal(uuid);
    assert_eq!(journal.last().unwrap().event, started(7));
    assert_eq!(first.requests().len(), 3);

    // A new server resumes and the journal's unfinished run respawns without
    // repeating its `Started` entry.
    let second = ScriptedProcessor::new(vec![ProcessingAttempt::Resolve(
        0,
        Ok(outcome(StageStatus::Wiped, 60)),
    )]);
    let store = collector.clone();
    let r2 = rx.clone();
    let processor = Arc::clone(&second) as Arc<dyn StageProcessor>;
    runtime().block_on(async move {
        let claim = claim_only(&store, uuid).await;
        tokio::spawn(run_challenge(config(), claim, Some(processor), r2));
        tokio::time::sleep(Duration::from_secs(1)).await;
    });

    let journal = collector.journal(uuid);
    let starts = journal.iter().filter(|e| e.event == started(7)).count();
    assert_eq!(starts, 1);
    assert_eq!(
        journal.last().unwrap().event,
        finished(7, outcome(StageStatus::Wiped, 60)),
    );
    assert_eq!(second.requests().len(), 1);
}

#[test]
fn final_processing_concludes_exactly_once_on_resume() {
    let collector = Collector::default();
    let (_tx, rx) = watch::channel(false);

    // The challenge terminates while its last stage run hangs; the server
    // dies before the run settles.
    let store = collector.clone();
    let r1 = rx.clone();
    let first = ScriptedProcessor::new(vec![no_payload(), no_payload(), ProcessingAttempt::Hang]);
    let processor = Arc::clone(&first) as Arc<dyn StageProcessor>;
    let uuid = runtime().block_on(async move {
        let coordinator = Coordinator::with_store(Arc::new(store), r1)
            .with_config(config())
            .with_processor(processor);
        let uuid = wipe_maiden(&coordinator).await;
        coordinator
            .finish(uuid, finish_request())
            .await
            .expect("finish should queue");
        tokio::time::sleep(Duration::from_secs(2)).await;
        uuid
    });

    let journal = collector.journal(uuid);
    assert!(
        journal
            .iter()
            .any(|e| matches!(e.event, LifecycleEvent::ChallengeTerminated { .. })),
    );
    assert_eq!(collector.finish_announcements(uuid), 0);
    assert!(!collector.is_deleted(uuid));

    // Resume and finish processing.
    let second = ScriptedProcessor::new(vec![ProcessingAttempt::Resolve(
        0,
        Ok(outcome(StageStatus::Wiped, 60)),
    )]);
    let store = collector.clone();
    let r2 = rx.clone();
    let processor = Arc::clone(&second) as Arc<dyn StageProcessor>;
    runtime().block_on(async move {
        run_challenge(
            config(),
            claim_only(&store, uuid).await,
            Some(processor),
            r2,
        )
        .await;
    });

    assert_eq!(collector.finish_announcements(uuid), 1);
    assert!(collector.is_deleted(uuid));
    assert_eq!(
        collector.journal(uuid).last().unwrap().event,
        finished(10, ProcessingPayload::None),
    );
    assert_eq!(second.requests().len(), 2);
}

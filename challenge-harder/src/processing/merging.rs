use std::collections::BTreeSet;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::merging::capture::MergeCapture;
use crate::merging::{
    ClientAnomaly, ClientOutcome, MergeAlert, MergeReport, MergeStatus, QualityFlag,
};
use crate::metrics;
use crate::repository::DataRepository;

use super::ChallengeInfo;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum CaptureReason {
    BadData,
    InvalidTickCount,
    UnknownPlayer,
    ServerTickDisagreement,
    MergeRejection,
    LowConfidence,
    EventsBeyondReportedTicks,
    UnmergedClients,
    QualityFlags,
    TimelineOffset,
    Baseline,
    Development,
}

impl CaptureReason {
    pub fn name(self) -> &'static str {
        match self {
            Self::BadData => "bad_data",
            Self::InvalidTickCount => "invalid_tick_count",
            Self::UnknownPlayer => "unknown_player",
            Self::ServerTickDisagreement => "server_tick_disagreement",
            Self::MergeRejection => "merge_rejection",
            Self::LowConfidence => "low_confidence",
            Self::EventsBeyondReportedTicks => "events_beyond_reported_ticks",
            Self::UnmergedClients => "unmerged_clients",
            Self::QualityFlags => "quality_flags",
            Self::TimelineOffset => "timeline_offset",
            Self::Baseline => "baseline",
            Self::Development => "development",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CaptureRates {
    pub bad_data: f64,
    pub invalid_tick_count: f64,
    pub unknown_player: f64,
    pub server_tick_disagreement: f64,
    pub merge_rejection: f64,
    pub low_confidence: f64,
    pub events_beyond_reported_ticks: f64,
    pub unmerged_clients: f64,
    pub quality_flags: f64,
    pub timeline_offset: f64,
    pub baseline: f64,
    pub development: f64,
}

impl Default for CaptureRates {
    fn default() -> Self {
        CaptureRates {
            bad_data: 1.0,
            invalid_tick_count: 1.0,
            unknown_player: 1.0,
            server_tick_disagreement: 1.0,
            merge_rejection: 1.0,
            low_confidence: 0.5,
            events_beyond_reported_ticks: 0.25,
            unmerged_clients: 0.25,
            quality_flags: 0.25,
            timeline_offset: 0.05,
            baseline: 0.005,
            development: 1.0,
        }
    }
}

impl CaptureRates {
    fn rate(&self, reason: CaptureReason) -> f64 {
        match reason {
            CaptureReason::BadData => self.bad_data,
            CaptureReason::InvalidTickCount => self.invalid_tick_count,
            CaptureReason::UnknownPlayer => self.unknown_player,
            CaptureReason::ServerTickDisagreement => self.server_tick_disagreement,
            CaptureReason::MergeRejection => self.merge_rejection,
            CaptureReason::LowConfidence => self.low_confidence,
            CaptureReason::EventsBeyondReportedTicks => self.events_beyond_reported_ticks,
            CaptureReason::UnmergedClients => self.unmerged_clients,
            CaptureReason::QualityFlags => self.quality_flags,
            CaptureReason::TimelineOffset => self.timeline_offset,
            CaptureReason::Baseline => self.baseline,
            CaptureReason::Development => self.development,
        }
    }
}

const LOW_CONFIDENCE_CAPTURE_BOUND: f64 = 0.85;

fn is_noteworthy_flag(flag: &QualityFlag) -> bool {
    match flag {
        QualityFlag::AttackTypeMismatch { .. }
        | QualityFlag::AttackTargetMismatch { .. }
        | QualityFlag::SpellTypeMismatch { .. }
        | QualityFlag::SpellTargetMismatch { .. }
        | QualityFlag::NpcAttackTypeMismatch { .. }
        | QualityFlag::NpcAttackTargetMismatch { .. }
        | QualityFlag::UnexpectedConflict { .. } => true,
        QualityFlag::LargeTemporalGap { .. }
        | QualityFlag::UnmappedCrossTickReference { .. }
        | QualityFlag::AttackMappedNotFound { .. } => false,
    }
}

pub fn capture_reasons(report: &MergeReport, development: bool) -> Vec<CaptureReason> {
    let mut reasons = BTreeSet::new();

    for alert in &report.alerts {
        match alert {
            MergeAlert::MultipleServerTickCounts { .. } => {
                reasons.insert(CaptureReason::ServerTickDisagreement);
            }
            MergeAlert::TimelineOffsetApplied { .. } => {
                if report.clients.len() > 1 {
                    reasons.insert(CaptureReason::TimelineOffset);
                }
            }
            MergeAlert::PostMergeConsistencyRejections { .. }
            | MergeAlert::LowConfidenceRejections { .. } => {
                reasons.insert(CaptureReason::MergeRejection);
            }
            MergeAlert::LowStructuralConfidence { .. } => {
                reasons.insert(CaptureReason::LowConfidence);
            }
        }
    }

    for client in &report.clients {
        for anomaly in &client.anomalies {
            match anomaly {
                ClientAnomaly::InvalidTickCount => {
                    reasons.insert(CaptureReason::InvalidTickCount);
                }
                ClientAnomaly::UnknownPlayer => {
                    reasons.insert(CaptureReason::UnknownPlayer);
                }
                ClientAnomaly::EventsBeyondReportedTicks => {
                    reasons.insert(CaptureReason::EventsBeyondReportedTicks);
                }
                ClientAnomaly::MissingStageMetadata => {}
            }
        }

        let quality_flags = match &client.status {
            MergeStatus::Skipped { .. } => {
                reasons.insert(CaptureReason::BadData);
                &[][..]
            }
            MergeStatus::Unmerged { .. } => &[][..],
            MergeStatus::Merged {
                confidence,
                quality_flags,
                ..
            } => {
                if let Some(confidence) = confidence
                    && confidence
                        .worst_segment_score()
                        .is_some_and(|score| score < LOW_CONFIDENCE_CAPTURE_BOUND)
                {
                    reasons.insert(CaptureReason::LowConfidence);
                }
                quality_flags.as_slice()
            }
            MergeStatus::Rejected { quality_flags, .. } => quality_flags.as_slice(),
        };
        if quality_flags.iter().any(is_noteworthy_flag) {
            reasons.insert(CaptureReason::QualityFlags);
        }
    }

    if report.unmerged_count > 0 || report.skipped_count > 0 {
        reasons.insert(CaptureReason::UnmergedClients);
    }

    if development && report.clients.len() > 1 {
        reasons.insert(CaptureReason::Development);
    }

    if reasons.is_empty() {
        reasons.insert(CaptureReason::Baseline);
    }

    reasons.into_iter().collect()
}

pub struct Capture {
    pub reasons: Vec<CaptureReason>,
    pub file: String,
}

struct CaptureWindow {
    started: Instant,
    count: u32,
}

pub struct StreamCapturer {
    repository: DataRepository,
    development: bool,
    rates: CaptureRates,
    window: Mutex<CaptureWindow>,
}

impl StreamCapturer {
    const MAX_CAPTURES_PER_HOUR: u32 = 25;
    const WINDOW: Duration = Duration::from_hours(1);

    pub fn new(repository: DataRepository, development: bool, rates: CaptureRates) -> Self {
        StreamCapturer {
            repository,
            development,
            rates,
            window: Mutex::new(CaptureWindow {
                started: Instant::now(),
                count: 0,
            }),
        }
    }

    /// Samples a recording's merge metadata for potential capture by the
    /// configured capture rates.
    pub async fn sample_capture(
        &self,
        challenge: &ChallengeInfo,
        report: &MergeReport,
        streams: &MergeCapture,
    ) -> Option<Capture> {
        let reasons = capture_reasons(report, self.development);
        let should_capture = reasons
            .iter()
            .any(|reason| rand::random::<f64>() < self.rates.rate(*reason));
        if !should_capture {
            return None;
        }
        self.save_capture(challenge, reasons, streams, &report.clients)
            .await
    }

    /// Captures a recording for the specified reason.
    pub async fn capture(
        &self,
        challenge: &ChallengeInfo,
        reason: CaptureReason,
        streams: &MergeCapture,
        clients: &[ClientOutcome],
    ) -> Option<Capture> {
        self.save_capture(challenge, vec![reason], streams, clients)
            .await
    }

    async fn save_capture(
        &self,
        challenge: &ChallengeInfo,
        reasons: Vec<CaptureReason>,
        streams: &MergeCapture,
        clients: &[ClientOutcome],
    ) -> Option<Capture> {
        {
            let mut window = self
                .window
                .lock()
                .expect("the capture window lock is never poisoned");
            let now = Instant::now();
            if now.duration_since(window.started) >= Self::WINDOW {
                window.started = now;
                window.count = 0;
            }
            if window.count >= Self::MAX_CAPTURES_PER_HOUR {
                metrics::record_stream_capture_suppressed();
                tracing::warn!(
                    uuid = %challenge.uuid,
                    stage = ?challenge.stage,
                    ?reasons,
                    "stream_capture_rate_limited",
                );
                return None;
            }
            window.count += 1;
        }
        for reason in &reasons {
            metrics::record_stream_capture(reason.name());
        }

        let attempt = challenge
            .stage_attempt
            .map_or(String::new(), |attempt| format!(":{attempt}"));
        let file = format!(
            "merge-captures/{}:{}{attempt}_events.json",
            challenge.uuid, challenge.stage as i32
        );
        let names = reasons
            .iter()
            .map(|reason| reason.name().to_string())
            .collect();
        let contents = streams.encode(names, clients);
        let result = self.repository.save_file(&file, &contents).await;
        metrics::record_unmerged_events_write(result.is_ok());
        match result {
            Ok(()) => {
                tracing::info!(
                    uuid = %challenge.uuid,
                    stage = ?challenge.stage,
                    attempt = ?challenge.stage_attempt,
                    ?reasons,
                    "unmerged_events_saved",
                );
                Some(Capture { reasons, file })
            }
            Err(error) => {
                tracing::error!(
                    uuid = %challenge.uuid,
                    stage = ?challenge.stage,
                    attempt = ?challenge.stage_attempt,
                    %error,
                    "unmerged_events_save_error",
                );
                None
            }
        }
    }
}

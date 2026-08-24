//! Stage event merging.
//!
//! Combines the event streams recorded by a stage's clients into a single
//! canonical timeline for challenge processing to consume.

// TODO(frolv): Remove once the container's full API has consumers.
#![cfg_attr(not(test), expect(dead_code))]

pub mod capture;
mod classification;
mod client_consistency;
mod client_events;
mod derivation;
mod event;
#[cfg(test)]
pub(crate) mod fixtures;
mod timeline;
mod world;

use classification::classify_clients;
use client_events::ClientEvents;
use event::MalformedEvent;

use crate::lifecycle::core::types::{
    ChallengeMode, ChallengeType, ClientStageStream, Stage, StageStatus, Uuid,
};
use crate::proto::Event;

/// Fatally invalid client input data.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
enum BadData {
    #[error(transparent)]
    MalformedEvent(#[from] MalformedEvent),
    #[error("tick {tick}: {message}")]
    Inconsistent { tick: u32, message: String },
    #[error("multiple primary players")]
    MultiplePrimaryPlayers,
    #[error("invalid server tick count")]
    InvalidServerTickCount,
}

/// A notable condition encountered while merging a stage's clients.
#[derive(Debug, PartialEq, Eq)]
enum MergeAlert {
    /// Clients sent conflicting server tick counts.
    MultipleServerTickCounts {
        precise: bool,
        tick_counts: Vec<u32>,
    },
}

/// Challenge context for a merge.
#[derive(Debug, Clone)]
pub struct ChallengeInfo<'a> {
    pub uuid: Uuid,
    pub challenge_type: ChallengeType,
    pub mode: ChallengeMode,
    pub party: &'a [String],
}

/// The state of an in-progress merge.
#[derive(Debug)]
struct MergeContext<'a> {
    challenge: &'a ChallengeInfo<'a>,
    stage: Stage,
    clients: Vec<ClientEvents>,
}

/// Merges the events recorded by a stage's clients into a canonical timeline.
/// Returns `None` if the stream contains no client data.
pub fn merge(
    challenge: &ChallengeInfo<'_>,
    stage: Stage,
    records: Vec<ClientStageStream>,
) -> Option<MergedEvents> {
    let mut clients = client_events::from_stage_stream(challenge, stage, records);
    if clients.is_empty() {
        return None;
    }

    let classification = classify_clients(challenge, stage, &mut clients);

    // TODO(frolv): port
    let base = clients.swap_remove(classification.base);

    let ctx = MergeContext {
        challenge,
        stage,
        clients: vec![base],
    };
    Some(MergedEvents::from_single_client(ctx))
}

/// Trust and shape metadata of a merged timeline.
#[derive(Debug)]
struct Metadata {
    status: StageStatus,
    last_tick: u32,
    missing_tick_count: u32,
    precise_server_tick_count: bool,
    accurate_until: u32,
    queryable_until: u32,
}

/// A canonical timeline of stage events combined from clients' recordings.
#[derive(Debug)]
pub struct MergedEvents {
    /// Events in tick order.
    events: Vec<Event>,
    metadata: Metadata,
}

impl MergedEvents {
    fn new(events: Vec<Event>, metadata: Metadata) -> MergedEvents {
        MergedEvents { events, metadata }
    }

    /// Builds a timeline from a single client's stream, trusting its
    /// self-reported metadata.
    // TODO(frolv): temporary, remove
    fn from_single_client(mut ctx: MergeContext<'_>) -> MergedEvents {
        let client = ctx
            .clients
            .first_mut()
            .expect("there is exactly one client");
        let timeline = std::mem::take(&mut client.timeline);
        let max_event_tick = timeline.last_tick().unwrap_or(0);

        let events = timeline.finalize(&ctx);

        let client = ctx
            .clients
            .first_mut()
            .expect("there is exactly one client");

        let (reference, precise) = if client.accurate {
            (Some(client.recorded_ticks), true)
        } else if let Some(server) = client.server_ticks {
            (Some(server.count), server.precise)
        } else {
            (None, false)
        };
        let last_tick = reference.map_or(max_event_tick, |count| count.max(max_event_tick));

        let trusted_until = if client.accurate { last_tick + 1 } else { 0 };

        MergedEvents {
            events,
            metadata: Metadata {
                status: client.status,
                last_tick,
                missing_tick_count: last_tick.saturating_sub(client.recorded_ticks),
                precise_server_tick_count: precise,
                accurate_until: trusted_until,
                queryable_until: trusted_until,
            },
        }
    }

    /// Iterates over every event in tick order.
    pub fn iter(&self) -> std::slice::Iter<'_, Event> {
        self.events.iter()
    }

    /// The number of events in the timeline.
    pub fn len(&self) -> usize {
        self.events.len()
    }

    /// Whether the timeline contains no events.
    #[expect(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    /// The events occurring on `tick`.
    pub fn events_for_tick(&self, tick: u32) -> &[Event] {
        &self.events[self.tick_range(tick)]
    }

    /// Mutable events occurring on `tick`.
    pub fn events_for_tick_mut(&mut self, tick: u32) -> &mut [Event] {
        let range = self.tick_range(tick);
        &mut self.events[range]
    }

    /// The overall status of the stage.
    pub fn status(&self) -> StageStatus {
        self.metadata.status
    }

    /// The final tick of the timeline.
    pub fn last_tick(&self) -> u32 {
        self.metadata.last_tick
    }

    /// The number of ticks in the timeline on which no client recorded events.
    pub fn missing_tick_count(&self) -> u32 {
        self.metadata.missing_tick_count
    }

    /// Whether the timeline's tick count is verified by the game server.
    pub fn has_precise_server_tick_count(&self) -> bool {
        self.metadata.precise_server_tick_count
    }

    /// The exclusive tick at which the timeline can no longer be trusted to
    /// match the true server tick count.
    pub fn accurate_until(&self) -> u32 {
        self.metadata.accurate_until
    }

    /// The exclusive tick at which the event stream can no longer be fully
    /// corroborated for strict analysis.
    pub fn queryable_until(&self) -> u32 {
        self.metadata.queryable_until
    }

    /// Whether queryability covers the entire stage.
    pub fn fully_queryable(&self) -> bool {
        self.metadata.last_tick < self.metadata.queryable_until
    }

    /// Consumes the timeline, returning its events in tick order.
    pub fn into_events(self) -> Vec<Event> {
        self.events
    }

    /// Limits the accuracy and queryability of the event stream to `tick`, exclusive.
    pub fn restrict_accuracy_to(&mut self, tick: u32) {
        self.metadata.accurate_until = self.metadata.accurate_until.min(tick);
        self.metadata.queryable_until = self.metadata.queryable_until.min(tick);
    }

    fn tick_range(&self, tick: u32) -> std::ops::Range<usize> {
        let start = self.events.partition_point(|event| event.tick < tick);
        let end = start
            + self.events[start..]
                .iter()
                .take_while(|e| e.tick == tick)
                .count();
        start..end
    }
}

impl std::ops::Index<usize> for MergedEvents {
    type Output = Event;

    fn index(&self, index: usize) -> &Event {
        &self.events[index]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lifecycle::core::types::ServerTicks;
    use crate::proto::event;

    fn nylocas_challenge() -> ChallengeInfo<'static> {
        static PARTY: std::sync::LazyLock<Vec<String>> =
            std::sync::LazyLock::new(|| vec!["1Ogp".to_string()]);
        fixtures::challenge_info(Stage::TobNylocas, ChallengeMode::TobRegular, &PARTY)
    }

    fn wave_event(tick: u32, wave: u32) -> Event {
        fixtures::nylo_wave_event(event::Type::TobNyloWaveSpawn, tick, wave, 0, 12)
    }

    fn merge_one_client(accurate: bool, recorded_ticks: u32, events: Vec<Event>) -> MergedEvents {
        let challenge = nylocas_challenge();
        MergedEvents::from_single_client(
            fixtures::merge_context(&challenge, Stage::TobNylocas)
                .recording(accurate, recorded_ticks, events)
                .build(),
        )
    }

    #[test]
    fn merge_of_an_empty_stream_is_none() {
        let party = vec!["1Ogp".to_string()];
        let challenge =
            fixtures::challenge_info(Stage::MokhaiotlDelve1, ChallengeMode::NoMode, &party);
        assert!(merge(&challenge, Stage::MokhaiotlDelve1, vec![]).is_none());
    }

    #[test]
    fn events_for_tick_slices_to_a_single_tick() {
        let merged = merge_one_client(
            true,
            20,
            vec![
                wave_event(4, 1),
                wave_event(8, 2),
                wave_event(12, 3),
                wave_event(16, 4),
            ],
        );
        let waves: Vec<u32> = merged
            .events_for_tick(8)
            .iter()
            .map(|event| event.nylo_wave.unwrap().wave)
            .collect();
        assert_eq!(waves, vec![2]);
        assert!(merged.events_for_tick(6).is_empty());
        assert!(merged.events_for_tick(18).is_empty());
    }

    #[test]
    fn mutation_through_a_tick_slice_is_visible_in_iteration() {
        let mut merged = merge_one_client(true, 10, vec![wave_event(4, 1), wave_event(8, 2)]);
        for event in merged.events_for_tick_mut(8) {
            event.y_coord = 99;
        }
        let updated: Vec<i32> = merged.iter().map(|event| event.y_coord).collect();
        assert_eq!(updated, vec![0, 99]);
    }

    #[test]
    fn missing_ticks_counts_unrecorded_ticks() {
        let accurate = merge_one_client(true, 5, vec![wave_event(4, 1)]);
        assert_eq!(accurate.last_tick(), 5);
        assert_eq!(accurate.missing_tick_count(), 0);

        let challenge = nylocas_challenge();
        let mut lagged = fixtures::merge_context(&challenge, Stage::TobNylocas)
            .recording(false, 5, vec![wave_event(4, 1)])
            .build();
        lagged.clients[0].server_ticks = Some(ServerTicks {
            count: 8,
            precise: true,
        });
        let merged = MergedEvents::from_single_client(lagged);
        assert_eq!(merged.last_tick(), 8);
        assert_eq!(merged.missing_tick_count(), 3);
    }

    #[test]
    fn restrict_accuracy_to_only_clamps_down() {
        let mut merged = merge_one_client(true, 100, vec![wave_event(4, 1), wave_event(100, 14)]);
        merged.restrict_accuracy_to(40);
        assert_eq!(merged.accurate_until(), 40);
        assert_eq!(merged.queryable_until(), 40);
        merged.restrict_accuracy_to(80);
        assert_eq!(merged.accurate_until(), 40);
        assert_eq!(merged.queryable_until(), 40);
        assert!(!merged.fully_queryable());
    }
}

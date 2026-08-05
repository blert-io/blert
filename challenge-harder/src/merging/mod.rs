//! Stage event merging.
//!
//! Combines the event streams recorded by a stage's clients into a single
//! canonical timeline for challenge processing to consume.

// TODO(frolv): Remove once the container's full API has consumers.
#![cfg_attr(not(test), expect(dead_code))]

mod client_events;
#[cfg(test)]
pub(crate) mod fixtures;

use client_events::ClientEvents;

use crate::lifecycle::core::types::{ClientStageStream, Stage, StageStatus, Uuid};
use crate::proto::Event;

/// Merges the events recorded by a stage's clients into a canonical timeline.
/// Returns `None` if the stream contains no client data.
pub fn merge(uuid: Uuid, stage: Stage, records: Vec<ClientStageStream>) -> Option<MergedEvents> {
    let clients = client_events::from_stage_stream(uuid, stage, records);
    // TODO(frolv): port
    let base = clients.into_iter().next()?;
    Some(MergedEvents::from_single_client(base))
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
    fn from_single_client(client: ClientEvents) -> MergedEvents {
        let ClientEvents {
            status,
            accurate,
            recorded_ticks,
            server_ticks,
            events,
            ..
        } = client;

        let max_event_tick = events.last().map_or(0, |event| event.tick);

        let (reference, precise) = if accurate {
            (Some(recorded_ticks), true)
        } else if let Some(server) = server_ticks {
            (Some(server.count), server.precise)
        } else {
            (None, false)
        };
        let last_tick = reference.map_or(max_event_tick, |count| count.max(max_event_tick));

        let trusted_until = if accurate { last_tick + 1 } else { 0 };

        MergedEvents {
            events,
            metadata: Metadata {
                status,
                last_tick,
                missing_tick_count: last_tick.saturating_sub(recorded_ticks),
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

    /// Mutably iterates over every event in tick order.
    pub fn iter_mut(&mut self) -> std::slice::IterMut<'_, Event> {
        self.events.iter_mut()
    }

    /// The number of events in the timeline.
    pub fn len(&self) -> usize {
        self.events.len()
    }

    /// Whether the timeline contains no events.
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
    use crate::lifecycle::core::types::{ClientId, ServerTicks};

    fn test_uuid() -> Uuid {
        "a8cb035f-410a-45de-a4d3-2b0a5d8b464d".parse().unwrap()
    }

    fn tick_event(tick: u32, x_coord: i32) -> Event {
        Event {
            tick,
            x_coord,
            ..Default::default()
        }
    }

    fn client(accurate: bool, recorded_ticks: u32, events: Vec<Event>) -> ClientEvents {
        ClientEvents {
            client_id: ClientId(1),
            status: StageStatus::Completed,
            accurate,
            recorded_ticks,
            server_ticks: None,
            events,
        }
    }

    #[test]
    fn merge_of_an_empty_stream_is_none() {
        assert!(merge(test_uuid(), Stage::MokhaiotlDelve1, vec![]).is_none());
    }

    #[test]
    fn events_for_tick_slices_to_a_single_tick() {
        let merged = MergedEvents::from_single_client(client(
            true,
            5,
            vec![
                tick_event(0, 4),
                tick_event(2, 1),
                tick_event(2, 3),
                tick_event(5, 2),
            ],
        ));
        let coords: Vec<i32> = merged
            .events_for_tick(2)
            .iter()
            .map(|event| event.x_coord)
            .collect();
        assert_eq!(coords, vec![1, 3]);
        assert!(merged.events_for_tick(3).is_empty());
        assert!(merged.events_for_tick(6).is_empty());
    }

    #[test]
    fn mutation_through_a_tick_slice_is_visible_in_iteration() {
        let mut merged = MergedEvents::from_single_client(client(
            true,
            5,
            vec![tick_event(1, 1), tick_event(3, 2)],
        ));
        for event in merged.events_for_tick_mut(3) {
            event.y_coord = 99;
        }
        let updated: Vec<i32> = merged.iter().map(|event| event.y_coord).collect();
        assert_eq!(updated, vec![0, 99]);
    }

    #[test]
    fn missing_ticks_counts_unrecorded_ticks() {
        let accurate = MergedEvents::from_single_client(client(
            true,
            5,
            vec![tick_event(0, 0), tick_event(1, 0), tick_event(3, 0)],
        ));
        assert_eq!(accurate.last_tick(), 5);
        assert_eq!(accurate.missing_tick_count(), 0);

        let mut lagged = client(false, 5, vec![tick_event(0, 0), tick_event(4, 0)]);
        lagged.server_ticks = Some(ServerTicks {
            count: 8,
            precise: true,
        });
        let merged = MergedEvents::from_single_client(lagged);
        assert_eq!(merged.last_tick(), 8);
        assert_eq!(merged.missing_tick_count(), 3);
    }

    #[test]
    fn restrict_accuracy_to_only_clamps_down() {
        let mut merged = MergedEvents::from_single_client(client(
            true,
            100,
            vec![tick_event(0, 0), tick_event(100, 0)],
        ));
        merged.restrict_accuracy_to(40);
        assert_eq!(merged.accurate_until(), 40);
        assert_eq!(merged.queryable_until(), 40);
        merged.restrict_accuracy_to(80);
        assert_eq!(merged.accurate_until(), 40);
        assert_eq!(merged.queryable_until(), 40);
        assert!(!merged.fully_queryable());
    }
}

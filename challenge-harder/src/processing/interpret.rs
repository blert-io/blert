//! Stage event reconstruction and interpretation.

use std::collections::BTreeMap;

use crate::item::{self, ItemDelta};
use crate::lifecycle::core::types::{ClientStageStream, PrimaryMeleeGear, Uuid};
use crate::merging::{self, MergedEvents};
use crate::proto::{Event, event};

use super::ChallengeInfo;
use super::challenge_processor::{ChallengeProcessor, EventCursor, RoomNpc, StageContext};

/// The interpreted result of a stage's events.
#[derive(Debug)]
pub struct InterpretOutput {
    pub(super) events: MergedEvents,
    /// Indices into `events` of the events kept for storage.
    pub(super) kept: Vec<usize>,
    pub(super) ctx: StageContext,
}

impl InterpretOutput {
    /// Consumes the output, returning the kept events in tick order.
    pub(super) fn into_kept_events(self) -> Vec<Event> {
        let mut kept = self.kept.into_iter().peekable();
        self.events
            .into_events()
            .into_iter()
            .enumerate()
            .filter_map(|(index, event)| {
                if kept.peek() == Some(&index) {
                    kept.next();
                    Some(event)
                } else {
                    None
                }
            })
            .collect()
    }
}

/// A failure to interpret a stage's recorded data.
#[derive(Debug)]
pub enum InterpretError {
    /// The stage has no recorded data to process.
    NoData,
}

/// Processes a stage's raw events into a canonical timeline.
pub fn interpret(
    challenge: ChallengeInfo,
    records: Vec<ClientStageStream>,
    processor: &mut dyn ChallengeProcessor,
) -> Result<InterpretOutput, InterpretError> {
    let ChallengeInfo {
        uuid,
        stage,
        party,
        party_changed,
        ..
    } = challenge;

    let mut events = merging::merge(uuid, stage, records).ok_or(InterpretError::NoData)?;

    resolve_party_indices(uuid, &party, &mut events);

    let mut ctx = StageContext::new(party);
    let mut kept = Vec::with_capacity(events.len());

    for index in 0..events.len() {
        {
            let event = &events[index];
            if let Some(player) = &event.player
                && player.party_index == u32::MAX
            {
                // TODO(frolv): These events should be dropped by the merger.
                continue;
            }
            track_event(&mut ctx, event);
        }

        let mut cursor = EventCursor::new(&mut events, index);
        if processor.process_challenge_event(&mut ctx, &mut cursor) {
            kept.push(index);
        }
    }

    if party_changed {
        events.restrict_accuracy_to(0);
    }

    Ok(InterpretOutput { events, kept, ctx })
}

/// Resolves each player event's username to its party index.
/// Events from players outside the party are marked with an out-of-range index.
// TODO(frolv): This should be a postprocessing step in the merger.
fn resolve_party_indices(uuid: Uuid, party: &[String], events: &mut MergedEvents) {
    let mut unknown: BTreeMap<String, u32> = BTreeMap::new();
    for event in events.iter_mut() {
        let Some(player) = &mut event.player else {
            continue;
        };
        if let Some(index) = party.iter().position(|name| name == &player.name) {
            player.party_index = u32::try_from(index).expect("party index fits in a u32");
        } else {
            *unknown.entry(player.name.clone()).or_default() += 1;
            player.party_index = u32::MAX;
        }
    }

    if !unknown.is_empty() {
        tracing::error!(%uuid, players = ?unknown, "challenge_event_unknown_players");
    }
}

/// Handles a single event, updating state if necessary.
fn track_event(ctx: &mut StageContext, event: &Event) {
    match event.r#type() {
        event::Type::PlayerUpdate => {
            if let Some(player) = &event.player
                && let Some(data) = ctx.player_mut(player.party_index as usize)
                && data.gear.is_none()
                && let Some(gear) = try_determine_gear(player)
            {
                data.gear = Some(gear);
            }
        }
        event::Type::PlayerDeath => {
            if let Some(player) = &event.player {
                ctx.record_death(player.party_index as usize);
            }
        }
        event::Type::NpcSpawn => {
            if let Some(npc) = &event.npc {
                ctx.track_npc(RoomNpc {
                    spawn_npc_id: npc.id,
                    room_id: npc.room_id,
                    spawn_tick: event.tick,
                    spawn_point: (event.x_coord, event.y_coord),
                    death_tick: 0,
                    death_point: (0, 0),
                    kind: npc.r#type,
                });
            }
        }
        event::Type::NpcDeath => {
            if let Some(npc) = &event.npc
                && let Some(room_npc) = ctx.npc_mut(npc.room_id)
            {
                room_npc.death_tick = event.tick;
                room_npc.death_point = (event.x_coord, event.y_coord);
            }
        }
        _ => {}
    }
}

/// Determines a player's primary melee gear from the equipment they put on.
fn try_determine_gear(player: &event::Player) -> Option<PrimaryMeleeGear> {
    let added_in_slot = |slot: event::player::EquipmentSlot| {
        player
            .equipment_deltas
            .iter()
            .filter_map(|&raw| ItemDelta::parse(raw).ok())
            .find_map(|delta| match delta {
                ItemDelta::Add(s, id, _) if s == slot => Some(id),
                ItemDelta::Add(..) | ItemDelta::Remove(..) => None,
            })
    };

    let mut gear = added_in_slot(event::player::EquipmentSlot::Torso).and_then(|id| match id {
        item::id::RADIANT_OATHPLATE_CHEST => Some(PrimaryMeleeGear::RadiantOathplate),
        item::id::OATHPLATE_CHEST => Some(PrimaryMeleeGear::Oathplate),
        item::id::SANGUINE_TORVA_PLATEBODY => Some(PrimaryMeleeGear::Blorva),
        item::id::TORVA_PLATEBODY => Some(PrimaryMeleeGear::Torva),
        item::id::BANDOS_CHESTPLATE => Some(PrimaryMeleeGear::Bandos),
        _ => None,
    });

    if added_in_slot(event::player::EquipmentSlot::Head)
        .is_some_and(|id| matches!(id, item::id::VOID_MELEE_HELM | item::id::VOID_MELEE_HELM_OR))
    {
        gear = Some(PrimaryMeleeGear::EliteVoid);
    }

    gear
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;
    use prost::Message;

    use super::super::challenge_processor::ChallengeContext;
    use super::super::db;
    use super::*;
    use crate::lifecycle::core::types::{
        ChallengeMode, ChallengeStatus, ChallengeType, ClientId, Stage,
    };
    use crate::proto::ChallengeEvents;
    use crate::proto::event::player::EquipmentSlot;

    fn context() -> StageContext {
        StageContext::new(vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()])
    }

    fn event_with_player(kind: event::Type, tick: u32, name: &str, index: u32) -> Event {
        let mut event = Event {
            tick,
            ..Default::default()
        };
        event.set_type(kind);
        event.player = Some(event::Player {
            name: name.to_string(),
            party_index: index,
            ..Default::default()
        });
        event
    }

    fn update_with_deltas(name: &str, index: u32, deltas: Vec<u64>) -> Event {
        let mut event = event_with_player(event::Type::PlayerUpdate, 1, name, index);
        event.player.as_mut().unwrap().equipment_deltas = deltas;
        event
    }

    #[test]
    fn npc_lifecycle_is_tracked_with_spawn_metadata() {
        let mut spawn = Event {
            tick: 32,
            x_coord: 3173,
            y_coord: 4456,
            ..Default::default()
        };
        spawn.set_type(event::Type::NpcSpawn);
        spawn.npc = Some(event::Npc {
            id: 8366,
            room_id: 56729,
            r#type: Some(event::npc::Type::MaidenCrab(event::npc::MaidenCrab {
                spawn: 0,
                position: 1,
                scuffed: false,
            })),
            ..Default::default()
        });
        let mut death = Event {
            tick: 42,
            x_coord: 3170,
            y_coord: 4453,
            ..Default::default()
        };
        death.set_type(event::Type::NpcDeath);
        death.npc = Some(event::Npc {
            id: 8366,
            room_id: 56729,
            ..Default::default()
        });

        let mut ctx = context();
        track_event(&mut ctx, &spawn);
        track_event(&mut ctx, &death);

        assert_eq!(
            ctx.npc(56729),
            Some(&RoomNpc {
                spawn_npc_id: 8366,
                room_id: 56729,
                spawn_tick: 32,
                spawn_point: (3173, 4456),
                death_tick: 42,
                death_point: (3170, 4453),
                kind: Some(event::npc::Type::MaidenCrab(event::npc::MaidenCrab {
                    spawn: 0,
                    position: 1,
                    scuffed: false,
                })),
            }),
        );
        assert_eq!(ctx.npcs().count(), 1);
    }

    #[test]
    fn npc_death_without_a_tracked_spawn_is_ignored() {
        let mut death = Event {
            tick: 9,
            ..Default::default()
        };
        death.set_type(event::Type::NpcDeath);
        death.npc = Some(event::Npc {
            id: 8366,
            room_id: 250,
            ..Default::default()
        });

        let mut ctx = context();
        track_event(&mut ctx, &death);
        assert_eq!(ctx.npc(250), None);
    }

    #[test]
    fn player_deaths_are_recorded_by_party_index() {
        let mut ctx = context();
        track_event(
            &mut ctx,
            &event_with_player(event::Type::PlayerDeath, 10, "WWWWWWWWWWQQ", 1),
        );
        track_event(
            &mut ctx,
            &event_with_player(event::Type::PlayerDeath, 25, "1Ogp", 0),
        );
        assert_eq!(ctx.deaths(), &[1, 0]);
    }

    #[test]
    fn death_of_an_unknown_player_is_not_recorded() {
        let mut ctx = context();
        track_event(
            &mut ctx,
            &event_with_player(event::Type::PlayerDeath, 5, "TobDataEgirl", u32::MAX),
        );
        assert!(ctx.deaths().is_empty());
    }

    #[test]
    fn gear_is_determined_once_from_added_equipment() {
        let mut ctx = context();
        track_event(
            &mut ctx,
            &update_with_deltas(
                "1Ogp",
                0,
                vec![ItemDelta::Add(EquipmentSlot::Torso, item::id::TORVA_PLATEBODY, 1).to_raw()],
            ),
        );
        track_event(
            &mut ctx,
            &update_with_deltas(
                "1Ogp",
                0,
                vec![ItemDelta::Add(EquipmentSlot::Torso, item::id::BANDOS_CHESTPLATE, 1).to_raw()],
            ),
        );
        let gear: Vec<_> = ctx.players().iter().map(|p| p.gear).collect();
        assert_eq!(gear, [Some(PrimaryMeleeGear::Torva), None]);
    }

    #[test]
    fn removed_equipment_does_not_determine_gear() {
        let mut ctx = context();
        track_event(
            &mut ctx,
            &update_with_deltas(
                "1Ogp",
                0,
                vec![
                    ItemDelta::Remove(EquipmentSlot::Torso, item::id::TORVA_PLATEBODY, 1).to_raw(),
                ],
            ),
        );
        let gear: Vec<_> = ctx.players().iter().map(|p| p.gear).collect();
        assert_eq!(gear, [None, None]);
    }

    #[test]
    fn into_kept_events_returns_the_processors_kept_subsequence() {
        struct KeepEvenMarkers;

        #[async_trait::async_trait]
        impl ChallengeProcessor for KeepEvenMarkers {
            fn process_challenge_event(
                &mut self,
                _ctx: &mut StageContext,
                events: &mut EventCursor<'_>,
            ) -> bool {
                events.current().x_coord % 2 == 0
            }

            async fn on_create(&mut self, _txn: &db::Transaction) -> Result<(), db::Error> {
                Ok(())
            }

            async fn on_stage_finished(
                &mut self,
                _txn: &db::Transaction,
                _stored: &super::super::StoredState,
                _ctx: &mut StageContext,
                _stage: Stage,
                _events: &MergedEvents,
            ) -> Result<(), db::Error> {
                Ok(())
            }

            async fn on_finish(
                &mut self,
                _txn: &db::Transaction,
                _ctx: &mut ChallengeContext,
                _final_ticks: u32,
            ) -> Result<(), db::Error> {
                Ok(())
            }

            fn custom_data(&self) -> Option<serde_json::Value> {
                None
            }

            fn challenge_data(&self) -> Option<crate::proto::ChallengeData> {
                None
            }

            fn has_fully_recorded_up_to(&self, _stage: Stage) -> bool {
                false
            }
        }

        let marker = |tick: u32, x_coord: i32| Event {
            tick,
            x_coord,
            ..Default::default()
        };
        let message = ChallengeEvents {
            events: vec![
                marker(0, 4),
                marker(0, 7),
                marker(1, 2),
                marker(2, 9),
                marker(2, 6),
                marker(3, 1),
            ],
            ..Default::default()
        };
        let info = ChallengeInfo {
            uuid: "a8cb035f-410a-45de-a4d3-2b0a5d8b464d".parse().unwrap(),
            challenge_type: ChallengeType::Mokhaiotl,
            mode: ChallengeMode::NoMode,
            party: vec!["1Ogp".to_string()],
            party_changed: false,
            stage: Stage::MokhaiotlDelve1,
            stage_attempt: None,
            status: ChallengeStatus::InProgress,
            created_unix_ms: 0,
            reported_times: None,
            finished_unix_ms: None,
        };

        let output = interpret(
            info,
            vec![ClientStageStream::Events {
                client_id: ClientId(1),
                events: Bytes::from(message.encode_to_vec()),
            }],
            &mut KeepEvenMarkers,
        )
        .unwrap();

        assert_eq!(output.kept, vec![0, 2, 4]);
        assert_eq!(
            output.into_kept_events(),
            vec![marker(0, 4), marker(1, 2), marker(2, 6)],
        );
    }
}

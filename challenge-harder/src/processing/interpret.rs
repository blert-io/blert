//! Stage event reconstruction and interpretation.

// TODO(frolv): Remove once the context's full surface has consumers.
#![cfg_attr(not(test), expect(dead_code))]

use std::collections::BTreeMap;

use crate::item::{self, ItemDelta};
use crate::lifecycle::core::types::{ClientStageStream, PrimaryMeleeGear, Stage, Uuid};
use crate::merging::{self, MergedEvents};
use crate::proto::{Event, event};

use super::ChallengeInfo;
use super::challenge_processor::{ChallengeProcessor, EventCursor};

/// An NPC tracked through a stage.
#[derive(Debug, Clone, PartialEq)]
pub struct RoomNpc {
    pub spawn_npc_id: u32,
    pub room_id: u64,
    pub spawn_tick: u32,
    pub spawn_point: (i32, i32),
    pub death_tick: u32,
    pub death_point: (i32, i32),
    pub kind: Option<event::npc::Type>,
}

/// Generic stage state accumulated by the event loop.
#[derive(Debug)]
pub struct StageContext {
    party: Vec<String>,
    npcs: BTreeMap<u64, RoomNpc>,
    /// Party indices of players who died this stage, in death order.
    deaths: Vec<usize>,
    /// Primary melee gear determined for each player this stage.
    gear: Vec<Option<PrimaryMeleeGear>>,
}

impl StageContext {
    fn new(party: Vec<String>) -> StageContext {
        let scale = party.len();
        StageContext {
            party,
            npcs: BTreeMap::new(),
            deaths: Vec::new(),
            gear: vec![None; scale],
        }
    }

    pub fn party(&self) -> &[String] {
        &self.party
    }

    pub fn scale(&self) -> usize {
        self.party.len()
    }

    /// Returns the tracked NPC with the given room ID.
    pub fn npc(&self, room_id: u64) -> Option<&RoomNpc> {
        self.npcs.get(&room_id)
    }

    /// Iterates over every NPC tracked this stage.
    pub fn npcs(&self) -> impl Iterator<Item = &RoomNpc> {
        self.npcs.values()
    }

    /// Party indices of players who died this stage, in death order.
    pub fn deaths(&self) -> &[usize] {
        &self.deaths
    }

    pub(super) fn gear(&self) -> &[Option<PrimaryMeleeGear>] {
        &self.gear
    }

    /// Returns the index of `username` in the party.
    fn party_index(&self, username: &str) -> Option<usize> {
        self.party.iter().position(|name| name == username)
    }
}

/// The interpreted result of a stage's events.
#[derive(Debug)]
pub struct InterpretOutput {
    pub(super) events: MergedEvents,
    /// Indices into `events` of the events kept for storage.
    pub(super) kept: Vec<usize>,
    pub(super) ctx: StageContext,
}

/// A failure to interpret a stage's recorded data.
#[derive(Debug)]
pub enum InterpretError {
    /// The stage has no recorded data to process.
    NoData,
}

/// Processes a stage's raw events into a canonical timeline.
pub fn interpret(
    uuid: Uuid,
    challenge: ChallengeInfo,
    stage: Stage,
    records: Vec<ClientStageStream>,
    processor: &mut dyn ChallengeProcessor,
) -> Result<InterpretOutput, InterpretError> {
    let mut events = merging::merge(uuid, stage, records).ok_or(InterpretError::NoData)?;

    let ChallengeInfo {
        party,
        party_changed,
        ..
    } = challenge;

    let mut ctx = StageContext::new(party);
    let mut kept = Vec::with_capacity(events.len());
    let mut unknown_players: BTreeMap<String, u32> = BTreeMap::new();

    // TODO(frolv): hoist party index as a preprocessing step
    for index in 0..events.len() {
        {
            let event = &events[index];
            if let Some(player) = &event.player
                && ctx.party_index(&player.name).is_none()
            {
                *unknown_players.entry(player.name.clone()).or_default() += 1;
                continue;
            }
            track_event(&mut ctx, event);
        }

        let mut cursor = EventCursor::new(&mut events, index);
        if processor.process_challenge_event(&mut ctx, &mut cursor) {
            kept.push(index);
        }
    }

    if !unknown_players.is_empty() {
        tracing::error!(
            %uuid,
            players = ?unknown_players,
            "challenge_event_unknown_players",
        );
    }

    if party_changed {
        events.restrict_accuracy_to(0);
    }

    Ok(InterpretOutput { events, kept, ctx })
}

/// Handles a single event, updating state if necessary.
fn track_event(ctx: &mut StageContext, event: &Event) {
    match event.r#type() {
        event::Type::PlayerUpdate => {
            if let Some(player) = &event.player
                && let Some(index) = ctx.party_index(&player.name)
                && ctx.gear[index].is_none()
                && let Some(gear) = try_determine_gear(player)
            {
                ctx.gear[index] = Some(gear);
            }
        }
        event::Type::PlayerDeath => {
            if let Some(player) = &event.player
                && let Some(index) = ctx.party_index(&player.name)
            {
                ctx.deaths.push(index);
            }
        }
        event::Type::NpcSpawn => {
            if let Some(npc) = &event.npc {
                ctx.npcs.insert(
                    npc.room_id,
                    RoomNpc {
                        spawn_npc_id: npc.id,
                        room_id: npc.room_id,
                        spawn_tick: event.tick,
                        spawn_point: (event.x_coord, event.y_coord),
                        death_tick: 0,
                        death_point: (0, 0),
                        kind: npc.r#type,
                    },
                );
            }
        }
        event::Type::NpcDeath => {
            if let Some(npc) = &event.npc
                && let Some(room_npc) = ctx.npcs.get_mut(&npc.room_id)
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
    use super::*;
    use crate::proto::event::player::EquipmentSlot;

    fn context() -> StageContext {
        StageContext::new(vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()])
    }

    fn event_with_player(kind: event::Type, tick: u32, name: &str) -> Event {
        let mut event = Event {
            tick,
            ..Default::default()
        };
        event.set_type(kind);
        event.player = Some(event::Player {
            name: name.to_string(),
            ..Default::default()
        });
        event
    }

    fn update_with_deltas(name: &str, deltas: Vec<u64>) -> Event {
        let mut event = event_with_player(event::Type::PlayerUpdate, 1, name);
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
            &event_with_player(event::Type::PlayerDeath, 10, "WWWWWWWWWWQQ"),
        );
        track_event(
            &mut ctx,
            &event_with_player(event::Type::PlayerDeath, 25, "1Ogp"),
        );
        assert_eq!(ctx.deaths(), &[1, 0]);
    }

    #[test]
    fn death_of_an_unknown_player_is_not_recorded() {
        let mut ctx = context();
        track_event(
            &mut ctx,
            &event_with_player(event::Type::PlayerDeath, 5, "TobDataEgirl"),
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
                vec![ItemDelta::Add(EquipmentSlot::Torso, item::id::TORVA_PLATEBODY, 1).to_raw()],
            ),
        );
        track_event(
            &mut ctx,
            &update_with_deltas(
                "1Ogp",
                vec![ItemDelta::Add(EquipmentSlot::Torso, item::id::BANDOS_CHESTPLATE, 1).to_raw()],
            ),
        );
        assert_eq!(ctx.gear(), &[Some(PrimaryMeleeGear::Torva), None]);
    }

    #[test]
    fn removed_equipment_does_not_determine_gear() {
        let mut ctx = context();
        track_event(
            &mut ctx,
            &update_with_deltas(
                "1Ogp",
                vec![
                    ItemDelta::Remove(EquipmentSlot::Torso, item::id::TORVA_PLATEBODY, 1).to_raw(),
                ],
            ),
        );
        assert_eq!(ctx.gear(), &[None, None]);
    }
}

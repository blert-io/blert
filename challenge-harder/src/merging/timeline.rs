//! A timeline of recorded game state and events.
#![expect(dead_code)]

use std::collections::{BTreeMap, HashMap, HashSet};

use crate::item::ItemDelta;
use crate::lifecycle::core::types::ClientId;
use crate::prayer::{PrayerBook, PrayerSet};
use crate::proto::event::player::{DataSource, EquipmentSlot};
use crate::proto::{Coords, Event, NpcAttack, PlayerAttack, PlayerSpell, Stage, event};
use crate::skill::SkillLevel;

use super::MergeContext;
use super::event::{Class, MalformedEvent, TaggedEvent, classify};

#[derive(Debug, Clone, Default)]
pub struct Timeline {
    ticks: Vec<Option<TickState>>,
}

impl Timeline {
    /// Creates an empty timeline.
    pub fn new() -> Self {
        Self { ticks: Vec::new() }
    }

    /// Initializes a timeline from a chronological list of events,
    /// preprocessed with sources and indices.
    pub(super) fn build(
        party: &[String],
        recorded_ticks: u32,
        events: Vec<TaggedEvent>,
    ) -> Result<Self, MalformedEvent> {
        let mut ticks = vec![None; (recorded_ticks as usize) + 1];

        let mut last_player_updates = vec![None; party.len()];
        let mut current_tick: Vec<TaggedEvent> = Vec::with_capacity(events.len());

        let mut drain = |curr: &mut Vec<TaggedEvent>| -> Result<(), MalformedEvent> {
            let t = curr[0].tick;
            let state = TickState::from_events(
                t,
                party,
                &ticks[..t as usize],
                &mut last_player_updates,
                curr.drain(..),
            )?;
            ticks[t as usize] = Some(state);
            Ok(())
        };

        for event in events {
            if !current_tick.is_empty() && event.tick != current_tick[0].tick {
                drain(&mut current_tick)?;
            }
            current_tick.push(event);
        }
        if !current_tick.is_empty() {
            drain(&mut current_tick)?;
        }

        Ok(Self { ticks })
    }

    /// Returns the number of ticks in the timeline.
    pub fn tick_count(&self) -> u32 {
        u32::try_from(self.ticks.len()).expect("tick count is small")
    }

    /// Returns the final recorded tick, or `None` for a timeline with no ticks.
    pub fn last_tick(&self) -> Option<u32> {
        self.tick_count().checked_sub(1)
    }

    /// Returns the state on `tick`.
    pub fn get(&self, tick: u32) -> Option<&TickState> {
        self.ticks.get(tick as usize)?.as_ref()
    }

    /// Returns a mutable reference the state on `tick`.
    pub fn get_mut(&mut self, tick: u32) -> Option<&mut TickState> {
        self.ticks.get_mut(tick as usize)?.as_mut()
    }

    /// Returns the full timeline as ticks.
    pub fn ticks(&self) -> &[Option<TickState>] {
        &self.ticks
    }

    pub fn finalize(mut self, ctx: &MergeContext) -> Vec<Event> {
        self.resynchronize(ctx.stage);
        super::derivation::derive_events(ctx, &mut self);
        super::derivation::merge_stage_data(ctx, &mut self);
        self.ticks
            .into_iter()
            .flatten()
            .flat_map(TickState::into_events)
            .collect()
    }

    /// Rebuilds the timeline's canonical events from its consolidated state.
    fn resynchronize(&mut self, stage: Stage) {
        let mut ctx = ResyncContext::for_stage(stage);
        for tick in self.ticks.iter_mut().flatten() {
            tick.resynchronize(stage, &mut ctx);
        }
    }
}

#[derive(Debug)]
struct ResyncContext {
    /// The last known state of each player.
    previous_players: HashMap<String, PlayerState>,
    /// The last known state of each NPC.
    previous_npcs: HashMap<u64, NpcState>,
    /// Players who died on an earlier tick.
    dead_players: HashSet<String>,
    /// NPCs which died on an earlier tick.
    dead_npcs: HashSet<u64>,
    /// Stage-specific accumulated state.
    stage_custom: StageResync,
}

impl ResyncContext {
    fn for_stage(stage: Stage) -> Self {
        Self {
            previous_players: HashMap::new(),
            previous_npcs: HashMap::new(),
            dead_players: HashSet::new(),
            dead_npcs: HashSet::new(),
            stage_custom: StageResync::new(stage),
        }
    }
}

#[derive(Debug)]
enum StageResync {
    None,
    Sotetseg {
        /// The maze currently in progress.
        current_maze: Option<event::sote_maze::Maze>,
    },
}

impl StageResync {
    fn new(stage: Stage) -> Self {
        match stage {
            Stage::TobSotetseg => Self::Sotetseg { current_maze: None },
            _ => Self::None,
        }
    }

    /// Reads a tick's events, updating any state they affect.
    fn observe(&mut self, events: &[TaggedEvent]) {
        match self {
            Self::Sotetseg { current_maze } => {
                for event in events {
                    match event.r#type() {
                        event::Type::TobSoteMazeProc => {
                            *current_maze = event.sote_maze.as_ref().map(event::SoteMaze::maze);
                        }
                        event::Type::TobSoteMazeEnd => {
                            *current_maze = None;
                        }
                        _ => {}
                    }
                }
            }
            Self::None => {}
        }
    }
}

/// A value paired with the client whose recording it came from.
#[derive(Debug, Clone)]
pub struct Sourced<T> {
    pub source: ClientId,
    pub value: T,
}

const NUM_EQUIPMENT_SLOTS: usize = EquipmentSlot::Quiver as usize + 1;

#[derive(Debug, Clone, Copy)]
pub struct EquippedItem {
    pub id: i32,
    pub quantity: i32,
}

/// The target of an action.
#[derive(Debug, Clone)]
pub enum Target {
    Npc { id: u32, room_id: u64 },
    Player(String),
}

#[derive(Debug, Clone)]
pub struct PlayerAttacked {
    pub kind: PlayerAttack,
    pub weapon: Option<EquippedItem>,
    pub target: Option<Sourced<Target>>,
    pub distance_to_target: i32,
}

#[derive(Debug, Clone)]
pub struct PlayerCast {
    pub kind: PlayerSpell,
    pub target: Option<Sourced<Target>>,
}

#[derive(Debug, Clone)]
pub struct PlayerStats {
    pub hitpoints: SkillLevel,
    pub prayer: SkillLevel,
    pub attack: SkillLevel,
    pub strength: SkillLevel,
    pub defence: SkillLevel,
    pub ranged: SkillLevel,
    pub magic: SkillLevel,
}

/// A party member's state on a tick.
#[derive(Debug, Clone)]
pub struct PlayerState {
    /// The client whose recording this view came from.
    pub source: ClientId,
    pub party_index: u32,
    pub data_source: DataSource,
    pub position: Coords,
    pub died: bool,
    pub equipment: [Option<EquippedItem>; NUM_EQUIPMENT_SLOTS],
    pub prayers: PrayerSet,
    pub attack: Option<Sourced<PlayerAttacked>>,
    pub spell: Option<Sourced<PlayerCast>>,
    pub stats: Option<PlayerStats>,
    pub off_cooldown_tick: u32,
}

fn expect_player(event: &Event) -> Result<&event::Player, MalformedEvent> {
    let Some(player) = &event.player else {
        return Err(MalformedEvent::MissingPayload {
            kind: event.r#type(),
            tick: event.tick,
            field: "player",
        });
    };
    Ok(player)
}

fn extract_player_state(
    event: &TaggedEvent,
    players: &mut BTreeMap<String, Option<PlayerState>>,
    history: &[Option<TickState>],
    last_players: &mut [Option<u32>],
) -> Result<(), MalformedEvent> {
    let player = expect_player(event)?;

    let last = last_players[player.party_index as usize].and_then(|tick| {
        history.get(tick as usize).and_then(|state| {
            state
                .as_ref()
                .and_then(|state| state.players.get(&player.name).and_then(Option::as_ref))
        })
    });

    let state = players
        .entry(player.name.clone())
        .or_default()
        .get_or_insert_with(|| PlayerState {
            source: event.source(),
            party_index: player.party_index,
            data_source: DataSource::Secondary,
            position: (event.x_coord, event.y_coord).into(),
            died: false,
            equipment: last.map_or([None; NUM_EQUIPMENT_SLOTS], |state| state.equipment),
            prayers: PrayerSet::empty(PrayerBook::Normal),
            attack: None,
            spell: None,
            stats: None,
            off_cooldown_tick: 0,
        });

    match event.r#type() {
        event::Type::PlayerUpdate => {
            state.data_source = player.data_source();
            state.position = (event.x_coord, event.y_coord).into();
            state.equipment =
                parse_equipment(player, last).map_err(|raw| MalformedEvent::OutOfDomain {
                    kind: event.r#type(),
                    tick: event.tick,
                    field: "player.equipment_deltas",
                    value: raw.to_string(),
                })?;
            state.prayers = PrayerSet::from_raw(player.active_prayers());
            state.stats = parse_stats(player);
        }
        event::Type::PlayerDeath => state.died = true,
        _ => unreachable!(),
    }

    last_players[player.party_index as usize] = Some(event.tick);
    Ok(())
}

/// Applies a player's equipments deltas onto their previous state,
/// or rebuilds from scratch on a snapshot.
fn parse_equipment(
    player: &event::Player,
    last: Option<&PlayerState>,
) -> Result<[Option<EquippedItem>; NUM_EQUIPMENT_SLOTS], u64> {
    let mut equipment = if player.snapshot {
        [None; NUM_EQUIPMENT_SLOTS]
    } else {
        last.map_or([None; NUM_EQUIPMENT_SLOTS], |state| state.equipment)
    };

    for &raw in &player.equipment_deltas {
        match ItemDelta::parse(raw).map_err(|_| raw)? {
            ItemDelta::Add(slot, id, quantity) => {
                let slot = slot as usize;
                equipment[slot] = match equipment[slot] {
                    Some(item) if item.id == id => Some(EquippedItem {
                        id,
                        quantity: item.quantity + quantity,
                    }),
                    _ => Some(EquippedItem { id, quantity }),
                };
            }
            ItemDelta::Remove(slot, id, quantity) => {
                let slot = slot as usize;
                equipment[slot] = match equipment[slot] {
                    Some(item) if item.id == id && quantity < item.quantity => Some(EquippedItem {
                        id,
                        quantity: item.quantity - quantity,
                    }),
                    _ => None,
                };
            }
        }
    }

    Ok(equipment)
}

/// Rebuilds a player's equipment deltas relative to their previous state.
fn create_equipment_deltas(state: &PlayerState, previous: Option<&PlayerState>) -> Vec<u64> {
    let mut deltas = Vec::with_capacity(NUM_EQUIPMENT_SLOTS);

    for index in 0..NUM_EQUIPMENT_SLOTS {
        let slot = i32::try_from(index)
            .ok()
            .and_then(|i| EquipmentSlot::try_from(i).ok())
            .expect("every equipment index is a slot");
        let prev = previous.and_then(|state| state.equipment[index]);

        match (state.equipment[index], prev) {
            (Some(curr), Some(prev)) if curr.id == prev.id => {
                let delta = curr.quantity - prev.quantity;
                if delta != 0 {
                    let delta = if delta > 0 {
                        ItemDelta::Add(slot, curr.id, delta)
                    } else {
                        ItemDelta::Remove(slot, curr.id, -delta)
                    };
                    deltas.push(delta.to_raw());
                }
            }
            (Some(curr), _) => deltas.push(ItemDelta::Add(slot, curr.id, curr.quantity).to_raw()),
            (None, Some(prev)) => {
                deltas.push(ItemDelta::Remove(slot, prev.id, prev.quantity).to_raw());
            }
            (None, None) => {}
        }
    }

    deltas
}

fn parse_stats(player: &event::Player) -> Option<PlayerStats> {
    // These are individually optional in the proto wire format, but a
    // client either knows all of them or none.
    let stats = PlayerStats {
        hitpoints: SkillLevel::from_raw(player.hitpoints?),
        prayer: SkillLevel::from_raw(player.prayer?),
        attack: SkillLevel::from_raw(player.attack?),
        strength: SkillLevel::from_raw(player.strength?),
        defence: SkillLevel::from_raw(player.defence?),
        ranged: SkillLevel::from_raw(player.ranged?),
        magic: SkillLevel::from_raw(player.magic?),
    };

    Some(stats)
}

fn parse_player_attack(source: ClientId, attack: &event::Attack) -> PlayerAttacked {
    PlayerAttacked {
        kind: attack.r#type(),
        weapon: attack.weapon.map(|weapon| EquippedItem {
            id: weapon.id.cast_signed(),
            quantity: weapon.quantity.cast_signed(),
        }),
        // Jagex moment: defend against invalid target data.
        target: attack
            .target
            .as_ref()
            .filter(|npc| npc.id > 0 && npc.room_id > 0)
            .map(|npc| Sourced {
                source,
                value: Target::Npc {
                    id: npc.id,
                    room_id: npc.room_id,
                },
            }),
        distance_to_target: attack.distance_to_target,
    }
}

#[derive(Debug, Clone)]
pub struct NpcAttacked {
    pub kind: NpcAttack,
    pub target: Option<Sourced<Target>>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum NpcSubtype {
    MaidenCrab(event::npc::MaidenCrab),
    Nylo(event::npc::Nylo),
    VerzikCrab(event::npc::VerzikCrab),
}

impl NpcSubtype {
    fn to_proto(&self) -> event::npc::Type {
        match self {
            NpcSubtype::MaidenCrab(crab) => event::npc::Type::MaidenCrab(*crab),
            NpcSubtype::Nylo(nylo) => event::npc::Type::Nylo(*nylo),
            NpcSubtype::VerzikCrab(crab) => event::npc::Type::VerzikCrab(*crab),
        }
    }
}

/// An NPC's state on a tick.
#[derive(Debug, Clone)]
pub struct NpcState {
    /// The client whose recording this view came from.
    pub source: ClientId,
    pub id: u32,
    pub position: Coords,
    pub hitpoints: SkillLevel,
    pub prayers: PrayerSet,
    pub attack: Option<Sourced<NpcAttacked>>,
    pub subtype: Option<NpcSubtype>,
}

fn expect_npc(event: &Event) -> Result<&event::Npc, MalformedEvent> {
    let Some(npc) = &event.npc else {
        return Err(MalformedEvent::MissingPayload {
            kind: event.r#type(),
            tick: event.tick,
            field: "npc",
        });
    };
    Ok(npc)
}

fn extract_npc_state(
    event: &TaggedEvent,
    previous: Option<&TickState>,
) -> Result<(u64, NpcState), MalformedEvent> {
    let npc = expect_npc(event)?;
    let prior = previous.and_then(|state| state.npcs.get(&npc.room_id));

    // An NPC ID should never be 0 when it is initially reported. Under past
    // bugged versions of the RuneLite NPC cache, the ID could be lost for a
    // tick. This likely doesn't happen anymore, but it doesn't hurt to carry
    // forward.
    let id = if npc.id == 0 {
        prior.map_or(0, |p| p.id)
    } else {
        npc.id
    };

    let state = NpcState {
        source: event.source(),
        id,
        position: (event.x_coord, event.y_coord).into(),
        hitpoints: SkillLevel::from_raw(npc.hitpoints),
        prayers: PrayerSet::from_raw(npc.active_prayers),
        attack: None,
        subtype: extract_npc_subtype(npc).or(prior.and_then(|p| p.subtype.clone())),
    };

    Ok((npc.room_id, state))
}

fn extract_npc_subtype(npc: &event::Npc) -> Option<NpcSubtype> {
    match npc.r#type? {
        event::npc::Type::Basic(()) => None,
        event::npc::Type::MaidenCrab(crab) => Some(NpcSubtype::MaidenCrab(crab)),
        event::npc::Type::Nylo(nylo) => Some(NpcSubtype::Nylo(nylo)),
        event::npc::Type::VerzikCrab(crab) => Some(NpcSubtype::VerzikCrab(crab)),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
enum GraphicsKind {
    MaidenBloodSplats,
    SoteMazeTiles,
    VerzikYellows,
}

#[derive(Debug, Default, Clone)]
struct GraphicsState(BTreeMap<GraphicsKind, BTreeMap<Coords, ClientId>>);

impl GraphicsState {
    fn extend_from(&mut self, kind: GraphicsKind, source: ClientId, coords: &[Coords]) {
        let map = &mut *self.0.entry(kind).or_default();
        for coord in coords {
            map.entry(*coord).or_insert(source);
        }
    }
}

#[derive(Debug, Clone)]
pub struct TickState {
    tick: u32,
    events: Vec<TaggedEvent>,
    /// Players visible on the tick.
    players: BTreeMap<String, Option<PlayerState>>,
    /// NPCs visible on the tick, by room ID.
    npcs: BTreeMap<u64, NpcState>,
    /// Objects visible on the tick.
    graphics: GraphicsState,
}

impl TickState {
    pub(super) fn tick(&self) -> u32 {
        self.tick
    }

    pub(super) fn player(&self, name: &str) -> Option<&PlayerState> {
        self.players.get(name).and_then(Option::as_ref)
    }

    /// Returns the NPCs visible on the tick.
    pub(super) fn npcs(&self) -> impl Iterator<Item = (u64, &NpcState)> {
        self.npcs.iter().map(|(room_id, npc)| (*room_id, npc))
    }

    /// Returns the NPC with `room_id`, if visible on the tick.
    pub(super) fn npc(&self, room_id: u64) -> Option<&NpcState> {
        self.npcs.get(&room_id)
    }

    /// Returns the tick's events of `kind`.
    pub(super) fn events_of_type(&self, kind: event::Type) -> impl Iterator<Item = &TaggedEvent> {
        self.events
            .iter()
            .filter(move |event| event.r#type() == kind)
    }

    /// Inserts a synthetically created event into the tick.
    pub(super) fn add_synthetic_event(&mut self, event: Event) {
        self.events.push(TaggedEvent::synthetic(event));
    }

    fn from_events(
        tick: u32,
        party: &[String],
        history: &[Option<TickState>],
        last_players: &mut [Option<u32>],
        events: impl IntoIterator<Item = TaggedEvent>,
    ) -> Result<Self, MalformedEvent> {
        let mut players = party
            .iter()
            .map(|p| (p.clone(), None))
            .collect::<BTreeMap<_, _>>();
        let mut npcs = BTreeMap::new();
        let mut graphics = GraphicsState::default();

        let mut retained_events = Vec::new();
        let mut reprocess = Vec::new();

        for event in events {
            match event.r#type() {
                event::Type::NpcSpawn | event::Type::NpcUpdate => {
                    let (room_id, npc) =
                        extract_npc_state(&event, history.last().and_then(Option::as_ref))?;
                    npcs.insert(room_id, npc);
                }
                event::Type::NpcDeath => {
                    // Validate for later; no handling required now.
                    expect_npc(&event)?;
                }
                event::Type::PlayerUpdate | event::Type::PlayerDeath => {
                    extract_player_state(&event, &mut players, history, last_players)?;
                }
                event::Type::TobMaidenBloodSplats => {
                    graphics.extend_from(
                        GraphicsKind::MaidenBloodSplats,
                        event.source(),
                        &event.maiden_blood_splats,
                    );
                }
                event::Type::TobSoteMazePath => {
                    let Some(maze) = &event.sote_maze else {
                        return Err(MalformedEvent::MissingPayload {
                            kind: event.r#type(),
                            tick: event.tick,
                            field: "sote_maze",
                        });
                    };
                    graphics.extend_from(
                        GraphicsKind::SoteMazeTiles,
                        event.source(),
                        &maze.overworld_tiles,
                    );
                }
                event::Type::TobVerzikYellows => {
                    graphics.extend_from(
                        GraphicsKind::VerzikYellows,
                        event.source(),
                        &event.verzik_yellows,
                    );
                }
                _ => {}
            }

            match classify(event.r#type()) {
                Class::Derived | Class::TickState => {
                    if matches!(
                        event.r#type(),
                        event::Type::NpcAttack
                            | event::Type::PlayerAttack
                            | event::Type::PlayerSpell
                    ) {
                        reprocess.push(event);
                    }
                }
                Class::Solo | Class::Stream | Class::AttackMapped => {
                    retained_events.push(event);
                }
                Class::Deprecated => unreachable!("how naive 2024 blert was"),
            }
        }

        attach_actions(&mut players, &mut npcs, reprocess)?;

        Ok(Self {
            tick,
            events: retained_events,
            players,
            npcs,
            graphics,
        })
    }

    fn resynchronize(&mut self, stage: Stage, ctx: &mut ResyncContext) {
        // Update stage-specific state before making decisions for this tick.
        ctx.stage_custom.observe(&self.events);

        self.resynchronize_players(ctx);
        self.create_player_state_events(stage, ctx);
        self.create_npc_state_events(stage, ctx);
        self.create_graphics_events(stage, ctx);

        // Mark actor deaths starting from the following tick.
        for event in &mut self.events {
            match event.r#type() {
                event::Type::PlayerDeath => {
                    let player = event.player.as_ref().expect("validated at build");
                    if !player.name.is_empty() {
                        ctx.dead_players.insert(player.name.clone());
                    }
                }
                event::Type::NpcDeath => {
                    let npc = event.npc.as_mut().expect("validated at build");
                    ctx.dead_npcs.insert(npc.room_id);
                    if npc.id == 0
                        && let Some(prior) = ctx.previous_npcs.get(&npc.room_id)
                    {
                        npc.id = prior.id;
                    }
                }
                _ => {}
            }
        }

        for (name, state) in &self.players {
            if let Some(state) = state {
                ctx.previous_players.insert(name.clone(), state.clone());
            }
        }
        for (&room_id, npc) in &self.npcs {
            ctx.previous_npcs.insert(room_id, npc.clone());
        }
    }

    fn resynchronize_players(&mut self, ctx: &mut ResyncContext) {
        for (name, state) in &mut self.players {
            if ctx.dead_players.contains(name.as_str()) {
                continue;
            }
            let Some(state) = state else {
                continue;
            };

            state.off_cooldown_tick = if let Some(attack) = &state.attack {
                self.tick + attack.value.kind.cooldown()
            } else {
                ctx.previous_players
                    .get(name.as_str())
                    .map_or(0, |p| p.off_cooldown_tick)
            };
        }
    }

    #[expect(clippy::similar_names)]
    fn create_player_state_events(&mut self, stage: Stage, ctx: &ResyncContext) {
        let tick = self.tick;

        for (name, state) in &self.players {
            if ctx.dead_players.contains(name.as_str()) {
                continue;
            }
            let Some(state) = state else {
                continue;
            };
            let previous = ctx.previous_players.get(name.as_str());

            let base = |kind: event::Type| {
                let mut event = Event {
                    tick,
                    stage: stage as i32,
                    x_coord: state.position.x,
                    y_coord: state.position.y,
                    ..Default::default()
                };
                event.set_type(kind);
                event.player = Some(event::Player {
                    name: name.clone(),
                    party_index: state.party_index,
                    ..Default::default()
                });
                event
            };

            let mut update = base(event::Type::PlayerUpdate);
            let player = update.player.as_mut().expect("just constructed");
            player.data_source = state.data_source as i32;
            player.active_prayers = Some(state.prayers.to_raw());
            // Recreated equipment is always a delta instead of a snapshot as
            // it's built from internally consistent state.
            player.equipment_deltas = create_equipment_deltas(state, previous);
            player.off_cooldown_tick = state.off_cooldown_tick;
            if let Some(stats) = &state.stats {
                player.hitpoints = Some(stats.hitpoints.to_raw());
                player.prayer = Some(stats.prayer.to_raw());
                player.attack = Some(stats.attack.to_raw());
                player.strength = Some(stats.strength.to_raw());
                player.defence = Some(stats.defence.to_raw());
                player.ranged = Some(stats.ranged.to_raw());
                player.magic = Some(stats.magic.to_raw());
            }
            self.events.push(TaggedEvent::synthetic(update));

            if let Some(attack) = &state.attack {
                let attack = &attack.value;
                let mut event = base(event::Type::PlayerAttack);
                event.player_attack = Some(event::Attack {
                    r#type: attack.kind as i32,
                    weapon: attack.weapon.filter(|weapon| weapon.id > 0).map(|weapon| {
                        event::player::EquippedItem {
                            slot: EquipmentSlot::Weapon as i32,
                            id: weapon.id.cast_unsigned(),
                            quantity: weapon.quantity.cast_unsigned(),
                        }
                    }),
                    target: attack.target.as_ref().map(|target| match &target.value {
                        Target::Npc { id, room_id } => event::Npc {
                            id: *id,
                            room_id: *room_id,
                            ..Default::default()
                        },
                        Target::Player(_) => unreachable!("player attacks target npcs"),
                    }),
                    distance_to_target: attack.distance_to_target,
                });
                self.events.push(TaggedEvent::synthetic(event));
            }

            if let Some(spell) = &state.spell {
                let spell = &spell.value;
                let mut event = base(event::Type::PlayerSpell);
                event.player_spell = Some(event::Spell {
                    r#type: spell.kind as i32,
                    target: Some(spell.target.as_ref().map_or(
                        event::spell::Target::NoTarget(()),
                        |target| match &target.value {
                            Target::Player(name) => {
                                event::spell::Target::TargetPlayer(name.clone())
                            }
                            Target::Npc { id, room_id } => {
                                event::spell::Target::TargetNpc(event::Npc {
                                    id: *id,
                                    room_id: *room_id,
                                    ..Default::default()
                                })
                            }
                        },
                    )),
                });
                self.events.push(TaggedEvent::synthetic(event));
            }
        }
    }

    /// Synthesizes NPC events for the NPCs on the tick.
    ///
    /// Subtype fields are emitted only on ticks where they differ from the
    /// NPC's last known subtype, matching event wire semantics.
    fn create_npc_state_events(&mut self, stage: Stage, ctx: &ResyncContext) {
        let spawned = self
            .events
            .iter()
            .filter(|event| event.r#type() == event::Type::NpcSpawn)
            .map(|event| event.npc.as_ref().expect("validated at build").room_id)
            .collect::<HashSet<_>>();

        for (&room_id, state) in &self.npcs {
            if ctx.dead_npcs.contains(&room_id) {
                continue;
            }

            // Update and spawn events are mutually exclusive.
            if !spawned.contains(&room_id) {
                let mut event = Event {
                    tick: self.tick,
                    stage: stage as i32,
                    x_coord: state.position.x,
                    y_coord: state.position.y,
                    ..Default::default()
                };
                event.set_type(event::Type::NpcUpdate);
                let mut npc = event::Npc {
                    id: state.id,
                    room_id,
                    hitpoints: state.hitpoints.to_raw(),
                    active_prayers: state.prayers.to_raw(),
                    ..Default::default()
                };
                if let Some(subtype) = &state.subtype {
                    let previous = ctx
                        .previous_npcs
                        .get(&room_id)
                        .and_then(|prior| prior.subtype.as_ref());
                    if previous != Some(subtype) {
                        npc.r#type = Some(subtype.to_proto());
                    }
                }
                event.npc = Some(npc);
                self.events.push(TaggedEvent::synthetic(event));
            }

            if let Some(attack) = &state.attack {
                let mut event = Event {
                    tick: self.tick,
                    stage: stage as i32,
                    x_coord: state.position.x,
                    y_coord: state.position.y,
                    ..Default::default()
                };
                event.set_type(event::Type::NpcAttack);
                event.npc = Some(event::Npc {
                    id: state.id,
                    room_id,
                    ..Default::default()
                });
                event.npc_attack = Some(event::NpcAttacked {
                    attack: attack.value.kind as i32,
                    target: attack
                        .value
                        .target
                        .as_ref()
                        .map(|target| match &target.value {
                            Target::Player(name) => name.clone(),
                            Target::Npc { .. } => {
                                unreachable!("npc attacks only target players")
                            }
                        }),
                });
                self.events.push(TaggedEvent::synthetic(event));
            }
        }
    }

    /// Synthesizes graphics events from the graphics visible on the tick.
    fn create_graphics_events(&mut self, stage: Stage, ctx: &ResyncContext) {
        for (kind, coords) in &self.graphics.0 {
            let mut event = Event {
                tick: self.tick,
                stage: stage as i32,
                ..Default::default()
            };
            let coords: Vec<Coords> = coords.keys().copied().collect();

            match kind {
                GraphicsKind::MaidenBloodSplats => {
                    event.set_type(event::Type::TobMaidenBloodSplats);
                    event.maiden_blood_splats = coords;
                }
                GraphicsKind::SoteMazeTiles => {
                    let StageResync::Sotetseg {
                        current_maze: Some(maze),
                    } = &ctx.stage_custom
                    else {
                        // A path event without a maze is meaningless.
                        continue;
                    };
                    event.set_type(event::Type::TobSoteMazePath);
                    event.sote_maze = Some(event::SoteMaze {
                        maze: *maze as i32,
                        overworld_tiles: coords,
                        ..Default::default()
                    });
                }
                GraphicsKind::VerzikYellows => {
                    event.set_type(event::Type::TobVerzikYellows);
                    event.verzik_yellows = coords;
                }
            }
            self.events.push(TaggedEvent::synthetic(event));
        }
    }

    fn into_events(self) -> impl Iterator<Item = Event> {
        self.events.into_iter().map(|e| e.split().1)
    }
}

/// Attaches a tick's attack, spell, and death events to their actors' states.
fn attach_actions(
    players: &mut BTreeMap<String, Option<PlayerState>>,
    npcs: &mut BTreeMap<u64, NpcState>,
    actions: Vec<TaggedEvent>,
) -> Result<(), MalformedEvent> {
    for event in actions {
        match event.r#type() {
            event::Type::NpcAttack => {
                let npc = expect_npc(&event)?;
                let Some(attack) = &event.npc_attack else {
                    return Err(MalformedEvent::MissingPayload {
                        kind: event.r#type(),
                        tick: event.tick,
                        field: "npc_attack",
                    });
                };
                let Some(npc) = npcs.get_mut(&npc.room_id) else {
                    continue;
                };
                npc.attack = Some(Sourced {
                    source: event.source(),
                    value: NpcAttacked {
                        kind: attack.attack(),
                        target: attack.target.clone().map(|name| Sourced {
                            source: event.source(),
                            value: Target::Player(name),
                        }),
                    },
                });
            }
            event::Type::PlayerAttack => {
                let player = expect_player(&event)?;
                let Some(attack) = &event.player_attack else {
                    return Err(MalformedEvent::MissingPayload {
                        kind: event.r#type(),
                        tick: event.tick,
                        field: "player_attack",
                    });
                };
                let Some(Some(state)) = players.get_mut(&player.name) else {
                    continue;
                };
                let source = event.source();
                state.attack = Some(Sourced {
                    source,
                    value: parse_player_attack(source, attack),
                });
            }
            event::Type::PlayerSpell => {
                let (source, event) = event.split();
                let player = expect_player(&event)?;
                let Some(Some(state)) = players.get_mut(&player.name) else {
                    continue;
                };
                let Some(spell) = event.player_spell else {
                    return Err(MalformedEvent::MissingPayload {
                        kind: event.r#type(),
                        tick: event.tick,
                        field: "player_spell",
                    });
                };

                state.spell = Some(Sourced {
                    source,
                    value: PlayerCast {
                        kind: spell.r#type(),
                        target: match spell.target {
                            Some(event::spell::Target::TargetPlayer(name)) => Some(Sourced {
                                source,
                                value: Target::Player(name),
                            }),
                            Some(event::spell::Target::TargetNpc(npc)) => Some(Sourced {
                                source,
                                value: Target::Npc {
                                    id: npc.id,
                                    room_id: npc.room_id,
                                },
                            }),
                            _ => None,
                        },
                    },
                });
            }
            _ => {}
        }
    }

    Ok(())
}

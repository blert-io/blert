use std::collections::{BTreeMap, HashMap};

use crate::actor::{
    Actor, DataSource, MaidenCrab, NpcProperties, NpcState, Nylo, NyloSpawn, PartyIndex,
    PlayerState, Players, RoomId, Rsn, Stats, VerzikCrab,
};
use crate::event::{
    BloatDown, Event, EventKind, HandicapChoice, Maze, MokhaiotlLarvaLeak, MokhaiotlOrb,
    NpcAttacked, NpcDeath, NyloWave, PlayerAttacked, PlayerCast, SolDust, SolGrapple, SoteMazeEnd,
    SoteMazePivots, TotemHeal, VerzikBounce, VerzikDawnHit, VerzikHeal, XarpusExhumed, XarpusSplat,
    XarpusSplatSource,
};
use crate::item::{EQUIPMENT_SLOTS, EquipmentSlot, Item, ItemDelta};
use crate::objects::{ObjectKind, TickObjects};
use crate::prayer::PrayerSet;
use crate::proto::event::Type;
use crate::skill::SkillLevel;
use crate::tick::{Tick, Ticks};
use crate::{
    ChallengeMode, ClientId, ColosseumHandicap, CombatStyle, NpcAttack, PlayerAttack, Point, Rect,
    Source, Stage, npc, proto,
};

use super::{Recording, TickState};

/// A `Rejection` describes a failure to process an incoming proto event during
/// construction of a recording.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuildRejection {
    pub tick: Tick,
    pub kind: proto::event::Type,
    pub reason: RejectionReason,
}

/// The reason why an event could not be processed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RejectionReason {
    /// The event has an unknown wire type.
    UnknownType(i32),
    /// The event is from a different stage than the recording.
    WrongStage(Stage),
    /// The event is missing one or more required fields for its type.
    MissingPayload(&'static str),
    /// The value of a required field could not be represented.
    InvalidField {
        field: &'static str,
        error: FieldError,
    },
    /// The event's fields are individually valid, but describe a scenario that
    /// is inconsistent with the rules of the game. This could either be within
    /// the fields of the event itself, or when compared to past events.
    Inconsistent(&'static str),
    /// The event references an actor's past attack which does not exist.
    AttackNotFound,
    /// The recording was constructed with a known length, but the event falls
    /// beyond it.
    BeyondLastTick,
}

/// A `Warning` describes an issue with an optional field of an event. The event
/// is still processed, but the field's data is ignored and cleared.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuildWarning {
    pub tick: Tick,
    pub kind: proto::event::Type,
    pub field: &'static str,
    pub error: FieldError,
}

/// The reason why a field's value could not be represented.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FieldError {
    /// The value is outside of its permitted domain.
    OutOfDomain(String),
    /// The value references an actor who is not in the world.
    UnknownActor(RawActor),
}

/// A wire identifier for an actor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RawActor {
    Player(String),
    Npc(u64),
}

/// A builder for constructing a [`Recording`] from a stream of events.
///
/// A builder can either run as a single pass over a complete stream, or ingest
/// events incrementally in batches.
#[derive(Debug)]
pub struct RecordingBuilder {
    client_id: ClientId,
    stage: Stage,
    mode: ChallengeMode,
    party: Vec<Rsn>,
    reported_last_tick: Option<Tick>,
    events: BTreeMap<Tick, Vec<proto::Event>>,
    recording: Option<Recording>,
    last_seen_actors: HashMap<Actor, Tick>,
    rejections: BTreeMap<Tick, Vec<BuildRejection>>,
    warnings: BTreeMap<Tick, Vec<BuildWarning>>,
    legacy_objects: bool,
}

impl RecordingBuilder {
    /// Creates a new builder to process events recorded by `client_id` in a
    /// stage of a challenge with the given `party`.
    /// If the stream is complete, `reported_last_tick` indicates the total
    /// length of the recording.
    #[must_use]
    pub fn new(
        client_id: ClientId,
        stage: Stage,
        mode: ChallengeMode,
        party: Vec<Rsn>,
        reported_last_tick: Option<Tick>,
    ) -> Self {
        let recording =
            reported_last_tick.map(|t| Recording::vacant(stage, mode, party.clone(), t));

        Self {
            client_id,
            stage,
            mode,
            party,
            reported_last_tick,
            events: BTreeMap::new(),
            recording,
            last_seen_actors: HashMap::new(),
            rejections: BTreeMap::new(),
            warnings: BTreeMap::new(),
            legacy_objects: false,
        }
    }

    /// Processes the provided raw events into the recording, constructing state.
    ///
    /// Returns the earliest modified tick as a result of processing the batch.
    /// If the batch was a pure append, this will be the first tick beyond the
    /// recording's original length. Events that retroactively modify state will
    /// shift it earlier. A batch which did not modify any state returns `None`.
    ///
    /// Events that are rejected have their results recorded in the builder's
    /// rejection list for inspection.
    pub fn ingest(&mut self, events: impl IntoIterator<Item = proto::Event>) -> Option<Tick> {
        let start = self.add_raw_events(events)?;
        self.ingest_from(start)
    }

    // Returns every rejection recorded by the builder.
    pub fn rejections(&self) -> impl Iterator<Item = &BuildRejection> {
        self.rejections.values().flatten()
    }

    // Returns every warning recorded by the builder.
    pub fn warnings(&self) -> impl Iterator<Item = &BuildWarning> {
        self.warnings.values().flatten()
    }

    /// Returns a reference to the builder's partially-constructed recording.
    #[must_use]
    pub fn recording(&self) -> Option<&Recording> {
        self.recording.as_ref()
    }

    /// Consumes the builder, returning its final recording.
    #[must_use]
    pub fn into_recording(self) -> Option<Recording> {
        self.recording
    }

    /// Stores a batch of raw events, returning the earliest tick within them,
    /// or `None` if every event was rejected.
    fn add_raw_events(&mut self, events: impl IntoIterator<Item = proto::Event>) -> Option<Tick> {
        let mut start: Option<Tick> = None;
        for event in events {
            let tick = Tick(event.tick);
            let legacy_objects = match event.r#type() {
                Type::TobMaidenBloodSplats
                | Type::TobVerzikYellows
                | Type::ColosseumReentryPools
                | Type::MokhaiotlObjects
                | Type::MokhaiotlShockwave => true,
                Type::TobSoteMazePath => event
                    .sote_maze
                    .as_ref()
                    .is_some_and(|maze| !maze.overworld_tiles.is_empty()),
                _ => false,
            };
            if legacy_objects {
                self.legacy_objects = true;
            }

            if event.stage() != self.stage {
                self.rejections
                    .entry(tick)
                    .or_default()
                    .push(BuildRejection {
                        tick,
                        kind: event.r#type(),
                        reason: RejectionReason::WrongStage(event.stage()),
                    });
                continue;
            }

            if self.reported_last_tick.is_some_and(|last| tick > last) {
                self.rejections
                    .entry(tick)
                    .or_default()
                    .push(BuildRejection {
                        tick,
                        kind: event.r#type(),
                        reason: RejectionReason::BeyondLastTick,
                    });
                continue;
            }

            self.events.entry(tick).or_default().push(event);
            start = Some(start.map_or(tick, |start| start.min(tick)));
        }

        start
    }

    fn ingest_from(&mut self, start: Tick) -> Option<Tick> {
        let last_tick = self
            .reported_last_tick
            .or_else(|| self.events.keys().next_back().copied())?;

        let mut recording = self.recording.take().unwrap_or_else(|| {
            Recording::vacant(self.stage, self.mode, self.party.clone(), last_tick)
        });
        recording.extend_to(last_tick);

        let mut changed: Option<Tick> = None;
        let mut pending = self.events.split_off(&start);
        self.last_seen_actors.retain(|actor, last| {
            if *last < start {
                return true;
            }
            let last_seen = start.up_to().rev().find(|tick| {
                recording.get_state(*tick).is_some_and(|state| match actor {
                    Actor::Player(index) => state.players.get(*index).is_some(),
                    Actor::Npc(room_id) => state.npcs.contains_key(room_id),
                })
            });
            match last_seen {
                Some(tick) => {
                    *last = tick;
                    true
                }
                None => false,
            }
        });
        for (&tick, events) in &pending {
            self.rejections.remove(&tick);
            self.warnings.remove(&tick);
            let mut builder = TickBuilder::new(tick, self, &mut recording);
            for event in events {
                builder.process_event(event);
            }
            if let Some(modified) = builder.finish() {
                changed = Some(changed.map_or(modified, |changed| changed.min(modified)));
            }
        }
        self.events.append(&mut pending);
        self.recording = Some(recording);

        changed
    }
}

struct TickBuilder<'a> {
    client_id: ClientId,
    party: &'a [Rsn],
    tick: Tick,
    state: TickState,
    processed: usize,
    changed: Option<Tick>,
    attack_references: Vec<Event>,
    recording: &'a mut Recording,
    last_seen_actors: &'a mut HashMap<Actor, Tick>,
    rejections: &'a mut BTreeMap<Tick, Vec<BuildRejection>>,
    warnings: &'a mut BTreeMap<Tick, Vec<BuildWarning>>,
}

impl<'a> TickBuilder<'a> {
    fn new(tick: Tick, builder: &'a mut RecordingBuilder, recording: &'a mut Recording) -> Self {
        let mut objects = if tick == Tick(0) {
            TickObjects::default()
        } else {
            recording
                .get_state(tick.pred())
                .map_or_else(TickObjects::default, |previous| previous.objects.clone())
        };

        // Under legacy events, these kinds send full snapshots every tick,
        // where absence of the event means empty.
        if builder.legacy_objects {
            objects.clear(ObjectKind::MaidenBloodSplats);
            objects.clear(ObjectKind::SoteMazeTiles);
            objects.clear(ObjectKind::VerzikYellows);
            objects.clear(ObjectKind::MokhaiotlShockwave);
        }

        Self {
            client_id: builder.client_id,
            party: &builder.party,
            tick,
            state: TickState {
                players: Players::empty(builder.party.len()),
                npcs: BTreeMap::new(),
                objects,
                events: Vec::new(),
            },
            processed: 0,
            changed: None,
            attack_references: Vec::new(),
            recording,
            last_seen_actors: &mut builder.last_seen_actors,
            rejections: &mut builder.rejections,
            warnings: &mut builder.warnings,
        }
    }

    /// Handles a single raw event occurring on the tick.
    #[expect(clippy::too_many_lines, reason = "it's an exhaustive enum folks")]
    fn process_event(&mut self, event: &proto::Event) {
        let tick = self.tick;
        self.processed += 1;
        let kind = match Type::try_from(event.r#type) {
            Ok(kind) if kind != Type::Unspecified => kind,
            _ => {
                self.rejections
                    .entry(tick)
                    .or_default()
                    .push(BuildRejection {
                        tick,
                        kind: Type::Unspecified,
                        reason: RejectionReason::UnknownType(event.r#type),
                    });
                return;
            }
        };

        match kind {
            Type::Unspecified => unreachable!("rejected above"),

            Type::PlayerUpdate => {
                match extract_player_state(
                    self.client_id,
                    self.party,
                    self.recording,
                    self.last_seen_actors,
                    event,
                ) {
                    Ok((index, state)) => {
                        self.state.players[index] = Some(state);
                    }
                    Err(reason) => {
                        self.rejections
                            .entry(tick)
                            .or_default()
                            .push(BuildRejection { tick, kind, reason });
                    }
                }
            }

            Type::NpcSpawn | Type::NpcUpdate => {
                match extract_npc_state(
                    self.client_id,
                    self.recording,
                    self.last_seen_actors,
                    event,
                ) {
                    Ok((room_id, state)) => {
                        self.state.npcs.insert(room_id, state);
                    }
                    Err(reason) => {
                        self.rejections
                            .entry(tick)
                            .or_default()
                            .push(BuildRejection { tick, kind, reason });
                    }
                }
            }

            // Full snapshot legacy graphics.
            Type::TobMaidenBloodSplats | Type::TobVerzikYellows | Type::MokhaiotlShockwave => {
                let objects = match kind {
                    Type::TobMaidenBloodSplats => Ok((
                        ObjectKind::MaidenBloodSplats,
                        "maiden_blood_splats",
                        event.maiden_blood_splats.as_slice(),
                    )),
                    Type::TobVerzikYellows => Ok((
                        ObjectKind::VerzikYellows,
                        "verzik_yellows",
                        event.verzik_yellows.as_slice(),
                    )),
                    Type::MokhaiotlShockwave => event
                        .mokhaiotl_shockwave
                        .as_ref()
                        .required("mokhaiotl_shockwave")
                        .map(|shockwave| {
                            (
                                ObjectKind::MokhaiotlShockwave,
                                "mokhaiotl_shockwave.tiles",
                                shockwave.tiles.as_slice(),
                            )
                        }),
                    _ => unreachable!(),
                };
                let parsed = objects
                    .and_then(|(object, field, coords)| Ok((object, parse_points(field, coords)?)));
                match parsed {
                    Ok((object, points)) => {
                        self.state
                            .objects
                            .insert(object, Source::Client(self.client_id), points);
                    }
                    Err(reason) => {
                        self.rejections
                            .entry(tick)
                            .or_default()
                            .push(BuildRejection { tick, kind, reason });
                    }
                }
            }

            Type::ColosseumReentryPools => {
                let parsed = event
                    .colosseum_reentry_pools
                    .as_ref()
                    .required("colosseum_reentry_pools")
                    .and_then(|pools| {
                        Ok((
                            parse_points(
                                "colosseum_reentry_pools.primary_spawned",
                                &pools.primary_spawned,
                            )?,
                            parse_points(
                                "colosseum_reentry_pools.primary_despawned",
                                &pools.primary_despawned,
                            )?,
                            parse_points(
                                "colosseum_reentry_pools.secondary_spawned",
                                &pools.secondary_spawned,
                            )?,
                            parse_points(
                                "colosseum_reentry_pools.secondary_despawned",
                                &pools.secondary_despawned,
                            )?,
                        ))
                    });
                match parsed {
                    Ok((
                        primary_spawned,
                        primary_despawned,
                        secondary_spawned,
                        secondary_despawned,
                    )) => {
                        let source = Source::Client(self.client_id);
                        let objects = &mut self.state.objects;
                        objects.insert(
                            ObjectKind::ColosseumReentryPrimaryPool,
                            source,
                            primary_spawned,
                        );
                        objects.remove(ObjectKind::ColosseumReentryPrimaryPool, primary_despawned);
                        objects.insert(
                            ObjectKind::ColosseumReentrySecondaryPool,
                            source,
                            secondary_spawned,
                        );
                        objects.remove(
                            ObjectKind::ColosseumReentrySecondaryPool,
                            secondary_despawned,
                        );
                    }
                    Err(reason) => {
                        self.rejections
                            .entry(tick)
                            .or_default()
                            .push(BuildRejection { tick, kind, reason });
                    }
                }
            }

            Type::MokhaiotlObjects => {
                let parsed = event
                    .mokhaiotl_objects
                    .as_ref()
                    .required("mokhaiotl_objects")
                    .and_then(|objects| {
                        Ok((
                            parse_points(
                                "mokhaiotl_objects.rocks_spawned",
                                &objects.rocks_spawned,
                            )?,
                            parse_points(
                                "mokhaiotl_objects.rocks_despawned",
                                &objects.rocks_despawned,
                            )?,
                            parse_points(
                                "mokhaiotl_objects.splats_spawned",
                                &objects.splats_spawned,
                            )?,
                            parse_points(
                                "mokhaiotl_objects.splats_despawned",
                                &objects.splats_despawned,
                            )?,
                        ))
                    });
                match parsed {
                    Ok((rocks_spawned, rocks_despawned, splats_spawned, splats_despawned)) => {
                        let source = Source::Client(self.client_id);
                        let objects = &mut self.state.objects;
                        objects.insert(ObjectKind::MokhaiotlRock, source, rocks_spawned);
                        objects.remove(ObjectKind::MokhaiotlRock, rocks_despawned);
                        objects.insert(ObjectKind::MokhaiotlSplat, source, splats_spawned);
                        objects.remove(ObjectKind::MokhaiotlSplat, splats_despawned);
                    }
                    Err(reason) => {
                        self.rejections
                            .entry(tick)
                            .or_default()
                            .push(BuildRejection { tick, kind, reason });
                    }
                }
            }

            // Depending on the fields set, a maze path is either an
            // event or object state.
            Type::TobSoteMazePath => {
                let result = event
                    .sote_maze
                    .as_ref()
                    .required("sote_maze")
                    .and_then(|sote_maze| {
                        if !sote_maze.overworld_tiles.is_empty() {
                            let tiles = parse_points(
                                "sote_maze.overworld_tiles",
                                &sote_maze.overworld_tiles,
                            )?;
                            self.state.objects.insert(
                                ObjectKind::SoteMazeTiles,
                                Source::Client(self.client_id),
                                tiles,
                            );
                            return Ok(());
                        }

                        let maze = parse_maze(sote_maze)?;
                        let pivots = if sote_maze.underworld_pivots.is_empty() {
                            SoteMazePivots {
                                maze,
                                overworld: parse_coords(
                                    "sote_maze.overworld_pivots",
                                    &sote_maze.overworld_pivots,
                                )?,
                                underworld: Vec::new(),
                            }
                        } else {
                            SoteMazePivots {
                                maze,
                                overworld: Vec::new(),
                                underworld: parse_coords(
                                    "sote_maze.underworld_pivots",
                                    &sote_maze.underworld_pivots,
                                )?,
                            }
                        };
                        self.state.events.push(Event::recorded(
                            self.client_id,
                            EventKind::SoteMazePivots(pivots),
                        ));
                        Ok(())
                    });
                if let Err(reason) = result {
                    self.rejections
                        .entry(tick)
                        .or_default()
                        .push(BuildRejection { tick, kind, reason });
                }
            }

            // Modifies a past attack.
            Type::TobVerzikAttackStyle | Type::MokhaiotlAttackStyle => {
                match resolve_attack_style(self.recording, &mut self.state, event) {
                    Ok(Some(attack_tick)) => {
                        self.changed = Some(
                            self.changed
                                .map_or(attack_tick, |changed| changed.min(attack_tick)),
                        );
                    }
                    Ok(None) => {}
                    Err(reason) => {
                        self.rejections
                            .entry(tick)
                            .or_default()
                            .push(BuildRejection { tick, kind, reason });
                    }
                }
            }

            // Event types.
            Type::PlayerAttack
            | Type::PlayerSpell
            | Type::PlayerDeath
            | Type::NpcDeath
            | Type::NpcAttack
            | Type::TobMaidenCrabLeak
            | Type::TobBloatDown
            | Type::TobBloatUp
            | Type::TobBloatHandsDrop
            | Type::TobBloatHandsSplat
            | Type::TobNyloWaveSpawn
            | Type::TobSoteMazeProc
            | Type::TobSoteMazeEnd
            | Type::TobXarpusPhase
            | Type::TobXarpusExhumed
            | Type::TobXarpusSplat
            | Type::TobVerzikPhase
            | Type::TobVerzikDawnDrop
            | Type::TobVerzikDawn
            | Type::TobVerzikBounce
            | Type::TobVerzikHeal
            | Type::ColosseumHandicapChoice
            | Type::ColosseumDoomApplied
            | Type::ColosseumTotemHeal
            | Type::ColosseumSolDust
            | Type::ColosseumSolGrapple
            | Type::ColosseumSolPools
            | Type::ColosseumSolLasers
            | Type::MokhaiotlOrb
            | Type::MokhaiotlLarvaLeak
            | Type::InfernoWaveStart => {
                let events = if matches!(
                    kind,
                    Type::TobVerzikDawn | Type::TobVerzikBounce | Type::ColosseumSolGrapple
                ) {
                    &mut self.attack_references
                } else {
                    &mut self.state.events
                };
                match convert_event(self.party, event) {
                    EventOutcome::Accepted(payload) => {
                        events.push(Event::recorded(self.client_id, payload));
                    }
                    EventOutcome::PartiallyAccepted {
                        event: payload,
                        field,
                        error,
                    } => {
                        events.push(Event::recorded(self.client_id, payload));
                        self.warnings.entry(tick).or_default().push(BuildWarning {
                            tick,
                            kind,
                            field,
                            error,
                        });
                    }
                    EventOutcome::Rejected(reason) => {
                        self.rejections
                            .entry(tick)
                            .or_default()
                            .push(BuildRejection { tick, kind, reason });
                    }
                }
            }

            Type::TobVerzikRedsSpawn
            | Type::TobNyloWaveStall
            | Type::TobNyloCleanupEnd
            | Type::TobNyloBossSpawn => {
                // Deliberately ignored.
            }
        }
    }

    /// Finalizes the tick's state, inserting it into the recording.
    /// Returns the earliest tick whose state was modified.
    fn finish(mut self) -> Option<Tick> {
        let tick = self.tick;
        let TickState {
            players,
            npcs,
            events,
            ..
        } = &mut self.state;

        // A well-behaved client cannot send actions for nonexistent actors.
        // However, an event may have been dropped or rejected during
        // ingestion, so clear actions from actors without state.
        events.retain(|event| match &event.kind {
            EventKind::PlayerAttack(attack) => players.get(attack.player).is_some(),
            EventKind::PlayerSpell(cast) => players.get(cast.player).is_some(),
            EventKind::NpcAttack(attack) => npcs.contains_key(&attack.npc),
            _ => true,
        });

        // Drop any events referencing attacks that don't exist.
        for event in self.attack_references {
            let (kind, found) = match &event.kind {
                EventKind::VerzikDawnHit(hit) => (
                    Type::TobVerzikDawn,
                    self.recording.events_for_tick(hit.attack_tick).any(|e| {
                        matches!(
                            &e.kind,
                            EventKind::PlayerAttack(attack)
                                if attack.player == hit.player
                                    && attack.attack == PlayerAttack::DawnSpec
                        )
                    }),
                ),
                EventKind::VerzikBounce(bounce) => {
                    let expected = |attack: NpcAttack| match bounce.bounced {
                        Some(_) => attack == NpcAttack::TobVerzikP2Bounce,
                        None => matches!(
                            attack,
                            NpcAttack::TobVerzikP2Cabbage
                                | NpcAttack::TobVerzikP2Zap
                                | NpcAttack::TobVerzikP2Purple
                                | NpcAttack::TobVerzikP2Mage
                        ),
                    };
                    let p2_attack = |e: &Event| {
                        matches!(
                            &e.kind,
                            EventKind::NpcAttack(attack) if expected(attack.attack)
                        )
                    };
                    (
                        Type::TobVerzikBounce,
                        if bounce.attack_tick == tick {
                            events.iter().any(p2_attack)
                        } else {
                            self.recording
                                .events_for_tick(bounce.attack_tick)
                                .any(p2_attack)
                        },
                    )
                }
                EventKind::SolGrapple(grapple) => (
                    Type::ColosseumSolGrapple,
                    self.recording
                        .events_for_tick(grapple.attack_tick)
                        .any(|e| {
                            matches!(
                                &e.kind,
                                EventKind::NpcAttack(attack)
                                    if attack.attack == NpcAttack::ColosseumHereditBreak
                            )
                        }),
                ),
                _ => unreachable!(),
            };
            if found {
                events.push(event);
            } else {
                self.rejections
                    .entry(tick)
                    .or_default()
                    .push(BuildRejection {
                        tick,
                        kind,
                        reason: RejectionReason::AttackNotFound,
                    });
            }
        }

        // Don't write the tick if every event was rejected.
        let rejected = self.rejections.get(&tick).map_or(0, Vec::len);
        if rejected == self.processed {
            return self.changed;
        }

        for (index, _) in self.state.players.iter() {
            self.last_seen_actors.insert(Actor::Player(index), tick);
        }
        for &room_id in self.state.npcs.keys() {
            self.last_seen_actors.insert(Actor::Npc(room_id), tick);
        }
        if self.recording.get_state(tick) != Some(&self.state) {
            self.changed = Some(self.changed.map_or(tick, |changed| changed.min(tick)));
        }
        self.recording.set_state(tick, self.state);
        self.changed
    }
}

fn extract_player_state(
    client_id: ClientId,
    party: &[Rsn],
    recording: &Recording,
    last_seen_actors: &HashMap<Actor, Tick>,
    event: &proto::Event,
) -> Result<(PartyIndex, PlayerState), RejectionReason> {
    let player = expect_player(event)?;
    let index =
        resolve_index(party, &player.name).map_err(|error| RejectionReason::InvalidField {
            field: "player.name",
            error,
        })?;
    let position = parse_point(event)?;

    let mut equipment = if player.snapshot {
        [None; EQUIPMENT_SLOTS]
    } else {
        last_seen_actors
            .get(&Actor::Player(index))
            .and_then(|last| recording.get_state(*last))
            .and_then(|state| state.players.get(index))
            .map_or([None; EQUIPMENT_SLOTS], |prior| prior.equipment)
    };
    for &raw in &player.equipment_deltas {
        let (slot, item, added) = match ItemDelta::parse(raw) {
            ItemDelta::Add(slot, item) => (slot, item, true),
            ItemDelta::Remove(slot, item) => (slot, item, false),
        };
        let slot = EquipmentSlot::try_from(slot).map_err(|_| RejectionReason::InvalidField {
            field: "player.equipment_deltas",
            error: FieldError::OutOfDomain(raw.to_string()),
        })? as usize;
        equipment[slot] = match (equipment[slot], added) {
            (Some(worn), true) if worn.id == item.id => Some(Item {
                id: item.id,
                quantity: worn.quantity + item.quantity,
            }),
            (_, true) => Some(item),
            (Some(worn), false) if worn.id == item.id && item.quantity < worn.quantity => {
                Some(Item {
                    id: item.id,
                    quantity: worn.quantity - item.quantity,
                })
            }
            (_, false) => None,
        };
    }

    let data = match in_domain(player.data_source, "player.data_source")? {
        proto::event::player::DataSource::Primary => DataSource::Primary(Stats {
            hitpoints: SkillLevel::from_raw(player.hitpoints.required("player.hitpoints")?),
            prayer: SkillLevel::from_raw(player.prayer.required("player.prayer")?),
            attack: SkillLevel::from_raw(player.attack.required("player.attack")?),
            strength: SkillLevel::from_raw(player.strength.required("player.strength")?),
            defence: SkillLevel::from_raw(player.defence.required("player.defence")?),
            ranged: SkillLevel::from_raw(player.ranged.required("player.ranged")?),
            magic: SkillLevel::from_raw(player.magic.required("player.magic")?),
        }),
        proto::event::player::DataSource::Secondary => DataSource::Secondary,
    };

    Ok((
        index,
        PlayerState {
            source: Source::Client(client_id),
            position,
            equipment,
            prayers: PrayerSet::from_raw(player.active_prayers()),
            data,
        },
    ))
}

fn extract_npc_state(
    client_id: ClientId,
    recording: &Recording,
    last_seen_actors: &HashMap<Actor, Tick>,
    event: &proto::Event,
) -> Result<(RoomId, NpcState), RejectionReason> {
    let npc = expect_npc(event)?;
    let room_id = RoomId(npc.room_id);
    let prior = last_seen_actors
        .get(&Actor::Npc(room_id))
        .and_then(|last| recording.get_state(*last))
        .and_then(|state| state.npcs.get(&room_id));

    let npc_id = if npc.id == 0 {
        prior.map_or(0, |prior| prior.npc_id)
    } else {
        npc.id
    };

    // TODO(frolv): Send size from the plugin.
    let size = npc::definition(npc_id).map_or(1, |definition| definition.size);
    let position = Rect::square(parse_point(event)?, size);

    let properties = match &npc.r#type {
        None | Some(proto::event::npc::Type::Basic(())) => {
            prior.and_then(|prior| prior.properties.clone())
        }
        Some(proto::event::npc::Type::MaidenCrab(crab)) => {
            Some(NpcProperties::MaidenCrab(MaidenCrab {
                spawn: in_domain(crab.spawn, "npc.maiden_crab.spawn")?,
                position: in_domain(crab.position, "npc.maiden_crab.position")?,
                scuffed: crab.scuffed,
            }))
        }
        Some(proto::event::npc::Type::Nylo(nylo)) => {
            let style: proto::event::npc::nylo::Style = in_domain(nylo.style, "npc.nylo.style")?;
            let spawn = match in_domain(nylo.spawn_type, "npc.nylo.spawn_type")? {
                proto::event::npc::nylo::SpawnType::Split => NyloSpawn::Split(
                    (nylo.parent_room_id != 0).then_some(RoomId(nylo.parent_room_id)),
                ),
                proto::event::npc::nylo::SpawnType::West => NyloSpawn::West,
                proto::event::npc::nylo::SpawnType::South => NyloSpawn::South,
                proto::event::npc::nylo::SpawnType::East => NyloSpawn::East,
                proto::event::npc::nylo::SpawnType::Unknown => NyloSpawn::Unknown,
            };
            Some(NpcProperties::Nylo(Nylo {
                wave: nylo.wave,
                big: nylo.big,
                style: CombatStyle::from(style),
                spawn,
            }))
        }
        Some(proto::event::npc::Type::VerzikCrab(crab)) => {
            Some(NpcProperties::VerzikCrab(VerzikCrab {
                phase: in_domain(crab.phase, "npc.verzik_crab.phase")?,
                spawn: in_domain(crab.spawn, "npc.verzik_crab.spawn")?,
            }))
        }
    };

    Ok((
        room_id,
        NpcState {
            source: Source::Client(client_id),
            npc_id,
            position,
            hitpoints: SkillLevel::from_raw(npc.hitpoints),
            prayers: PrayerSet::from_raw(npc.active_prayers),
            properties,
        },
    ))
}

#[derive(Debug, PartialEq, Eq)]
enum EventOutcome {
    Accepted(EventKind),
    PartiallyAccepted {
        event: EventKind,
        field: &'static str,
        error: FieldError,
    },
    Rejected(RejectionReason),
}

fn resolve_index(party: &[Rsn], player: &str) -> Result<PartyIndex, FieldError> {
    party
        .iter()
        .position(|p| p.as_str() == player)
        .map(PartyIndex::from_usize)
        .ok_or_else(|| FieldError::UnknownActor(RawActor::Player(player.to_string())))
}

fn convert_event(party: &[Rsn], event: &proto::Event) -> EventOutcome {
    convert_or_reject(party, event).unwrap_or_else(EventOutcome::Rejected)
}

trait Required<T> {
    fn required(self, field: &'static str) -> Result<T, RejectionReason>;
}

impl<T> Required<T> for Option<T> {
    fn required(self, field: &'static str) -> Result<T, RejectionReason> {
        self.ok_or(RejectionReason::MissingPayload(field))
    }
}

fn in_domain<T: TryFrom<R>, R: Copy + ToString>(
    raw: R,
    field: &'static str,
) -> Result<T, RejectionReason> {
    T::try_from(raw).map_err(|_| RejectionReason::InvalidField {
        field,
        error: FieldError::OutOfDomain(raw.to_string()),
    })
}

/// Validates and transforms a proto event into an `EventKind`.
#[expect(clippy::too_many_lines, reason = "dump your code here")]
fn convert_or_reject(party: &[Rsn], event: &proto::Event) -> Result<EventOutcome, RejectionReason> {
    match event.r#type() {
        Type::PlayerAttack => {
            let player = expect_player(event)?;
            let index = resolve_index(party, &player.name).map_err(|error| {
                RejectionReason::InvalidField {
                    field: "player.name",
                    error,
                }
            })?;
            let attack = event.player_attack.as_ref().required("player_attack")?;
            Ok(EventOutcome::Accepted(EventKind::PlayerAttack(
                PlayerAttacked {
                    player: index,
                    attack: attack.r#type(),
                    weapon: attack.weapon.as_ref().map(|weapon| Item {
                        id: weapon.id,
                        quantity: weapon.quantity,
                    }),
                    // Jagex moment: defend against invalid target data.
                    target: attack
                        .target
                        .as_ref()
                        .filter(|npc| npc.id > 0 && npc.room_id > 0)
                        .map(|npc| Actor::Npc(RoomId(npc.room_id))),
                },
            )))
        }

        Type::PlayerDeath => {
            let player = expect_player(event)?;
            let index = resolve_index(party, &player.name).map_err(|error| {
                RejectionReason::InvalidField {
                    field: "player.name",
                    error,
                }
            })?;
            Ok(EventOutcome::Accepted(EventKind::PlayerDeath(index)))
        }

        Type::PlayerSpell => {
            let player = expect_player(event)?;
            let index = resolve_index(party, &player.name).map_err(|error| {
                RejectionReason::InvalidField {
                    field: "player.name",
                    error,
                }
            })?;
            let spell = event.player_spell.as_ref().required("player_spell")?;
            let (target, error) = match &spell.target {
                Some(proto::event::spell::Target::TargetPlayer(name)) => {
                    match resolve_index(party, name) {
                        Ok(target) => (Some(Actor::Player(target)), None),
                        Err(error) => (None, Some(error)),
                    }
                }
                Some(proto::event::spell::Target::TargetNpc(npc)) => {
                    (Some(Actor::Npc(RoomId(npc.room_id))), None)
                }
                Some(proto::event::spell::Target::NoTarget(())) | None => (None, None),
            };
            let event = EventKind::PlayerSpell(PlayerCast {
                player: index,
                spell: spell.r#type(),
                target,
            });
            Ok(match error {
                Some(error) => EventOutcome::PartiallyAccepted {
                    event,
                    field: "player_spell.target_player",
                    error,
                },
                None => EventOutcome::Accepted(event),
            })
        }

        Type::NpcDeath => {
            let npc = expect_npc(event)?;
            let position = parse_point(event)?;
            Ok(EventOutcome::Accepted(EventKind::NpcDeath(NpcDeath {
                position,
                npc: RoomId(npc.room_id),
                npc_id: Some(npc.id).filter(|&id| id > 0),
            })))
        }

        Type::NpcAttack => {
            let npc = expect_npc(event)?;
            let attack = event.npc_attack.as_ref().required("npc_attack")?;
            let (target, error) = match attack.target.as_deref() {
                Some(name) => match resolve_index(party, name) {
                    Ok(target) => (Some(Actor::Player(target)), None),
                    Err(error) => (None, Some(error)),
                },
                None => (None, None),
            };
            let event = EventKind::NpcAttack(NpcAttacked {
                npc: RoomId(npc.room_id),
                attack: attack.attack(),
                target,
            });
            Ok(match error {
                Some(error) => EventOutcome::PartiallyAccepted {
                    event,
                    field: "npc_attack.target",
                    error,
                },
                None => EventOutcome::Accepted(event),
            })
        }

        Type::TobMaidenCrabLeak => {
            let npc = expect_npc(event)?;
            Ok(EventOutcome::Accepted(EventKind::MaidenCrabLeak(RoomId(
                npc.room_id,
            ))))
        }

        Type::TobBloatDown => {
            let down = event.bloat_down.as_ref().required("bloat_down")?;
            Ok(EventOutcome::Accepted(EventKind::BloatDown(BloatDown {
                down_number: down.down_number,
                up_ticks: Ticks(down.up_ticks),
            })))
        }

        Type::TobBloatUp => Ok(EventOutcome::Accepted(EventKind::BloatUp)),

        Type::TobBloatHandsDrop => Ok(EventOutcome::Accepted(EventKind::BloatHandsDrop(
            parse_coords("bloat_hands", &event.bloat_hands)?,
        ))),

        Type::TobBloatHandsSplat => Ok(EventOutcome::Accepted(EventKind::BloatHandsSplat(
            parse_coords("bloat_hands", &event.bloat_hands)?,
        ))),

        Type::TobNyloWaveSpawn => {
            let nylo_wave = event.nylo_wave.as_ref().required("nylo_wave")?;
            let wave = u8::try_from(nylo_wave.wave)
                .ok()
                .filter(|wave| (1..=NyloWave::LAST_WAVE).contains(wave))
                .ok_or(RejectionReason::InvalidField {
                    field: "nylo_wave.wave",
                    error: FieldError::OutOfDomain(nylo_wave.wave.to_string()),
                })?;
            let nylos_alive = in_domain(nylo_wave.nylos_alive, "nylo_wave.nylos_alive")?;
            Ok(EventOutcome::Accepted(EventKind::NyloWaveSpawn(NyloWave {
                wave,
                nylos_alive,
            })))
        }

        Type::TobSoteMazeProc => {
            let sote_maze = event.sote_maze.as_ref().required("sote_maze")?;
            Ok(EventOutcome::Accepted(EventKind::SoteMazeProc(parse_maze(
                sote_maze,
            )?)))
        }

        Type::TobSoteMazeEnd => {
            let sote_maze = event.sote_maze.as_ref().required("sote_maze")?;
            let maze = parse_maze(sote_maze)?;
            let (chosen, error) = match sote_maze.chosen_player.as_deref() {
                Some(name) => match resolve_index(party, name) {
                    Ok(chosen) => (Some(chosen), None),
                    Err(error) => (None, Some(error)),
                },
                None => (None, None),
            };
            let event = EventKind::SoteMazeEnd(SoteMazeEnd { maze, chosen });
            Ok(match error {
                Some(error) => EventOutcome::PartiallyAccepted {
                    event,
                    field: "sote_maze.chosen_player",
                    error,
                },
                None => EventOutcome::Accepted(event),
            })
        }

        Type::TobXarpusPhase => {
            let raw = event.xarpus_phase.required("xarpus_phase")?;
            let phase = in_domain(raw, "xarpus_phase")?;
            Ok(EventOutcome::Accepted(EventKind::XarpusPhase(phase)))
        }

        Type::TobXarpusExhumed => {
            let exhumed = event.xarpus_exhumed.as_ref().required("xarpus_exhumed")?;
            let position = parse_point(event)?;
            let tick = Tick(event.tick);
            let spawn_tick = Tick(exhumed.spawn_tick);
            if spawn_tick > tick {
                return Err(RejectionReason::Inconsistent(
                    "exhumed spawned after despawning",
                ));
            }
            let heal_ticks = exhumed
                .heal_ticks
                .iter()
                .map(|&heal_tick| {
                    let heal_tick = Tick(heal_tick);
                    if (spawn_tick..=tick).contains(&heal_tick) {
                        Ok(heal_tick)
                    } else {
                        Err(RejectionReason::Inconsistent(
                            "exhumed heal tick outside its lifetime",
                        ))
                    }
                })
                .collect::<Result<_, _>>()?;
            Ok(EventOutcome::Accepted(EventKind::XarpusExhumed(
                XarpusExhumed {
                    position,
                    spawn_tick,
                    heal_ticks,
                },
            )))
        }

        Type::TobXarpusSplat => {
            let splat = event.xarpus_splat.as_ref().required("xarpus_splat")?;
            let position = parse_point(event)?;
            let source = match proto::event::xarpus_splat::Source::try_from(splat.source) {
                Ok(proto::event::xarpus_splat::Source::Unknown) => XarpusSplatSource::Unknown,
                Ok(proto::event::xarpus_splat::Source::Xarpus) => XarpusSplatSource::Xarpus,
                Ok(proto::event::xarpus_splat::Source::Bounce) => {
                    let bounce_from = splat.bounce_from.required("xarpus_splat.bounce_from")?;
                    let bounce_from = Point::try_from(bounce_from).map_err(|_| {
                        RejectionReason::InvalidField {
                            field: "xarpus_splat.bounce_from",
                            error: FieldError::OutOfDomain(format!(
                                "({},{})",
                                bounce_from.x, bounce_from.y
                            )),
                        }
                    })?;
                    XarpusSplatSource::Bounce(bounce_from)
                }
                Err(_) => {
                    return Err(RejectionReason::InvalidField {
                        field: "xarpus_splat.source",
                        error: FieldError::OutOfDomain(splat.source.to_string()),
                    });
                }
            };
            Ok(EventOutcome::Accepted(EventKind::XarpusSplat(
                XarpusSplat { position, source },
            )))
        }

        Type::TobVerzikPhase => {
            let raw = event.verzik_phase.required("verzik_phase")?;
            let phase = in_domain(raw, "verzik_phase")?;
            Ok(EventOutcome::Accepted(EventKind::VerzikPhase(phase)))
        }

        Type::TobVerzikDawnDrop => {
            let drop = event.verzik_dawn_drop.required("verzik_dawn_drop")?;
            let position = parse_point(event)?;
            Ok(EventOutcome::Accepted(if drop.dropped {
                EventKind::VerzikDawnDropped(position)
            } else {
                EventKind::VerzikDawnPickedUp(position)
            }))
        }

        Type::TobVerzikDawn => {
            let dawn = event.verzik_dawn.as_ref().required("verzik_dawn")?;
            let player = resolve_index(party, &dawn.player).map_err(|error| {
                RejectionReason::InvalidField {
                    field: "verzik_dawn.player",
                    error,
                }
            })?;
            let attack_tick = Tick(dawn.attack_tick);
            if attack_tick > Tick(event.tick) {
                return Err(RejectionReason::Inconsistent(
                    "dawn attack_tick after event tick",
                ));
            }
            Ok(EventOutcome::Accepted(EventKind::VerzikDawnHit(
                VerzikDawnHit {
                    player,
                    attack_tick,
                    damage: dawn.damage,
                },
            )))
        }

        Type::TobVerzikBounce => {
            let bounce = event.verzik_bounce.as_ref().required("verzik_bounce")?;
            let attack_tick = in_domain(bounce.npc_attack_tick, "verzik_bounce.npc_attack_tick")?;
            if attack_tick > Tick(event.tick) {
                return Err(RejectionReason::Inconsistent(
                    "bounce attack_tick after event tick",
                ));
            }
            let players_in_range =
                in_domain(bounce.players_in_range, "verzik_bounce.players_in_range")?;
            let bounced = bounce
                .bounced_player
                .as_deref()
                .map(|name| resolve_index(party, name))
                .transpose()
                .map_err(|error| RejectionReason::InvalidField {
                    field: "verzik_bounce.bounced_player",
                    error,
                })?;
            Ok(EventOutcome::Accepted(EventKind::VerzikBounce(
                VerzikBounce {
                    attack_tick,
                    players_in_range,
                    bounced,
                },
            )))
        }

        Type::TobVerzikHeal => {
            let heal = event.verzik_heal.as_ref().required("verzik_heal")?;
            let player = resolve_index(party, &heal.player).map_err(|error| {
                RejectionReason::InvalidField {
                    field: "verzik_heal.player",
                    error,
                }
            })?;
            let amount = match heal.heal_amount {
                -1 => None,
                amount => Some(in_domain(amount, "verzik_heal.heal_amount")?),
            };
            Ok(EventOutcome::Accepted(EventKind::VerzikHeal(VerzikHeal {
                player,
                amount,
            })))
        }

        Type::ColosseumHandicapChoice => {
            let raw = event.handicap.required("handicap")?;
            let handicap = in_domain(raw, "handicap")?;
            if event.handicap_options.is_empty() {
                return Err(RejectionReason::MissingPayload("handicap_options"));
            }
            let options: [ColosseumHandicap; 3] = event
                .handicap_options
                .iter()
                .map(|&raw| in_domain(raw, "handicap_options"))
                .collect::<Result<Vec<_>, _>>()?
                .try_into()
                .map_err(|_| RejectionReason::InvalidField {
                    field: "handicap_options",
                    error: FieldError::OutOfDomain(format!("{:?}", event.handicap_options)),
                })?;
            if !options.contains(&handicap) {
                return Err(RejectionReason::Inconsistent(
                    "handicap not among its options",
                ));
            }
            Ok(EventOutcome::Accepted(EventKind::HandicapChoice(
                HandicapChoice { handicap, options },
            )))
        }

        Type::ColosseumDoomApplied => Ok(EventOutcome::Accepted(EventKind::DoomApplied)),

        Type::ColosseumTotemHeal => {
            let heal = event
                .colosseum_totem_heal
                .as_ref()
                .required("colosseum_totem_heal")?;
            let totem = heal
                .source
                .as_ref()
                .required("colosseum_totem_heal.source")?;
            let target = heal
                .target
                .as_ref()
                .required("colosseum_totem_heal.target")?;
            let start_tick = Tick(heal.start_tick);
            if start_tick > Tick(event.tick) {
                return Err(RejectionReason::Inconsistent(
                    "totem heal started after it ended",
                ));
            }
            Ok(EventOutcome::Accepted(EventKind::TotemHeal(TotemHeal {
                totem: RoomId(totem.room_id),
                target: RoomId(target.room_id),
                start_tick,
                amount: heal.heal_amount,
            })))
        }

        Type::ColosseumSolDust => {
            let dust = event
                .colosseum_sol_dust
                .as_ref()
                .required("colosseum_sol_dust")?;
            let direction = || {
                let raw = dust.direction.required("colosseum_sol_dust.direction")?;
                in_domain(raw, "colosseum_sol_dust.direction")
            };
            let pattern = match proto::event::colosseum_sol_dust::Pattern::try_from(dust.pattern) {
                Ok(proto::event::colosseum_sol_dust::Pattern::Trident1) => {
                    SolDust::Trident1(direction()?)
                }
                Ok(proto::event::colosseum_sol_dust::Pattern::Trident2) => {
                    SolDust::Trident2(direction()?)
                }
                Ok(proto::event::colosseum_sol_dust::Pattern::Shield1) => SolDust::Shield1,
                Ok(proto::event::colosseum_sol_dust::Pattern::Shield2) => SolDust::Shield2,
                Err(_) => {
                    return Err(RejectionReason::InvalidField {
                        field: "colosseum_sol_dust.pattern",
                        error: FieldError::OutOfDomain(dust.pattern.to_string()),
                    });
                }
            };
            Ok(EventOutcome::Accepted(EventKind::SolDust(pattern)))
        }

        Type::ColosseumSolGrapple => {
            let grapple = event
                .colosseum_sol_grapple
                .required("colosseum_sol_grapple")?;
            let attack_tick = Tick(grapple.attack_tick);
            if attack_tick > Tick(event.tick) {
                return Err(RejectionReason::Inconsistent(
                    "grapple attack_tick after event tick",
                ));
            }
            let target = in_domain(grapple.target, "colosseum_sol_grapple.target")?;
            let outcome = in_domain(grapple.outcome, "colosseum_sol_grapple.outcome")?;
            Ok(EventOutcome::Accepted(EventKind::SolGrapple(SolGrapple {
                attack_tick,
                target,
                outcome,
            })))
        }

        Type::ColosseumSolPools => {
            let pools = event
                .colosseum_sol_pools
                .as_ref()
                .required("colosseum_sol_pools")?;
            Ok(EventOutcome::Accepted(EventKind::SolPools(parse_coords(
                "colosseum_sol_pools.pools",
                &pools.pools,
            )?)))
        }

        Type::ColosseumSolLasers => {
            let lasers = event
                .colosseum_sol_lasers
                .required("colosseum_sol_lasers")?;
            let phase = in_domain(lasers.phase, "colosseum_sol_lasers.phase")?;
            Ok(EventOutcome::Accepted(EventKind::SolLasers(phase)))
        }

        Type::MokhaiotlOrb => {
            let orb = event.mokhaiotl_orb.required("mokhaiotl_orb")?;
            let source = in_domain(orb.source, "mokhaiotl_orb.source")?;
            let source_point = orb.source_point.required("mokhaiotl_orb.source_point")?;
            let source_point =
                Point::try_from(source_point).map_err(|_| RejectionReason::InvalidField {
                    field: "mokhaiotl_orb.source_point",
                    error: FieldError::OutOfDomain(format!(
                        "({},{})",
                        source_point.x, source_point.y
                    )),
                })?;
            let style: proto::event::attack_style::Style =
                in_domain(orb.style, "mokhaiotl_orb.style")?;
            let spawn_tick = Tick(orb.start_tick);
            let end_tick = Tick(orb.end_tick);
            if spawn_tick > end_tick {
                return Err(RejectionReason::Inconsistent(
                    "orb start_tick after end_tick",
                ));
            }
            if end_tick > Tick(event.tick) {
                return Err(RejectionReason::Inconsistent(
                    "orb end_tick after event tick",
                ));
            }
            Ok(EventOutcome::Accepted(EventKind::MokhaiotlOrb(
                MokhaiotlOrb {
                    source,
                    source_point,
                    style: CombatStyle::from(style),
                    spawn_tick,
                    end_tick,
                },
            )))
        }

        Type::MokhaiotlLarvaLeak => {
            let leak = event
                .mokhaiotl_larva_leak
                .required("mokhaiotl_larva_leak")?;
            Ok(EventOutcome::Accepted(EventKind::MokhaiotlLarvaLeak(
                MokhaiotlLarvaLeak {
                    larva: RoomId(leak.room_id),
                    heal_amount: leak.heal_amount,
                },
            )))
        }

        Type::InfernoWaveStart => {
            let start = event.inferno_wave_start.required("inferno_wave_start")?;
            Ok(EventOutcome::Accepted(EventKind::InfernoWaveStart(Ticks(
                start.overall_ticks,
            ))))
        }

        _ => unreachable!("only event types are converted"),
    }
}

fn expect_player(event: &proto::Event) -> Result<&proto::event::Player, RejectionReason> {
    event.player.as_ref().required("player")
}

fn expect_npc(event: &proto::Event) -> Result<&proto::event::Npc, RejectionReason> {
    event.npc.as_ref().required("npc")
}

fn parse_point(event: &proto::Event) -> Result<Point, RejectionReason> {
    let x = u16::try_from(event.x_coord).map_err(|_| RejectionReason::InvalidField {
        field: "x_coord",
        error: FieldError::OutOfDomain(event.x_coord.to_string()),
    })?;
    let y = u16::try_from(event.y_coord).map_err(|_| RejectionReason::InvalidField {
        field: "y_coord",
        error: FieldError::OutOfDomain(event.y_coord.to_string()),
    })?;
    Ok(Point(x, y))
}

fn parse_coords(
    field: &'static str,
    coords: &[proto::Coords],
) -> Result<Vec<Point>, RejectionReason> {
    if coords.is_empty() {
        return Err(RejectionReason::MissingPayload(field));
    }
    parse_points(field, coords)
}

fn parse_points(
    field: &'static str,
    coords: &[proto::Coords],
) -> Result<Vec<Point>, RejectionReason> {
    coords
        .iter()
        .map(|coords| {
            Point::try_from(*coords).map_err(|_| RejectionReason::InvalidField {
                field,
                error: FieldError::OutOfDomain(format!("({},{})", coords.x, coords.y)),
            })
        })
        .collect()
}

fn parse_maze(maze: &proto::event::SoteMaze) -> Result<Maze, RejectionReason> {
    match proto::event::sote_maze::Maze::try_from(maze.maze) {
        Ok(proto::event::sote_maze::Maze::Maze66) => Ok(Maze::Maze66),
        Ok(proto::event::sote_maze::Maze::Maze33) => Ok(Maze::Maze33),
        Err(_) => Err(RejectionReason::InvalidField {
            field: "sote_maze.maze",
            error: FieldError::OutOfDomain(maze.maze.to_string()),
        }),
    }
}

fn resolve_attack_style(
    recording: &mut Recording,
    current: &mut TickState,
    event: &proto::Event,
) -> Result<Option<Tick>, RejectionReason> {
    let kind = event.r#type();
    let (payload, field, style_field) = match kind {
        Type::TobVerzikAttackStyle => (
            event.verzik_attack_style,
            "verzik_attack_style",
            "verzik_attack_style.style",
        ),
        Type::MokhaiotlAttackStyle => (
            event.mokhaiotl_attack_style,
            "mokhaiotl_attack_style",
            "mokhaiotl_attack_style.style",
        ),
        _ => unreachable!("only attack style events are passed in"),
    };

    let payload = payload.required(field)?;
    let attack_tick = Tick(payload.npc_attack_tick);
    let event_tick = Tick(event.tick);
    if attack_tick > event_tick {
        return Err(RejectionReason::Inconsistent(
            "attack style npc_attack_tick after event tick",
        ));
    }

    let style: proto::event::attack_style::Style = in_domain(payload.style, style_field)?;
    let unresolved_type = |attack: NpcAttack| match kind {
        Type::TobVerzikAttackStyle => match attack {
            NpcAttack::TobVerzikP3Auto
            | NpcAttack::TobVerzikP3Melee
            | NpcAttack::TobVerzikP3Range
            | NpcAttack::TobVerzikP3Mage => Some(NpcAttack::TobVerzikP3Auto),
            _ => None,
        },
        Type::MokhaiotlAttackStyle => match attack {
            NpcAttack::MokhaiotlAuto
            | NpcAttack::MokhaiotlMeleeAuto
            | NpcAttack::MokhaiotlRangedAuto
            | NpcAttack::MokhaiotlMageAuto => Some(NpcAttack::MokhaiotlAuto),
            NpcAttack::MokhaiotlBall
            | NpcAttack::MokhaiotlRangedBall
            | NpcAttack::MokhaiotlMageBall => Some(NpcAttack::MokhaiotlBall),
            _ => None,
        },
        _ => unreachable!("only attack style events are passed in"),
    };

    let state = if attack_tick == event_tick {
        Some(current)
    } else {
        recording.get_state_mut(attack_tick)
    };
    let (attack, unresolved) = state
        .and_then(|state| {
            state.events.iter_mut().find_map(|e| match &mut e.kind {
                EventKind::NpcAttack(attack) => {
                    unresolved_type(attack.attack).map(|unresolved| (attack, unresolved))
                }
                _ => None,
            })
        })
        .ok_or(RejectionReason::AttackNotFound)?;

    let resolved = match (unresolved, style) {
        (NpcAttack::TobVerzikP3Auto, proto::event::attack_style::Style::Melee) => {
            NpcAttack::TobVerzikP3Melee
        }
        (NpcAttack::TobVerzikP3Auto, proto::event::attack_style::Style::Range) => {
            NpcAttack::TobVerzikP3Range
        }
        (NpcAttack::TobVerzikP3Auto, proto::event::attack_style::Style::Mage) => {
            NpcAttack::TobVerzikP3Mage
        }
        (NpcAttack::MokhaiotlAuto, proto::event::attack_style::Style::Melee) => {
            NpcAttack::MokhaiotlMeleeAuto
        }
        (NpcAttack::MokhaiotlAuto, proto::event::attack_style::Style::Range) => {
            NpcAttack::MokhaiotlRangedAuto
        }
        (NpcAttack::MokhaiotlAuto, proto::event::attack_style::Style::Mage) => {
            NpcAttack::MokhaiotlMageAuto
        }
        (NpcAttack::MokhaiotlBall, proto::event::attack_style::Style::Range) => {
            NpcAttack::MokhaiotlRangedBall
        }
        (NpcAttack::MokhaiotlBall, proto::event::attack_style::Style::Mage) => {
            NpcAttack::MokhaiotlMageBall
        }
        (NpcAttack::MokhaiotlBall, proto::event::attack_style::Style::Melee) => {
            return Err(RejectionReason::Inconsistent(
                "melee attack style on a Mokhaiotl ball",
            ));
        }
        _ => unreachable!("attack is from unresolved_type"),
    };

    if attack.attack == resolved {
        return Ok(None);
    }
    attack.attack = resolved;
    Ok(Some(attack_tick))
}

#[cfg(test)]
mod tests;

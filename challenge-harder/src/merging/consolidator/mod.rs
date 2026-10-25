//! Deduplication and consolidation of events between a pair of clients.

use std::cmp::Ordering;
use std::collections::btree_map::Entry;
use std::collections::{BTreeMap, BTreeSet};

use blert::proto::event;
use blert::{
    Actor, DataSource, Event, EventKind, NpcAttack, NpcAttacked, NpcState, PartyIndex,
    PlayerAttack, PlayerAttacked, PlayerCast, PlayerSpell, Point, Recording, RoomId, Source, Tick,
    TickState, Ticks, npc,
};

use super::event::{
    AttackPairing, Class, IdentityKey, classify, event_type, identity_key, normalize_npc_attack,
    normalize_player_attack, pair_attacks, stream_config,
};
use super::trace::{
    ActionConflict, AttackMappedDiscardReason, AttackMappedResolution, StreamOccurrence,
    StreamOutcome, StreamResolution, TickMergeDecision, Tracer,
};
use super::{Mappings, MergeContext};

#[cfg(test)]
mod tests;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Side {
    Base,
    Target,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(super) struct ReconciliationCounters {
    pub player_attack_pairs: u32,
    pub player_spell_pairs: u32,
    pub npc_attack_pairs: u32,
    pub stream_event_pairs: u32,
    pub attack_mapped_events: u32,
}

/// A discrepancy between two clients' views of some occurrence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Disagreement {
    PlayerAttackKind {
        player: PartyIndex,
        kept: PlayerAttack,
        discarded: PlayerAttack,
    },
    PlayerAttackTarget {
        player: PartyIndex,
        kept: Actor,
        discarded: Actor,
    },
    PlayerSpellKind {
        player: PartyIndex,
        kept: PlayerSpell,
        discarded: PlayerSpell,
    },
    PlayerSpellTarget {
        player: PartyIndex,
        kept: Actor,
        discarded: Actor,
    },
    NpcAttackKind {
        room_id: RoomId,
        npc_id: u32,
        kept: NpcAttack,
        discarded: NpcAttack,
    },
    NpcAttackTarget {
        room_id: RoomId,
        npc_id: u32,
        kept: Actor,
        discarded: Actor,
    },
    AttackMapped {
        kind: event::Type,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum QualityFlag {
    Disagreement {
        tick: Tick,
        kept_source: Source,
        discarded_source: Source,
        subject: Disagreement,
    },
    LargeTemporalGap {
        kind: event::Type,
        gap: Ticks,
        base_tick: Tick,
        target_tick: Tick,
    },
    UnmappedCrossTickReference {
        kind: event::Type,
        merged_tick: Tick,
        source_tick: Tick,
        resolved_tick: Tick,
    },
    AttackMappedNotFound {
        kind: event::Type,
        side: Side,
        client_tick: Tick,
        client_attack_tick: Tick,
    },
}

pub(super) struct ConsolidationResult {
    pub recording: Recording,
    pub quality_flags: Vec<QualityFlag>,
    pub counters: ReconciliationCounters,
}

/// How a winning client is chosen when there are conflicting candidates.
#[derive(Debug)]
pub(super) enum ResolutionStrategy {
    /// Conflicting candidates are not expected for the event type, and result
    /// in the base being kept with a flag raised.
    Unexpected,
    /// Retains the base's view of the event regardless of the target's.
    KeepBase,
    /// Prefers the candidate whose source client's primary player is nearest
    /// to a specific position.
    Proximity { position: Point },
}

#[derive(Debug, Clone, Copy)]
pub(super) struct Measurement {
    pub primary_player: PartyIndex,
    pub distance: f64,
}

#[derive(Debug, Clone, Copy)]
pub(super) enum Resolution {
    Unexpected,
    KeepBase,
    Proximity {
        base: Option<Measurement>,
        target: Option<Measurement>,
        winner: Side,
    },
}

impl Resolution {
    fn winner(&self) -> Side {
        match self {
            Self::Unexpected | Self::KeepBase => Side::Base,
            Self::Proximity { winner, .. } => *winner,
        }
    }
}

impl ResolutionStrategy {
    /// Chooses between the base's and the target's views of an occurrence.
    fn resolve(
        &self,
        ctx: &MergeContext<'_>,
        base: (Source, &TickState),
        target: (Source, &TickState),
    ) -> Resolution {
        match self {
            Self::Unexpected => Resolution::Unexpected,
            Self::KeepBase => Resolution::KeepBase,
            Self::Proximity { position } => {
                let measure = |(source, state): (Source, &TickState)| {
                    let Source::Client(id) = source else {
                        return None;
                    };
                    let primary_player = ctx.primary_player(id)?;
                    let player = state.players.get(primary_player)?;
                    Some(Measurement {
                        primary_player,
                        distance: player.position.euclidean(*position),
                    })
                };
                let (base, target) = (measure(base), measure(target));
                let winner = match (base, target) {
                    (Some(base), Some(target)) if target.distance < base.distance => Side::Target,
                    _ => Side::Base,
                };
                Resolution::Proximity {
                    base,
                    target,
                    winner,
                }
            }
        }
    }
}

/// Extracts the referenced attack tick from an attack-mapped event,
/// in its client's tick space.
fn referenced_tick(kind: &EventKind) -> Tick {
    match kind {
        EventKind::VerzikBounce(bounce) => bounce.attack_tick,
        EventKind::VerzikDawnHit(dawn) => dawn.attack_tick,
        _ => unreachable!("non attack-mapped event"),
    }
}

/// Checks whether the referenced attack exists in a tick's state.
fn attack_present(state: &TickState, kind: &EventKind) -> bool {
    match kind {
        EventKind::VerzikBounce(bounce) => {
            let Some(&verzik) = state
                .npcs
                .iter()
                .find_map(|(room_id, npc)| npc::is_verzik_p2(npc.id).then_some(room_id))
            else {
                return false;
            };
            // Bounce events are dispatched on every Verzik attack, whether
            // or not a bounce happened, to track bounce chances. If there
            // is a bounced player in the event, search for a bounce attack;
            // otherwise any Verzik attack will do.
            state.events.iter().any(|event| match &event.kind {
                EventKind::NpcAttack(attacked) => {
                    attacked.npc == verzik
                        && (bounce.bounced.is_none()
                            || attacked.attack == NpcAttack::TobVerzikP2Bounce)
                }
                _ => false,
            })
        }
        EventKind::VerzikDawnHit(dawn) => state.events.iter().any(|event| {
            matches!(
                &event.kind,
                EventKind::PlayerAttack(attacked)
                    if attacked.player == dawn.player
                        && attacked.attack == PlayerAttack::DawnSpec
            )
        }),
        _ => unreachable!("non attack-mapped event"),
    }
}

/// Returns the strategy for resolving disagreements between conflicting
/// candidates of a specific type of event.
fn conflict_resolution(
    state: &TickState,
    base: &EventKind,
    target: &EventKind,
) -> ResolutionStrategy {
    match (base, target) {
        (EventKind::PlayerAttack(base), EventKind::PlayerAttack(target)) => {
            if normalize_player_attack(base.attack) != normalize_player_attack(target.attack) {
                return ResolutionStrategy::Unexpected;
            }
            state
                .players
                .get(base.player)
                .map_or(ResolutionStrategy::KeepBase, |player| {
                    ResolutionStrategy::Proximity {
                        position: player.position,
                    }
                })
        }
        (EventKind::NpcAttack(base), EventKind::NpcAttack(_)) => {
            state
                .npcs
                .get(&base.npc)
                .map_or(ResolutionStrategy::KeepBase, |npc| {
                    ResolutionStrategy::Proximity {
                        position: npc.position.center(),
                    }
                })
        }
        _ => ResolutionStrategy::Unexpected,
    }
}

/// Checks whether two candidates agree on an event's content.
fn candidates_agree(a: &EventKind, b: &EventKind) -> bool {
    match (a, b) {
        (EventKind::VerzikBounce(a), EventKind::VerzikBounce(b)) => a.bounced == b.bounced,
        (EventKind::VerzikDawnHit(a), EventKind::VerzikDawnHit(b)) => {
            a.player == b.player && a.damage == b.damage
        }
        _ => unreachable!("non attack-mapped event"),
    }
}

#[derive(Debug, Clone, Copy)]
pub(super) struct AttackMappedCandidate<'a> {
    pub event: &'a Event,
    pub client_tick: Tick,
    pub client_attack_tick: Tick,
    pub merged_attack_tick: Tick,
}

fn should_buffer(event: &Event) -> bool {
    matches!(classify(&event.kind), Class::Stream | Class::AttackMapped)
}

/// An event held for reconciliation between clients.
#[derive(Debug)]
struct BufferedEvent<'a> {
    event: &'a Event,
    merged_tick: Tick,
    client_tick: Tick,
}

#[derive(Debug, Default)]
struct EventBuffer<'a> {
    stream: BTreeMap<event::Type, Vec<BufferedEvent<'a>>>,
    attack_mapped: BTreeMap<event::Type, Vec<BufferedEvent<'a>>>,
}

impl<'a> EventBuffer<'a> {
    fn add_events(
        &mut self,
        events: impl IntoIterator<Item = &'a Event>,
        merged_tick: Tick,
        client_tick: Tick,
    ) {
        for event in events {
            let map = match classify(&event.kind) {
                Class::Stream => &mut self.stream,
                Class::AttackMapped => &mut self.attack_mapped,
                Class::Solo | Class::Derived | Class::TickState => {
                    unreachable!("only buffered events are added")
                }
            };
            map.entry(event_type(&event.kind))
                .or_default()
                .push(BufferedEvent {
                    event,
                    merged_tick,
                    client_tick,
                });
        }
    }

    /// Removes the events of `kind` and returns them as stream candidates,
    /// ordered by identity key and then by merged tick.
    ///
    /// # Panics
    /// Panics if events of `kind` do not have an identity key mapping.
    fn take_stream_candidates(&mut self, kind: event::Type) -> Vec<StreamCandidate<'a>> {
        let mut candidates: Vec<StreamCandidate<'a>> = self
            .stream
            .remove(&kind)
            .unwrap_or_default()
            .into_iter()
            .map(|buffered| StreamCandidate {
                event: buffered.event,
                identity_key: identity_key(&buffered.event.kind),
                merged_tick: buffered.merged_tick,
                client_tick: buffered.client_tick,
            })
            .collect();
        candidates.sort_by(|a, b| {
            (&a.identity_key, a.merged_tick).cmp(&(&b.identity_key, b.merged_tick))
        });
        candidates
    }
}

#[derive(Debug)]
struct StreamCandidate<'a> {
    event: &'a Event,
    identity_key: IdentityKey,
    merged_tick: Tick,
    client_tick: Tick,
}

/// Merges state from `other` into `state`.
///
/// State that is visible in `other` but not in `state` is added. If state
/// exists in both, data source priority is used to determine which view to
/// keep.
fn merge_from(state: &mut TickState, other: &TickState, remap_npc: impl Fn(&mut NpcState)) {
    for (index, other_player) in other.players.iter() {
        match &mut state.players[index] {
            Some(player) => {
                if matches!(player.data, DataSource::Secondary)
                    && matches!(other_player.data, DataSource::Primary(_))
                {
                    *player = other_player.clone();
                }
            }
            slot @ None => *slot = Some(other_player.clone()),
        }
    }

    for (&room_id, other_npc) in &other.npcs {
        let remapped = || {
            let mut npc = other_npc.clone();
            remap_npc(&mut npc);
            npc
        };
        match state.npcs.entry(room_id) {
            Entry::Vacant(entry) => {
                entry.insert(remapped());
            }
            Entry::Occupied(mut entry) => {
                if entry.get().source == Source::Synthetic && other_npc.source != Source::Synthetic
                {
                    entry.insert(remapped());
                }
            }
        }
    }

    state.objects.extend(&other.objects);
}

/// Invokes `f` once per distinct value of the elements in `base` and `target`,
/// ordered by `compare`, passing each side's slice with equal elements grouped.
fn merge_join<T>(
    base: &[T],
    target: &[T],
    compare: impl Fn(&T, &T) -> Ordering,
    mut f: impl FnMut(&[T], &[T]),
) {
    let same = |a: &T, b: &T| compare(a, b).is_eq();
    let mut base_runs = base.chunk_by(same).peekable();
    let mut target_runs = target.chunk_by(same).peekable();

    loop {
        let ordering = match (base_runs.peek(), target_runs.peek()) {
            (Some(b), Some(t)) => compare(&b[0], &t[0]),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => break,
        };

        let (base_run, target_run): (&[T], &[T]) = match ordering {
            Ordering::Less => (base_runs.next().unwrap_or_default(), &[]),
            Ordering::Equal => (
                base_runs.next().unwrap_or_default(),
                target_runs.next().unwrap_or_default(),
            ),
            Ordering::Greater => (&[], target_runs.next().unwrap_or_default()),
        };
        f(base_run, target_run);
    }
}

pub(super) struct Consolidator<'a, 't> {
    base: &'t Recording,
    target: &'t Recording,
    mappings: &'t Mappings,
    ctx: &'t MergeContext<'a>,
    tracer: Option<&'t mut Tracer>,
    base_buffer: EventBuffer<'t>,
    target_buffer: EventBuffer<'t>,
    quality_flags: Vec<QualityFlag>,
    counters: ReconciliationCounters,
}

impl<'a, 't> Consolidator<'a, 't> {
    /// Constructs a consolidator to merge `target` into `base`.
    ///
    /// # Panics
    /// Panics if the mapping in `ctx` has not been initialized for the step.
    pub(super) fn new(
        base: &'t Recording,
        target: &'t Recording,
        ctx: &'t MergeContext<'a>,
        tracer: Option<&'t mut Tracer>,
    ) -> Self {
        let mappings = ctx.mapping.current_step().expect("merge step has begun");
        Self {
            base,
            target,
            mappings,
            ctx,
            tracer,
            base_buffer: EventBuffer::default(),
            target_buffer: EventBuffer::default(),
            quality_flags: Vec::new(),
            counters: ReconciliationCounters::default(),
        }
    }

    /// Merges the target into the base, producing the consolidated timeline
    /// with the quality flags raised and the reconciliation counts.
    pub(super) fn consolidate(mut self) -> ConsolidationResult {
        // Runs three passes over the timeline:
        // 1. Initial construction with all base ticks and target insertions.
        // 2. Consolidation, merging target states into paired base ticks.
        // 3. Stream reconciliation deduplicating stream events and resolving
        //    conflicts between them.
        let mut recording = self.build_recording();
        self.consolidate_ticks(&mut recording);
        self.reconcile_streams(&mut recording);

        if let Some(tracer) = self.tracer.as_deref_mut() {
            tracer.record_quality_flags(&self.quality_flags);
            tracer.record_reconciliation_counters(&self.counters);
        }

        ConsolidationResult {
            recording,
            quality_flags: self.quality_flags,
            counters: self.counters,
        }
    }

    /// Constructs an initial merged timeline by placing mapped base ticks and
    /// inserting target-only ticks into empty slots. Strips buffered events
    /// from every placed tick.
    fn build_recording(&mut self) -> Recording {
        let mut merged = Recording::vacant(
            self.base.stage(),
            self.base.mode(),
            self.base.party().to_vec(),
            self.mappings.merged_last_tick,
        );

        let (base, target) = (self.base, self.target);

        for (tick, state) in base.states() {
            let Some(merged_tick) = self.mappings.base.to_merged(tick) else {
                continue;
            };
            self.place_tick(&mut merged, Side::Base, tick, state, merged_tick);
        }

        for (tick, state) in target.states() {
            let Some(merged_tick) = self.mappings.target.to_merged(tick) else {
                continue;
            };
            if merged.get_state(merged_tick).is_some() {
                continue;
            }
            self.place_tick(&mut merged, Side::Target, tick, state, merged_tick);
        }

        *merged.stage_data_mut() = self.base.stage_data().clone();

        merged
    }

    /// Initializes tick `merged_tick` in `merged` to a clone of `state` with its
    /// buffered events extracted into the buffer for `side`.
    fn place_tick(
        &mut self,
        merged: &mut Recording,
        side: Side,
        client_tick: Tick,
        state: &'t TickState,
        merged_tick: Tick,
    ) {
        let buffer = match side {
            Side::Base => &mut self.base_buffer,
            Side::Target => &mut self.target_buffer,
        };
        buffer.add_events(
            state.events.iter().filter(|&event| should_buffer(event)),
            merged_tick,
            client_tick,
        );

        let mut cloned = state.clone();
        cloned.events.retain(|event| !should_buffer(event));
        for event in &mut cloned.events {
            self.remap_ticks(side, event, client_tick, merged_tick);
        }
        for npc in cloned.npcs.values_mut() {
            self.remap_npc_ticks(side, npc, client_tick, merged_tick);
        }
        merged.set_state(merged_tick, cloned);
    }

    /// Walks the merged timeline after the initial build phase, merging the
    /// target into every tick both sides recorded and buffering its events.
    fn consolidate_ticks(&mut self, merged: &mut Recording) {
        let mappings = self.mappings;
        let (base, target) = (self.base, self.target);

        for tick in merged.last_tick().up_to_inclusive() {
            let base_state = mappings
                .base
                .to_client(tick)
                .and_then(|t| base.get_state(t));
            let target_state = mappings
                .target
                .to_client(tick)
                .and_then(|t| Some((t, target.get_state(t)?)));

            let decision = match (base_state, target_state) {
                (Some(_), Some((target_tick, target_state))) => {
                    self.target_buffer.add_events(
                        target_state
                            .events
                            .iter()
                            .filter(|&event| should_buffer(event)),
                        tick,
                        target_tick,
                    );
                    let state = merged
                        .get_state_mut(tick)
                        .expect("recording initialized with base ticks");
                    merge_from(state, target_state, |npc| {
                        self.remap_npc_ticks(Side::Target, npc, target_tick, tick);
                    });
                    self.merge_player_attacks(tick, state, target_state);
                    self.merge_player_spells(tick, state, target_state);
                    self.merge_npc_attacks(tick, state, target_state);
                    TickMergeDecision::Merged
                }
                (Some(_), None) => TickMergeDecision::Retained,
                (None, Some(_)) => TickMergeDecision::Filled,
                (None, None) => TickMergeDecision::Skipped,
            };

            if let Some(tracer) = self.tracer.as_deref_mut() {
                tracer.record_tick_decision(tick, decision);
            }
        }
    }

    /// Deduplicates the buffered events from the base and client streams,
    /// placing a single version of each event into `merged`.
    fn reconcile_streams(&mut self, merged: &mut Recording) {
        let challenge = self.ctx.challenge.challenge_type;
        let stream_kinds: BTreeSet<event::Type> = self
            .base_buffer
            .stream
            .keys()
            .chain(self.target_buffer.stream.keys())
            .copied()
            .collect();
        let attack_mapped_kinds: BTreeSet<event::Type> = self
            .base_buffer
            .attack_mapped
            .keys()
            .chain(self.target_buffer.attack_mapped.keys())
            .copied()
            .collect();

        for kind in stream_kinds {
            let Some(config) = stream_config(challenge, kind) else {
                continue;
            };
            let base = self.base_buffer.take_stream_candidates(kind);
            let target = self.target_buffer.take_stream_candidates(kind);

            merge_join(
                &base,
                &target,
                |a, b| a.identity_key.cmp(&b.identity_key),
                |base_run, target_run| match config.temporal_window {
                    None => self.match_unique(merged, kind, base_run, target_run),
                    Some(window) => {
                        self.match_temporal(merged, kind, window, base_run, target_run);
                    }
                },
            );
        }

        for kind in attack_mapped_kinds {
            let base = self.take_attack_mapped_candidates(merged, kind, Side::Base);
            let target = self.take_attack_mapped_candidates(merged, kind, Side::Target);

            merge_join(
                &base,
                &target,
                |a, b| a.merged_attack_tick.cmp(&b.merged_attack_tick),
                |base_run, target_run| {
                    self.place_attack_mapped_event(merged, kind, base_run, target_run);
                },
            );
        }
    }

    fn remap_ticks(&mut self, side: Side, event: &mut Event, source_tick: Tick, merged_tick: Tick) {
        let mapping = match side {
            Side::Base => &self.mappings.base,
            Side::Target => &self.mappings.target,
        };
        let (kind, source) = (event_type(&event.kind), event.source);

        event.kind.remap_ticks(|tick| {
            if let Some(mapped) = mapping.to_merged(tick) {
                return mapped;
            }

            // The cross-tick reference points to a client tick with no
            // merged mapping (alignment gap or beyond recorded range).
            // Approximate with the offset between the event's source
            // tick and its final merged position. This preserves the
            // relative distance but can be wrong if insertions exist
            // between the two ticks.
            let resolved = if merged_tick >= source_tick {
                tick + (merged_tick - source_tick)
            } else {
                tick - (source_tick - merged_tick)
            };

            tracing::warn!(
                ?kind,
                %source,
                %source_tick,
                cross_tick_ref = %tick,
                %merged_tick,
                %resolved,
                "unmapped_cross_tick_reference"
            );
            self.quality_flags
                .push(QualityFlag::UnmappedCrossTickReference {
                    kind,
                    merged_tick,
                    source_tick: tick,
                    resolved_tick: resolved,
                });
            resolved
        });
    }

    fn remap_npc_ticks(
        &self,
        side: Side,
        npc: &mut NpcState,
        source_tick: Tick,
        merged_tick: Tick,
    ) {
        let mapping = match side {
            Side::Base => &self.mappings.base,
            Side::Target => &self.mappings.target,
        };
        let npc_id = npc.id;
        let Some(properties) = &mut npc.properties else {
            return;
        };

        properties.remap_ticks(|tick| {
            if let Some(mapped) = mapping.to_merged(tick) {
                return mapped;
            }

            let resolved = if merged_tick >= source_tick {
                tick + (merged_tick - source_tick)
            } else {
                tick - (source_tick - merged_tick)
            };
            tracing::warn!(
                npc_id,
                %source_tick,
                cross_tick_ref = %tick,
                %merged_tick,
                %resolved,
                "unmapped_npc_property_tick"
            );
            resolved
        });
    }

    /// Merges player attacks from a target tick into the base.
    #[expect(clippy::too_many_lines)]
    fn merge_player_attacks(&mut self, tick: Tick, merged: &mut TickState, target: &TickState) {
        let base_events: Vec<Event> = merged
            .events
            .extract_if(.., |event| matches!(event.kind, EventKind::PlayerAttack(_)))
            .collect();
        let base_attacks: Vec<(&Event, &PlayerAttacked)> = base_events
            .iter()
            .filter_map(|event| match &event.kind {
                EventKind::PlayerAttack(attacked) => Some((event, attacked)),
                _ => None,
            })
            .collect();
        let target_attacks: Vec<(&Event, &PlayerAttacked)> = target
            .events
            .iter()
            .filter_map(|event| match &event.kind {
                EventKind::PlayerAttack(attacked) => Some((event, attacked)),
                _ => None,
            })
            .collect();

        let pairings = pair_attacks(
            &base_attacks,
            &target_attacks,
            |&(_, attacked)| (Actor::Player(attacked.player), attacked.attack),
            normalize_player_attack,
        );
        for pairing in pairings {
            let ((base_event, base), (other_event, other)) = match pairing {
                AttackPairing::Paired { base, target } => (*base, *target),
                AttackPairing::BaseOnly(&(event, _)) => {
                    merged.events.push(event.clone());
                    continue;
                }
                AttackPairing::TargetOnly(&(event, attacked)) => {
                    if merged.players.get(attacked.player).is_some() {
                        merged.events.push(event.clone());
                    }
                    continue;
                }
            };

            if base_event.source == other_event.source {
                merged.events.push(base_event.clone());
                continue;
            }
            self.counters.player_attack_pairs += 1;

            let (mut winner, mut loser) = ((base_event, base), (other_event, other));
            if base.attack != other.attack {
                let resolution = conflict_resolution(merged, &base_event.kind, &other_event.kind)
                    .resolve(
                        self.ctx,
                        (base_event.source, merged),
                        (other_event.source, target),
                    );
                if let Some(tracer) = self.tracer.as_deref_mut() {
                    tracer.record_action_conflict(&ActionConflict {
                        tick,
                        actor: Actor::Player(base.player),
                        base_source: base_event.source,
                        base_kind: base.attack.as_str_name(),
                        target_source: other_event.source,
                        target_kind: other.attack.as_str_name(),
                        resolution,
                    });
                }

                if matches!(resolution, Resolution::Unexpected) {
                    self.quality_flags.push(QualityFlag::Disagreement {
                        tick,
                        kept_source: base_event.source,
                        discarded_source: other_event.source,
                        subject: Disagreement::PlayerAttackKind {
                            player: base.player,
                            kept: base.attack,
                            discarded: other.attack,
                        },
                    });
                    tracing::warn!(
                        %tick,
                        player = base.player.as_usize(),
                        base_attack = ?base.attack,
                        other_attack = ?other.attack,
                        base_source = %base_event.source,
                        other_source = %other_event.source,
                        "consolidate_attack_type_mismatch"
                    );
                    merged.events.push(base_event.clone());
                    continue;
                }
                if resolution.winner() == Side::Target {
                    (winner, loser) = (loser, winner);
                }
            }

            let ((winner_event, winner_attack), (loser_event, loser_attack)) = (winner, loser);
            let mut reconciled = winner_attack.clone();
            match (winner_attack.target, loser_attack.target) {
                (None, Some(_)) => reconciled.target = loser_attack.target,
                (Some(kept), Some(discarded)) if kept != discarded => {
                    self.quality_flags.push(QualityFlag::Disagreement {
                        tick,
                        kept_source: winner_event.source,
                        discarded_source: loser_event.source,
                        subject: Disagreement::PlayerAttackTarget {
                            player: base.player,
                            kept,
                            discarded,
                        },
                    });
                    tracing::warn!(
                        %tick,
                        player = base.player.as_usize(),
                        kept_target = ?kept,
                        discarded_target = ?discarded,
                        kept_source = %winner_event.source,
                        discarded_source = %loser_event.source,
                        "consolidate_attack_target_mismatch"
                    );
                }
                _ => {}
            }

            merged.events.push(Event {
                source: winner_event.source,
                kind: EventKind::PlayerAttack(reconciled),
            });
        }
    }

    /// Merges players' spell casts from a target tick into the base.
    #[expect(clippy::too_many_lines)]
    fn merge_player_spells(&mut self, tick: Tick, merged: &mut TickState, target: &TickState) {
        let base_events: Vec<Event> = merged
            .events
            .extract_if(.., |event| matches!(event.kind, EventKind::PlayerSpell(_)))
            .collect();
        let base_casts: Vec<(&Event, &PlayerCast)> = base_events
            .iter()
            .filter_map(|event| match &event.kind {
                EventKind::PlayerSpell(cast) => Some((event, cast)),
                _ => None,
            })
            .collect();
        let target_casts: Vec<(&Event, &PlayerCast)> = target
            .events
            .iter()
            .filter_map(|event| match &event.kind {
                EventKind::PlayerSpell(cast) => Some((event, cast)),
                _ => None,
            })
            .collect();

        let pairings = pair_attacks(
            &base_casts,
            &target_casts,
            |&(_, cast)| (Actor::Player(cast.player), cast.spell),
            |spell: PlayerSpell| spell,
        );
        for pairing in pairings {
            let ((base_event, base), (other_event, other)) = match pairing {
                AttackPairing::Paired { base, target } => (*base, *target),
                AttackPairing::BaseOnly(&(event, _)) => {
                    merged.events.push(event.clone());
                    continue;
                }
                AttackPairing::TargetOnly(&(event, cast)) => {
                    if merged.players.get(cast.player).is_some() {
                        merged.events.push(event.clone());
                    }
                    continue;
                }
            };

            if base_event.source == other_event.source {
                merged.events.push(base_event.clone());
                continue;
            }
            self.counters.player_spell_pairs += 1;

            let (mut winner, mut loser) = ((base_event, base), (other_event, other));
            if base.spell != other.spell {
                let resolution = conflict_resolution(merged, &base_event.kind, &other_event.kind)
                    .resolve(
                        self.ctx,
                        (base_event.source, merged),
                        (other_event.source, target),
                    );
                if let Some(tracer) = self.tracer.as_deref_mut() {
                    tracer.record_action_conflict(&ActionConflict {
                        tick,
                        actor: Actor::Player(base.player),
                        base_source: base_event.source,
                        base_kind: base.spell.as_str_name(),
                        target_source: other_event.source,
                        target_kind: other.spell.as_str_name(),
                        resolution,
                    });
                }

                if matches!(resolution, Resolution::Unexpected) {
                    self.quality_flags.push(QualityFlag::Disagreement {
                        tick,
                        kept_source: base_event.source,
                        discarded_source: other_event.source,
                        subject: Disagreement::PlayerSpellKind {
                            player: base.player,
                            kept: base.spell,
                            discarded: other.spell,
                        },
                    });
                    tracing::warn!(
                        %tick,
                        player = base.player.as_usize(),
                        base_spell = ?base.spell,
                        other_spell = ?other.spell,
                        base_source = %base_event.source,
                        other_source = %other_event.source,
                        "consolidate_spell_type_mismatch"
                    );
                    merged.events.push(base_event.clone());
                    continue;
                }
                if resolution.winner() == Side::Target {
                    (winner, loser) = (loser, winner);
                }
            }

            let ((winner_event, winner_cast), (loser_event, loser_cast)) = (winner, loser);
            let mut reconciled = winner_cast.clone();
            if winner_cast.spell.is_targeted() {
                match (winner_cast.target, loser_cast.target) {
                    (None, Some(_)) => reconciled.target = loser_cast.target,
                    (Some(kept), Some(discarded)) if kept != discarded => {
                        self.quality_flags.push(QualityFlag::Disagreement {
                            tick,
                            kept_source: winner_event.source,
                            discarded_source: loser_event.source,
                            subject: Disagreement::PlayerSpellTarget {
                                player: base.player,
                                kept,
                                discarded,
                            },
                        });
                        tracing::warn!(
                            %tick,
                            player = base.player.as_usize(),
                            kept_target = ?kept,
                            discarded_target = ?discarded,
                            kept_source = %winner_event.source,
                            discarded_source = %loser_event.source,
                            "consolidate_spell_target_mismatch"
                        );
                    }
                    _ => {}
                }
            } else {
                // Clear any spurious targets from untargeted spells.
                reconciled.target = None;
            }

            merged.events.push(Event {
                source: winner_event.source,
                kind: EventKind::PlayerSpell(reconciled),
            });
        }
    }

    /// Merges NPC attacks from a target tick into the base.
    #[expect(clippy::too_many_lines)]
    fn merge_npc_attacks(&mut self, tick: Tick, merged: &mut TickState, target: &TickState) {
        let base_events: Vec<Event> = merged
            .events
            .extract_if(.., |event| matches!(event.kind, EventKind::NpcAttack(_)))
            .collect();
        let base_attacks: Vec<(&Event, &NpcAttacked)> = base_events
            .iter()
            .filter_map(|event| match &event.kind {
                EventKind::NpcAttack(attacked) => Some((event, attacked)),
                _ => None,
            })
            .collect();
        let target_attacks: Vec<(&Event, &NpcAttacked)> = target
            .events
            .iter()
            .filter_map(|event| match &event.kind {
                EventKind::NpcAttack(attacked) => Some((event, attacked)),
                _ => None,
            })
            .collect();

        let pairings = pair_attacks(
            &base_attacks,
            &target_attacks,
            |&(_, attacked)| (Actor::Npc(attacked.npc), attacked.attack),
            normalize_npc_attack,
        );
        for pairing in pairings {
            let ((base_event, base), (other_event, other)) = match pairing {
                AttackPairing::Paired { base, target } => (*base, *target),
                AttackPairing::BaseOnly(&(event, _)) => {
                    merged.events.push(event.clone());
                    continue;
                }
                AttackPairing::TargetOnly(&(event, attacked)) => {
                    if merged.npcs.contains_key(&attacked.npc) {
                        merged.events.push(event.clone());
                    }
                    continue;
                }
            };

            let Some(npc_id) = merged.npcs.get(&base.npc).map(|npc| npc.id) else {
                merged.events.push(base_event.clone());
                continue;
            };
            if base_event.source == other_event.source {
                merged.events.push(base_event.clone());
                continue;
            }
            self.counters.npc_attack_pairs += 1;

            let (mut winner, mut loser) = ((base_event, base), (other_event, other));
            if base.attack != other.attack {
                let resolution = conflict_resolution(merged, &base_event.kind, &other_event.kind)
                    .resolve(
                        self.ctx,
                        (base_event.source, merged),
                        (other_event.source, target),
                    );
                if let Some(tracer) = self.tracer.as_deref_mut() {
                    tracer.record_action_conflict(&ActionConflict {
                        tick,
                        actor: Actor::Npc(base.npc),
                        base_source: base_event.source,
                        base_kind: base.attack.as_str_name(),
                        target_source: other_event.source,
                        target_kind: other.attack.as_str_name(),
                        resolution,
                    });
                }
                if resolution.winner() == Side::Target {
                    (winner, loser) = (loser, winner);
                }

                if matches!(resolution, Resolution::Unexpected)
                    || normalize_npc_attack(base.attack) != normalize_npc_attack(other.attack)
                {
                    self.quality_flags.push(QualityFlag::Disagreement {
                        tick,
                        kept_source: winner.0.source,
                        discarded_source: loser.0.source,
                        subject: Disagreement::NpcAttackKind {
                            room_id: base.npc,
                            npc_id,
                            kept: winner.1.attack,
                            discarded: loser.1.attack,
                        },
                    });
                    tracing::warn!(
                        %tick,
                        room_id = base.npc.0,
                        npc_id,
                        kept_attack = ?winner.1.attack,
                        discarded_attack = ?loser.1.attack,
                        kept_source = %winner.0.source,
                        discarded_source = %loser.0.source,
                        "consolidate_npc_attack_type_mismatch"
                    );
                    merged.events.push(winner.0.clone());
                    continue;
                }
            }

            let ((winner_event, winner_attack), (loser_event, loser_attack)) = (winner, loser);
            let mut reconciled = winner_attack.clone();
            match (winner_attack.target, loser_attack.target) {
                (None, Some(_)) => reconciled.target = loser_attack.target,
                (Some(kept), Some(discarded)) if kept != discarded => {
                    self.quality_flags.push(QualityFlag::Disagreement {
                        tick,
                        kept_source: winner_event.source,
                        discarded_source: loser_event.source,
                        subject: Disagreement::NpcAttackTarget {
                            room_id: base.npc,
                            npc_id,
                            kept,
                            discarded,
                        },
                    });
                    tracing::warn!(
                        %tick,
                        room_id = base.npc.0,
                        npc_id,
                        kept_target = ?kept,
                        discarded_target = ?discarded,
                        kept_source = %winner_event.source,
                        discarded_source = %loser_event.source,
                        "consolidate_npc_attack_target_mismatch"
                    );
                }
                _ => {}
            }

            merged.events.push(Event {
                source: winner_event.source,
                kind: EventKind::NpcAttack(reconciled),
            });
        }
    }

    /// Inserts a paired occurrence of an event to the earliest tick it occurred.
    fn place_paired_stream_event(
        &mut self,
        merged: &mut Recording,
        kind: event::Type,
        base: &StreamCandidate<'t>,
        target: &StreamCandidate<'t>,
    ) {
        let (winner, side) = if base.merged_tick <= target.merged_tick {
            (base, Side::Base)
        } else {
            (target, Side::Target)
        };
        let mut event = winner.event.clone();
        self.remap_ticks(side, &mut event, winner.client_tick, winner.merged_tick);
        merged
            .get_state_mut(winner.merged_tick)
            .expect("ticks with events exist")
            .events
            .push(event);
        self.counters.stream_event_pairs += 1;

        let gap = base.merged_tick.abs_diff(target.merged_tick);
        let large_gap_threshold = stream_config(self.ctx.challenge.challenge_type, kind)
            .and_then(|config| config.large_gap_threshold);
        if large_gap_threshold.is_some_and(|threshold| gap > threshold) {
            self.quality_flags.push(QualityFlag::LargeTemporalGap {
                kind,
                gap,
                base_tick: base.merged_tick,
                target_tick: target.merged_tick,
            });
        }

        if let Some(tracer) = self.tracer.as_deref_mut() {
            tracer.record_stream_resolution(&StreamResolution {
                kind,
                key: &winner.identity_key,
                base: Some(StreamOccurrence {
                    merged_tick: base.merged_tick,
                    client_tick: base.client_tick,
                }),
                target: Some(StreamOccurrence {
                    merged_tick: target.merged_tick,
                    client_tick: target.client_tick,
                }),
                resolved_tick: winner.merged_tick,
                outcome: StreamOutcome::Paired,
            });
        }
    }

    fn place_unpaired_stream_event(
        &mut self,
        merged: &mut Recording,
        kind: event::Type,
        side: Side,
        candidate: &StreamCandidate<'t>,
    ) {
        let mut event = candidate.event.clone();
        self.remap_ticks(
            side,
            &mut event,
            candidate.client_tick,
            candidate.merged_tick,
        );
        merged
            .get_state_mut(candidate.merged_tick)
            .expect("ticks with events exist")
            .events
            .push(event);

        if let Some(tracer) = self.tracer.as_deref_mut() {
            let occurrence = Some(StreamOccurrence {
                merged_tick: candidate.merged_tick,
                client_tick: candidate.client_tick,
            });
            let (base, target, outcome) = match side {
                Side::Base => (occurrence, None, StreamOutcome::UnpairedBase),
                Side::Target => (None, occurrence, StreamOutcome::UnpairedTarget),
            };
            tracer.record_stream_resolution(&StreamResolution {
                kind,
                key: &candidate.identity_key,
                base,
                target,
                resolved_tick: candidate.merged_tick,
                outcome,
            });
        }
    }

    /// Deduplicates and places buffered occurrences of event `kind` sharing an
    /// identity key into `merged`, where the key is expected to only occur once
    /// in the stage. Any duplicates are flagged and discarded.
    fn match_unique(
        &mut self,
        merged: &mut Recording,
        kind: event::Type,
        base: &[StreamCandidate<'t>],
        target: &[StreamCandidate<'t>],
    ) {
        for (side, run) in [(Side::Base, base), (Side::Target, target)] {
            if run.len() > 1 {
                tracing::warn!(
                    ?kind,
                    key = %run[0].identity_key,
                    ?side,
                    count = run.len(),
                    "consolidate_duplicate_unique_event"
                );
            }
        }

        match (base.first(), target.first()) {
            (Some(base), Some(target)) => {
                self.place_paired_stream_event(merged, kind, base, target);
            }
            (Some(base), None) => {
                self.place_unpaired_stream_event(merged, kind, Side::Base, base);
            }
            (None, Some(target)) => {
                self.place_unpaired_stream_event(merged, kind, Side::Target, target);
            }
            (None, None) => {}
        }
    }

    /// Iterates over all buffered occurrences of event `kind` sharing an
    /// identity key across both timelines, pairing and deduplicating those that
    /// match into `merged`. Events that only exist on one side are placed
    /// directly.
    fn match_temporal(
        &mut self,
        merged: &mut Recording,
        kind: event::Type,
        window: Ticks,
        base: &[StreamCandidate<'t>],
        target: &[StreamCandidate<'t>],
    ) {
        let mut base = base.iter().peekable();
        let mut target = target.iter().peekable();

        loop {
            match (base.peek(), target.peek()) {
                (Some(&b), Some(&t)) => {
                    if b.merged_tick.abs_diff(t.merged_tick) <= window {
                        self.place_paired_stream_event(merged, kind, b, t);
                        base.next();
                        target.next();
                    } else if b.merged_tick < t.merged_tick {
                        self.place_unpaired_stream_event(merged, kind, Side::Base, b);
                        base.next();
                    } else {
                        self.place_unpaired_stream_event(merged, kind, Side::Target, t);
                        target.next();
                    }
                }
                (Some(&b), None) => {
                    self.place_unpaired_stream_event(merged, kind, Side::Base, b);
                    base.next();
                }
                (None, Some(&t)) => {
                    self.place_unpaired_stream_event(merged, kind, Side::Target, t);
                    target.next();
                }
                (None, None) => break,
            }
        }
    }

    /// Removes buffered attack mapped events of `kind` on the given side and
    /// returns those whose referenced attack exists in `merged` as candidates
    /// ordered by the attack's merged tick. The rest are flagged and discarded.
    fn take_attack_mapped_candidates(
        &mut self,
        merged: &Recording,
        kind: event::Type,
        side: Side,
    ) -> Vec<AttackMappedCandidate<'t>> {
        let mappings = self.mappings;
        let (buffer, mapping) = match side {
            Side::Base => (&mut self.base_buffer, &mappings.base),
            Side::Target => (&mut self.target_buffer, &mappings.target),
        };
        let events = buffer.attack_mapped.remove(&kind).unwrap_or_default();
        let mut candidates = Vec::with_capacity(events.len());

        for buffered in events {
            self.counters.attack_mapped_events += 1;
            let client_attack_tick = referenced_tick(&buffered.event.kind);

            let Some(merged_attack_tick) = mapping.to_merged(client_attack_tick) else {
                if let Some(tracer) = self.tracer.as_deref_mut() {
                    tracer.record_attack_mapped_discard(
                        kind,
                        side,
                        buffered.client_tick,
                        client_attack_tick,
                        AttackMappedDiscardReason::UnmappedTick,
                    );
                }
                continue;
            };

            let attack_present = merged
                .get_state(merged_attack_tick)
                .is_some_and(|state| attack_present(state, &buffered.event.kind));
            if !attack_present {
                if let Some(tracer) = self.tracer.as_deref_mut() {
                    tracer.record_attack_mapped_discard(
                        kind,
                        side,
                        buffered.client_tick,
                        client_attack_tick,
                        AttackMappedDiscardReason::AttackNotFound,
                    );
                }
                self.quality_flags.push(QualityFlag::AttackMappedNotFound {
                    kind,
                    side,
                    client_tick: buffered.client_tick,
                    client_attack_tick,
                });
                continue;
            }

            candidates.push(AttackMappedCandidate {
                event: buffered.event,
                client_tick: buffered.client_tick,
                client_attack_tick,
                merged_attack_tick,
            });
        }

        candidates.sort_by_key(|candidate| candidate.merged_attack_tick);
        candidates
    }

    /// Chooses between the base's and the target's candidates referencing an
    /// attack and inserts the winning event on the tick after the attack.
    fn place_attack_mapped_event(
        &mut self,
        merged: &mut Recording,
        kind: event::Type,
        base: &[AttackMappedCandidate<'t>],
        target: &[AttackMappedCandidate<'t>],
    ) {
        if base.len() > 1 || target.len() > 1 {
            tracing::warn!(
                ?kind,
                base_count = base.len(),
                target_count = target.len(),
                "consolidate_duplicate_attack_mapped_event"
            );
        }
        let (base, target) = (base.first(), target.first());

        let (winner, side, resolution) = match (base, target) {
            (None, None) => return,
            (Some(base), None) => (base, Side::Base, None),
            (None, Some(target)) => (target, Side::Target, None),
            (Some(base), Some(target)) => {
                if candidates_agree(&base.event.kind, &target.event.kind) {
                    (base, Side::Base, None)
                } else {
                    let attack_tick = base.merged_attack_tick;
                    let state = merged
                        .get_state(attack_tick)
                        .expect("candidates reference existing attack ticks");
                    let resolution =
                        conflict_resolution(state, &base.event.kind, &target.event.kind).resolve(
                            self.ctx,
                            (base.event.source, state),
                            (target.event.source, state),
                        );
                    if matches!(resolution, Resolution::Unexpected) {
                        self.quality_flags.push(QualityFlag::Disagreement {
                            tick: attack_tick,
                            kept_source: base.event.source,
                            discarded_source: target.event.source,
                            subject: Disagreement::AttackMapped { kind },
                        });
                        tracing::warn!(
                            ?kind,
                            %attack_tick,
                            base_source = %base.event.source,
                            target_source = %target.event.source,
                            "consolidate_unexpected_attack_mapped_conflict"
                        );
                    }
                    let side = resolution.winner();
                    let winner = match side {
                        Side::Base => base,
                        Side::Target => target,
                    };
                    (winner, side, Some(resolution))
                }
            }
        };

        let attack_tick = winner.merged_attack_tick;
        let resolved_tick = attack_tick.succ();

        if let Some(tracer) = self.tracer.as_deref_mut() {
            tracer.record_attack_mapped_resolution(&AttackMappedResolution {
                kind,
                attack_tick,
                base,
                target,
                resolved_tick,
                winner: side,
                resolution,
            });
        }

        if let Some(state) = merged.get_state_mut(resolved_tick) {
            let mut event = winner.event.clone();
            self.remap_ticks(side, &mut event, winner.client_tick, resolved_tick);
            state.events.push(event);
        }
    }
}

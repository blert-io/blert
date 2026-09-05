//! Deduplication and consolidation of events between a pair of clients.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

use crate::lifecycle::core::types::ClientId;
use crate::npc;
use crate::proto::{Coords, Event, NpcAttack, PlayerAttack, PlayerSpell, event};

use super::event::{
    Class, IdentityKey, TaggedEvent, classify, identity_key, normalize_npc_attack,
    normalize_player_attack, remap_event_tick, stream_config,
};
use super::timeline::{Actor, Target, TickState, Timeline};
use super::trace::{
    ActionConflict, AttackMappedDiscardReason, AttackMappedResolution, StreamOccurrence,
    StreamOutcome, StreamResolution, TickMergeDecision, Tracer,
};
use super::world::euclidean;
use super::{Mappings, MergeContext, Tick, Ticks};

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
        player: String,
        kept: PlayerAttack,
        discarded: PlayerAttack,
    },
    PlayerAttackTarget {
        player: String,
        kept: Target,
        discarded: Target,
    },
    PlayerSpellKind {
        player: String,
        kept: PlayerSpell,
        discarded: PlayerSpell,
    },
    PlayerSpellTarget {
        player: String,
        kept: Target,
        discarded: Target,
    },
    NpcAttackKind {
        room_id: u64,
        npc_id: u32,
        kept: NpcAttack,
        discarded: NpcAttack,
    },
    NpcAttackTarget {
        room_id: u64,
        npc_id: u32,
        kept: Target,
        discarded: Target,
    },
    AttackMapped {
        kind: event::Type,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum QualityFlag {
    Disagreement {
        tick: Tick,
        kept_source: ClientId,
        discarded_source: ClientId,
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
    pub timeline: Timeline,
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
    Proximity { position: Coords },
}

#[derive(Debug, Clone, Copy)]
pub(super) struct Measurement<'a> {
    pub primary_player: &'a str,
    pub distance: f64,
}

#[derive(Debug, Clone, Copy)]
pub(super) enum Resolution<'a> {
    Unexpected,
    KeepBase,
    Proximity {
        base: Option<Measurement<'a>>,
        target: Option<Measurement<'a>>,
        winner: Side,
    },
}

impl Resolution<'_> {
    fn winner(&self) -> Side {
        match self {
            Self::Unexpected | Self::KeepBase => Side::Base,
            Self::Proximity { winner, .. } => *winner,
        }
    }
}

impl ResolutionStrategy {
    /// Chooses between the base's and the target's views of an occurrence.
    fn resolve<'s>(
        &self,
        ctx: &'s MergeContext<'_>,
        base: (ClientId, &'s TickState),
        target: (ClientId, &'s TickState),
    ) -> Resolution<'s> {
        match self {
            Self::Unexpected => Resolution::Unexpected,
            Self::KeepBase => Resolution::KeepBase,
            Self::Proximity { position } => {
                let measure = |(client, state): (ClientId, &'s TickState)| {
                    let primary_player = ctx.primary_player(client)?;
                    let player = state.player(primary_player)?;
                    Some(Measurement {
                        primary_player,
                        distance: euclidean(player.position, *position),
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

struct AttackMappedConfig {
    /// Extracts the referenced attack tick from the event, in its client's
    /// tick space.
    referenced_tick: fn(&Event) -> Tick,
    /// Checks whether the referenced attack exists in a tick's state.
    attack_present: fn(&TickState, &Event) -> bool,
    /// Defines the strategy for resolving disagreeing candidates from the state
    /// of the referenced attack's tick.
    conflict_resolution: fn(&TickState) -> ResolutionStrategy,
    /// Checks whether two candidates agree on the event's content.
    candidates_agree: fn(&Event, &Event) -> bool,
}

/// Returns how an attack-mapped event type is resolved.
fn attack_mapped_config(kind: event::Type) -> AttackMappedConfig {
    match kind {
        event::Type::TobVerzikAttackStyle => AttackMappedConfig {
            referenced_tick: |event| {
                let style = event
                    .verzik_attack_style
                    .as_ref()
                    .expect("validated at build");
                Tick(style.npc_attack_tick)
            },
            attack_present: |state, _| {
                state.npcs().any(|(_, npc)| {
                    npc.attack
                        .as_ref()
                        .is_some_and(|attack| attack.value.kind == NpcAttack::TobVerzikP3Auto)
                })
            },
            conflict_resolution: |state| {
                // Projectiles originate from roughly Verzik's center; P3 is 7x7.
                state
                    .npcs()
                    .find_map(|(_, npc)| {
                        npc::is_verzik_p3(npc.id).then(|| ResolutionStrategy::Proximity {
                            position: Coords {
                                x: npc.position.x + 3,
                                y: npc.position.y + 3,
                            },
                        })
                    })
                    .unwrap_or(ResolutionStrategy::KeepBase)
            },
            candidates_agree: |a, b| {
                let style = |e: &Event| {
                    e.verzik_attack_style
                        .as_ref()
                        .expect("validated at build")
                        .style
                };
                style(a) == style(b)
            },
        },

        event::Type::TobVerzikBounce => AttackMappedConfig {
            referenced_tick: |event| {
                let bounce = event.verzik_bounce.as_ref().expect("validated at build");
                Tick(bounce.npc_attack_tick.cast_unsigned())
            },
            attack_present: |state, event| {
                let Some((_, verzik)) = state.npcs().find(|(_, npc)| npc::is_verzik_p2(npc.id))
                else {
                    return false;
                };
                // Bounce events are dispatched on every Verzik attack, whether
                // or not a bounce happened, to track bounce chances. If there
                // is a bounced player in the event, search for a bounce attack;
                // otherwise any Verzik attack will do.
                let bounce = event.verzik_bounce.as_ref().expect("validated at build");
                match bounce.bounced_player.as_deref() {
                    Some(player) if !player.is_empty() => verzik
                        .attack
                        .as_ref()
                        .is_some_and(|attack| attack.value.kind == NpcAttack::TobVerzikP2Bounce),
                    _ => verzik.attack.is_some(),
                }
            },
            conflict_resolution: |_| ResolutionStrategy::Unexpected,
            candidates_agree: |a, b| {
                let a = a.verzik_bounce.as_ref().expect("validated at build");
                let b = b.verzik_bounce.as_ref().expect("validated at build");
                a.bounced_player.as_deref().unwrap_or("")
                    == b.bounced_player.as_deref().unwrap_or("")
            },
        },

        event::Type::TobVerzikDawn => AttackMappedConfig {
            referenced_tick: |event| {
                let dawn = event.verzik_dawn.as_ref().expect("validated at build");
                Tick(dawn.attack_tick)
            },
            attack_present: |state, event| {
                let dawn = event.verzik_dawn.as_ref().expect("validated at build");
                state.player(&dawn.player).is_some_and(|player| {
                    player
                        .attack
                        .as_ref()
                        .is_some_and(|attack| attack.value.kind == PlayerAttack::DawnSpec)
                })
            },
            conflict_resolution: |_| ResolutionStrategy::Unexpected,
            candidates_agree: |a, b| {
                let a = a.verzik_dawn.as_ref().expect("validated at build");
                let b = b.verzik_dawn.as_ref().expect("validated at build");
                a.player == b.player && a.damage == b.damage
            },
        },

        _ => unreachable!("non attack-mapped event"),
    }
}

#[derive(Debug, Clone, Copy)]
pub(super) struct AttackMappedCandidate<'a> {
    pub event: &'a TaggedEvent,
    pub client_tick: Tick,
    pub client_attack_tick: Tick,
    pub merged_attack_tick: Tick,
}

fn should_buffer(event: &TaggedEvent) -> bool {
    matches!(
        classify(event.r#type()),
        Class::Stream | Class::AttackMapped
    )
}

/// An event held for reconciliation between clients.
#[derive(Debug)]
struct BufferedEvent<'a> {
    event: &'a TaggedEvent,
    merged_tick: Tick,
    client_tick: Tick,
}

#[derive(Debug, Default)]
struct EventBuffer<'a>(BTreeMap<event::Type, Vec<BufferedEvent<'a>>>);

impl<'a> EventBuffer<'a> {
    fn add_events(
        &mut self,
        events: impl IntoIterator<Item = &'a TaggedEvent>,
        merged_tick: Tick,
        client_tick: Tick,
    ) {
        for event in events {
            self.0
                .entry(event.r#type())
                .or_default()
                .push(BufferedEvent {
                    event,
                    merged_tick,
                    client_tick,
                });
        }
    }

    /// Removes and returns the events of `kind`.
    fn take(&mut self, kind: event::Type) -> Vec<BufferedEvent<'a>> {
        self.0.remove(&kind).unwrap_or_default()
    }

    /// Removes the events of `kind` and returns them as stream candidates,
    /// ordered by identity key and then by merged tick.
    ///
    /// # Panics
    /// Panics if events of `kind` do not have an identity key mapping.
    fn take_stream_candidates(&mut self, kind: event::Type) -> Vec<StreamCandidate<'a>> {
        let mut candidates: Vec<StreamCandidate<'a>> = self
            .take(kind)
            .into_iter()
            .map(|buffered| StreamCandidate {
                event: buffered.event,
                identity_key: identity_key(buffered.event),
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
    event: &'a TaggedEvent,
    identity_key: IdentityKey<'a>,
    merged_tick: Tick,
    client_tick: Tick,
}

/// Initializes tick `merged_tick` in `merged` to a clone of `state` with its
/// buffered events extracted into `buffer`.
fn place_tick<'a>(
    merged: &mut Timeline,
    buffer: &mut EventBuffer<'a>,
    state: &'a TickState,
    merged_tick: Tick,
) {
    let mut cloned = state.clone();
    cloned.extract_events(should_buffer);
    buffer.add_events(
        state.events().filter(|&event| should_buffer(event)),
        merged_tick,
        state.tick(),
    );
    merged.set(merged_tick, cloned);
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

pub(super) struct Consolidator<'a> {
    base: &'a Timeline,
    target: &'a Timeline,
    target_client_id: ClientId,
    mappings: &'a Mappings,
    ctx: &'a MergeContext<'a>,
    tracer: Option<&'a mut Tracer>,
    base_buffer: EventBuffer<'a>,
    target_buffer: EventBuffer<'a>,
    quality_flags: Vec<QualityFlag>,
    counters: ReconciliationCounters,
}

impl<'a> Consolidator<'a> {
    /// Constructs a consolidator to merge `target` into `base`.
    ///
    /// # Panics
    /// Panics if the mapping in `ctx` has not been initialized for the step.
    pub(super) fn new(
        base: &'a Timeline,
        target: &'a Timeline,
        ctx: &'a MergeContext<'a>,
        tracer: Option<&'a mut Tracer>,
    ) -> Self {
        let mappings = ctx.mapping.current_step().expect("merge step has begun");
        let target_client_id = ctx
            .mapping
            .target_client_id()
            .expect("merge step has begun");

        Self {
            base,
            target,
            target_client_id,
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
        // Runs four passes over the timeline:
        // 1. Initial construction with all base ticks and target insertions.
        // 2. Consolidation, merging target states into paired base ticks.
        // 3. Stream reconciliation deduplicating stream events and resolving
        //    conflicts between them.
        // 4. Remapping of every tick's events to its final tick number.
        let mut timeline = self.build_timeline();
        self.consolidate_ticks(&mut timeline);
        self.reconcile_streams(&mut timeline);
        self.remap_to_merged_space(&mut timeline);

        if let Some(tracer) = self.tracer.as_deref_mut() {
            tracer.record_quality_flags(&self.quality_flags);
            tracer.record_reconciliation_counters(&self.counters);
        }

        ConsolidationResult {
            timeline,
            quality_flags: self.quality_flags,
            counters: self.counters,
        }
    }

    /// Constructs an initial merged timeline by placing mapped base ticks and
    /// inserting target-only ticks into empty slots. Strips buffered events
    /// from every placed tick.
    fn build_timeline(&mut self) -> Timeline {
        let mut merged = Timeline::empty(self.mappings.merged_last_tick);

        for tick in self.base.last_tick().up_to_inclusive() {
            let (Some(merged_tick), Some(state)) =
                (self.mappings.base.to_merged(tick), self.base.get(tick))
            else {
                continue;
            };
            place_tick(&mut merged, &mut self.base_buffer, state, merged_tick);
        }

        for tick in self.target.last_tick().up_to_inclusive() {
            let (Some(merged_tick), Some(state)) =
                (self.mappings.target.to_merged(tick), self.target.get(tick))
            else {
                continue;
            };
            if merged.get(merged_tick).is_some() {
                continue;
            }
            place_tick(&mut merged, &mut self.target_buffer, state, merged_tick);
        }

        merged
    }

    /// Walks the merged timeline after the initial build phase, merging the
    /// target into every tick both sides recorded and buffering its events.
    fn consolidate_ticks(&mut self, merged: &mut Timeline) {
        let mappings = self.mappings;
        let (base, target) = (self.base, self.target);

        for tick in merged.last_tick().up_to_inclusive() {
            let base_state = mappings.base.to_client(tick).and_then(|t| base.get(t));
            let target_state = mappings.target.to_client(tick).and_then(|t| target.get(t));

            let decision = match (base_state, target_state) {
                (Some(_), Some(target_state)) => {
                    self.target_buffer.add_events(
                        target_state.events().filter(|&event| should_buffer(event)),
                        tick,
                        target_state.tick(),
                    );
                    let state = merged
                        .get_mut(tick)
                        .expect("timeline initialized with base ticks");
                    state.merge_from(target_state);
                    self.merge_player_attacks(state, target_state);
                    self.merge_player_spells(state, target_state);
                    self.merge_npc_attacks(state, target_state);
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
    fn reconcile_streams(&mut self, merged: &mut Timeline) {
        let challenge = self.ctx.challenge.challenge_type;
        let (streams, attack_mapped): (BTreeSet<event::Type>, BTreeSet<event::Type>) = self
            .base_buffer
            .0
            .keys()
            .chain(self.target_buffer.0.keys())
            .copied()
            .partition(|&kind| classify(kind) == Class::Stream);

        for kind in streams {
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

        for kind in attack_mapped {
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

    /// Remaps all events in the merged timeline from client tick space to
    /// merged tick space.
    fn remap_to_merged_space(&mut self, merged: &mut Timeline) {
        let mappings = self.mappings;
        let target_client_id = self.target_client_id;

        for merged_tick in merged.last_tick().up_to_inclusive() {
            let Some(state) = merged.get_mut(merged_tick) else {
                continue;
            };
            let mut events = state.extract_events(|_| true);

            for event in &mut events {
                let mapping = if event.source() == target_client_id {
                    &mappings.target
                } else {
                    &mappings.base
                };
                let (kind, source, source_tick) =
                    (event.r#type(), event.source(), Tick(event.tick));

                remap_event_tick(event, |tick| {
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
                event.tick = merged_tick.0;
            }

            state.add_events(events);
        }
    }

    /// Merges player attacks from a target tick into the base.
    fn merge_player_attacks(&mut self, merged: &mut TickState, target: &TickState) {
        let tick = merged.tick();

        for (player, other_state) in target.players() {
            let Some(other) = other_state.attack.as_ref() else {
                continue;
            };
            let Some(attacker) = merged.player(player) else {
                continue;
            };
            let Some(base) = attacker.attack.as_ref() else {
                merged.set_player_attack(player, Some(other.clone()));
                continue;
            };

            if base.source == other.source {
                continue;
            }
            self.counters.player_attack_pairs += 1;

            let (mut winner, mut loser) = (base, other);
            if base.value.kind != other.value.kind {
                let strategy = if normalize_player_attack(base.value.kind)
                    == normalize_player_attack(other.value.kind)
                {
                    ResolutionStrategy::Proximity {
                        position: attacker.position,
                    }
                } else {
                    ResolutionStrategy::Unexpected
                };
                let resolution =
                    strategy.resolve(self.ctx, (base.source, merged), (other.source, target));
                if let Some(tracer) = self.tracer.as_deref_mut() {
                    tracer.record_action_conflict(&ActionConflict {
                        tick,
                        actor: Actor::Player(player),
                        base_source: base.source,
                        base_kind: base.value.kind.as_str_name(),
                        target_source: other.source,
                        target_kind: other.value.kind.as_str_name(),
                        resolution,
                    });
                }

                if matches!(resolution, Resolution::Unexpected) {
                    self.quality_flags.push(QualityFlag::Disagreement {
                        tick,
                        kept_source: base.source,
                        discarded_source: other.source,
                        subject: Disagreement::PlayerAttackKind {
                            player: player.to_string(),
                            kept: base.value.kind,
                            discarded: other.value.kind,
                        },
                    });
                    tracing::warn!(
                        %tick,
                        player,
                        base_attack = ?base.value.kind,
                        other_attack = ?other.value.kind,
                        base_source = %base.source,
                        other_source = %other.source,
                        "consolidate_attack_type_mismatch"
                    );
                    continue;
                }
                if resolution.winner() == Side::Target {
                    (winner, loser) = (other, base);
                }
            }

            let mut reconciled = winner.clone();
            match (&winner.value.target, &loser.value.target) {
                (None, Some(_)) => {
                    reconciled.value.target.clone_from(&loser.value.target);
                    reconciled.value.distance_to_target = loser.value.distance_to_target;
                }
                (Some(kept), Some(discarded)) if !kept.value.same_actor(&discarded.value) => {
                    self.quality_flags.push(QualityFlag::Disagreement {
                        tick,
                        kept_source: winner.source,
                        discarded_source: loser.source,
                        subject: Disagreement::PlayerAttackTarget {
                            player: player.to_string(),
                            kept: kept.value.clone(),
                            discarded: discarded.value.clone(),
                        },
                    });
                    tracing::warn!(
                        %tick,
                        player,
                        kept_target = ?kept.value,
                        discarded_target = ?discarded.value,
                        kept_source = %winner.source,
                        discarded_source = %loser.source,
                        "consolidate_attack_target_mismatch"
                    );
                }
                _ => {}
            }

            merged.set_player_attack(player, Some(reconciled));
        }
    }

    /// Merges players' spell casts from a target tick into the base.
    fn merge_player_spells(&mut self, merged: &mut TickState, target: &TickState) {
        let tick = merged.tick();

        for (player, other_state) in target.players() {
            let Some(other) = other_state.spell.as_ref() else {
                continue;
            };
            let Some(caster) = merged.player(player) else {
                continue;
            };
            let Some(base) = caster.spell.as_ref() else {
                merged.set_player_spell(player, Some(other.clone()));
                continue;
            };

            if base.source == other.source {
                continue;
            }
            self.counters.player_spell_pairs += 1;

            if base.value.kind != other.value.kind {
                let resolution = ResolutionStrategy::Unexpected.resolve(
                    self.ctx,
                    (base.source, merged),
                    (other.source, target),
                );
                if let Some(tracer) = self.tracer.as_deref_mut() {
                    tracer.record_action_conflict(&ActionConflict {
                        tick,
                        actor: Actor::Player(player),
                        base_source: base.source,
                        base_kind: base.value.kind.as_str_name(),
                        target_source: other.source,
                        target_kind: other.value.kind.as_str_name(),
                        resolution,
                    });
                }

                self.quality_flags.push(QualityFlag::Disagreement {
                    tick,
                    kept_source: base.source,
                    discarded_source: other.source,
                    subject: Disagreement::PlayerSpellKind {
                        player: player.to_string(),
                        kept: base.value.kind,
                        discarded: other.value.kind,
                    },
                });
                tracing::warn!(
                    %tick,
                    player,
                    base_spell = ?base.value.kind,
                    other_spell = ?other.value.kind,
                    base_source = %base.source,
                    other_source = %other.source,
                    "consolidate_spell_type_mismatch"
                );
                continue;
            }

            let mut reconciled = base.clone();
            if base.value.kind.is_targeted() {
                match (&base.value.target, &other.value.target) {
                    (None, Some(_)) => {
                        reconciled.value.target.clone_from(&other.value.target);
                    }
                    (Some(kept), Some(discarded)) if !kept.value.same_actor(&discarded.value) => {
                        self.quality_flags.push(QualityFlag::Disagreement {
                            tick,
                            kept_source: base.source,
                            discarded_source: other.source,
                            subject: Disagreement::PlayerSpellTarget {
                                player: player.to_string(),
                                kept: kept.value.clone(),
                                discarded: discarded.value.clone(),
                            },
                        });
                        tracing::warn!(
                            %tick,
                            player,
                            kept_target = ?kept.value,
                            discarded_target = ?discarded.value,
                            kept_source = %base.source,
                            discarded_source = %other.source,
                            "consolidate_spell_target_mismatch"
                        );
                    }
                    _ => {}
                }
            } else {
                // Clear any spurious targets from untargeted spells.
                reconciled.value.target = None;
            }

            merged.set_player_spell(player, Some(reconciled));
        }
    }

    /// Merges NPC attacks from a target tick into the base.
    fn merge_npc_attacks(&mut self, merged: &mut TickState, target: &TickState) {
        let tick = merged.tick();

        for (room_id, other_npc) in target.npcs() {
            let Some(other) = other_npc.attack.as_ref() else {
                continue;
            };
            let Some(npc) = merged.npc(room_id) else {
                continue;
            };
            let Some(base) = npc.attack.as_ref() else {
                merged.set_npc_attack(room_id, Some(other.clone()));
                continue;
            };

            if base.source == other.source {
                continue;
            }
            self.counters.npc_attack_pairs += 1;

            let (mut winner, mut loser) = (base, other);
            if base.value.kind != other.value.kind {
                let strategy = if normalize_npc_attack(base.value.kind)
                    == normalize_npc_attack(other.value.kind)
                {
                    ResolutionStrategy::Proximity {
                        position: npc.position,
                    }
                } else {
                    ResolutionStrategy::Unexpected
                };
                let resolution =
                    strategy.resolve(self.ctx, (base.source, merged), (other.source, target));
                if let Some(tracer) = self.tracer.as_deref_mut() {
                    tracer.record_action_conflict(&ActionConflict {
                        tick,
                        actor: Actor::Npc(room_id),
                        base_source: base.source,
                        base_kind: base.value.kind.as_str_name(),
                        target_source: other.source,
                        target_kind: other.value.kind.as_str_name(),
                        resolution,
                    });
                }

                if matches!(resolution, Resolution::Unexpected) {
                    self.quality_flags.push(QualityFlag::Disagreement {
                        tick,
                        kept_source: base.source,
                        discarded_source: other.source,
                        subject: Disagreement::NpcAttackKind {
                            room_id,
                            npc_id: npc.id,
                            kept: base.value.kind,
                            discarded: other.value.kind,
                        },
                    });
                    tracing::warn!(
                        %tick,
                        room_id,
                        npc_id = npc.id,
                        base_attack = ?base.value.kind,
                        other_attack = ?other.value.kind,
                        base_source = %base.source,
                        other_source = %other.source,
                        "consolidate_npc_attack_type_mismatch"
                    );
                    continue;
                }
                if resolution.winner() == Side::Target {
                    (winner, loser) = (other, base);
                }
            }

            let mut reconciled = winner.clone();
            match (&winner.value.target, &loser.value.target) {
                (None, Some(_)) => {
                    reconciled.value.target.clone_from(&loser.value.target);
                }
                (Some(kept), Some(discarded)) if !kept.value.same_actor(&discarded.value) => {
                    self.quality_flags.push(QualityFlag::Disagreement {
                        tick,
                        kept_source: winner.source,
                        discarded_source: loser.source,
                        subject: Disagreement::NpcAttackTarget {
                            room_id,
                            npc_id: npc.id,
                            kept: kept.value.clone(),
                            discarded: discarded.value.clone(),
                        },
                    });
                    tracing::warn!(
                        %tick,
                        room_id,
                        npc_id = npc.id,
                        kept_target = ?kept.value,
                        discarded_target = ?discarded.value,
                        kept_source = %winner.source,
                        discarded_source = %loser.source,
                        "consolidate_npc_attack_target_mismatch"
                    );
                }
                _ => {}
            }

            merged.set_npc_attack(room_id, Some(reconciled));
        }
    }

    /// Inserts a paired occurrence of an event to the earliest tick it occurred.
    fn place_paired_stream_event(
        &mut self,
        merged: &mut Timeline,
        kind: event::Type,
        base: &StreamCandidate<'a>,
        target: &StreamCandidate<'a>,
    ) {
        let winner = if base.merged_tick <= target.merged_tick {
            base
        } else {
            target
        };
        merged
            .get_mut(winner.merged_tick)
            .expect("ticks with events exist")
            .add_events([winner.event.clone()]);
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
        merged: &mut Timeline,
        kind: event::Type,
        side: Side,
        event: &StreamCandidate<'a>,
    ) {
        merged
            .get_mut(event.merged_tick)
            .expect("ticks with events exist")
            .add_events([event.event.clone()]);

        if let Some(tracer) = self.tracer.as_deref_mut() {
            let occurrence = Some(StreamOccurrence {
                merged_tick: event.merged_tick,
                client_tick: event.client_tick,
            });
            let (base, target, outcome) = match side {
                Side::Base => (occurrence, None, StreamOutcome::UnpairedBase),
                Side::Target => (None, occurrence, StreamOutcome::UnpairedTarget),
            };
            tracer.record_stream_resolution(&StreamResolution {
                kind,
                key: &event.identity_key,
                base,
                target,
                resolved_tick: event.merged_tick,
                outcome,
            });
        }
    }

    /// Deduplicates and places buffered occurrences of event `kind` sharing an
    /// identity key into `merged`, where the key is expected to only occur once
    /// in the stage. Any duplicates are flagged and discarded.
    fn match_unique(
        &mut self,
        merged: &mut Timeline,
        kind: event::Type,
        base: &[StreamCandidate<'a>],
        target: &[StreamCandidate<'a>],
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
        merged: &mut Timeline,
        kind: event::Type,
        window: Ticks,
        base: &[StreamCandidate<'a>],
        target: &[StreamCandidate<'a>],
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
        merged: &Timeline,
        kind: event::Type,
        side: Side,
    ) -> Vec<AttackMappedCandidate<'a>> {
        let config = attack_mapped_config(kind);
        let mappings = self.mappings;
        let (buffer, mapping) = match side {
            Side::Base => (&mut self.base_buffer, &mappings.base),
            Side::Target => (&mut self.target_buffer, &mappings.target),
        };
        let events = buffer.take(kind);
        let mut candidates = Vec::with_capacity(events.len());

        for buffered in events {
            self.counters.attack_mapped_events += 1;
            let client_attack_tick = (config.referenced_tick)(buffered.event);

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
                .get(merged_attack_tick)
                .is_some_and(|state| (config.attack_present)(state, buffered.event));
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
        merged: &mut Timeline,
        kind: event::Type,
        base: &[AttackMappedCandidate<'a>],
        target: &[AttackMappedCandidate<'a>],
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
                let config = attack_mapped_config(kind);
                if (config.candidates_agree)(base.event, target.event) {
                    (base, Side::Base, None)
                } else {
                    let attack_tick = base.merged_attack_tick;
                    let state = merged
                        .get(attack_tick)
                        .expect("candidates reference existing attack ticks");
                    let resolution = (config.conflict_resolution)(state).resolve(
                        self.ctx,
                        (base.event.source(), state),
                        (target.event.source(), state),
                    );
                    if matches!(resolution, Resolution::Unexpected) {
                        self.quality_flags.push(QualityFlag::Disagreement {
                            tick: attack_tick,
                            kept_source: base.event.source(),
                            discarded_source: target.event.source(),
                            subject: Disagreement::AttackMapped { kind },
                        });
                        tracing::warn!(
                            ?kind,
                            %attack_tick,
                            base_source = %base.event.source(),
                            target_source = %target.event.source(),
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

        if let Some(state) = merged.get_mut(resolved_tick) {
            state.add_events([winner.event.clone()]);
        }
    }
}

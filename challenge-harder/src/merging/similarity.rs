//! Tick state similarity scoring.

#![cfg_attr(not(test), expect(dead_code))]

use crate::npc;
use crate::proto::event::player::EquipmentSlot;
use crate::proto::{NpcAttack, PlayerAttack, event};
use crate::skill::SkillLevel;

use super::event::{normalize_npc_attack, normalize_player_attack};
use super::timeline::{Actor, Sourced, Target, TickState};

const VISIBLE_EQUIPMENT_SLOTS: [EquipmentSlot; 9] = [
    EquipmentSlot::Head,
    EquipmentSlot::Cape,
    EquipmentSlot::Amulet,
    EquipmentSlot::Weapon,
    EquipmentSlot::Torso,
    EquipmentSlot::Shield,
    EquipmentSlot::Legs,
    EquipmentSlot::Gloves,
    EquipmentSlot::Boots,
];

/// Tunable parameters for tick state similarity scoring.
#[derive(Debug, Clone)]
pub(super) struct ScoringWeights {
    /// The flat reward a compatible tick pair earns when it corroborates on at
    /// least one shared actor (see [`SimilarityScorer::score`]).
    pub baseline_compatibility_weight: f64,

    pub component_hitpoints_weight: f64,
    pub hitpoints_varbit_k: f64,
    pub hitpoints_varbit_weight: f64,
    pub hitpoints_regular_k: f64,
    pub hitpoints_regular_weight: f64,
    pub hitpoints_delta_threshold: f64,
    pub hitpoints_max_score: f64,

    pub component_attacks_weight: f64,
    pub player_attack_contradictory_penalty: f64,
    pub player_attack_positive_signal: f64,
    pub player_attack_weak_positive_signal: f64,
    pub player_attack_weak_negative_signal: f64,
    pub player_attack_max_score: f64,
    pub player_attack_min_score: f64,

    pub npc_attack_contradictory_penalty: f64,
    pub npc_attack_positive_signal: f64,
    pub npc_attack_weak_positive_signal: f64,
    pub npc_attack_weak_negative_signal: f64,
    pub npc_attack_max_score: f64,
    pub npc_attack_min_score: f64,

    pub component_prayers_weight: f64,
    pub prayers_positive_signal: f64,
    pub prayers_negative_signal: f64,
    pub prayers_max_score: f64,
    pub prayers_min_score: f64,

    pub component_deaths_weight: f64,
    pub player_death_positive_signal: f64,
    pub npc_death_positive_signal: f64,
    pub deaths_max_score: f64,
}

// Values determined purely based off vibes, or as software engineers like to
// call them, "heuristics".
impl Default for ScoringWeights {
    fn default() -> Self {
        Self {
            baseline_compatibility_weight: 4.0,

            // Hitpoints are fuzzy and there can be many NPCs in a room, so
            // score lower.
            component_hitpoints_weight: 0.15,
            hitpoints_varbit_k: 50.0,
            hitpoints_varbit_weight: 10.0,
            hitpoints_regular_k: 5.0,
            hitpoints_regular_weight: 2.0,
            hitpoints_delta_threshold: 0.4,
            hitpoints_max_score: 10.0,

            component_attacks_weight: 0.5,
            player_attack_contradictory_penalty: -10.0,
            player_attack_positive_signal: 2.0,
            player_attack_weak_positive_signal: 0.5,
            player_attack_weak_negative_signal: -0.2,
            player_attack_max_score: 10.0,
            player_attack_min_score: -20.0,

            // There are generally fewer NPC attacks than player attacks, so
            // score higher.
            npc_attack_contradictory_penalty: -10.0,
            npc_attack_positive_signal: 4.0,
            npc_attack_weak_positive_signal: 1.0,
            npc_attack_weak_negative_signal: -0.5,
            npc_attack_max_score: 10.0,
            npc_attack_min_score: -10.0,

            // Overhead prayers are visible to all clients and should match.
            component_prayers_weight: 0.2,
            prayers_positive_signal: 1.0,
            prayers_negative_signal: -1.0,
            prayers_max_score: 5.0,
            prayers_min_score: -5.0,

            // Deaths can be observed on different ticks, so only positive
            // signals apply.
            component_deaths_weight: 0.1,
            player_death_positive_signal: 0.5,
            npc_death_positive_signal: 1.0,
            deaths_max_score: 3.0,
        }
    }
}

/// Scores how likely two tick states are to represent the same moment in time.
pub(super) struct SimilarityScorer {
    weights: ScoringWeights,
}

impl SimilarityScorer {
    pub(super) fn new() -> Self {
        Self {
            weights: ScoringWeights::default(),
        }
    }

    pub(super) fn with_weights(weights: ScoringWeights) -> Self {
        Self { weights }
    }

    /// Scores the similarity of the two tick states, with a higher score
    /// indicating a likelihood that the two tick states represent the same
    /// moment in time.
    ///
    /// A score of negative infinity indicates that the two tick states are
    /// incompatible.
    pub(super) fn score(&self, tick_a: &TickState, tick_b: &TickState) -> f64 {
        let Some(compared_actors) = check_compatibility(tick_a, tick_b) else {
            return f64::NEG_INFINITY;
        };

        let hitpoints_score = self.score_npc_hitpoints(tick_a, tick_b);
        let player_attacks_score = self.score_player_attacks(tick_a, tick_b);
        let npc_attacks_score = self.score_npc_attacks(tick_a, tick_b);
        let prayers_score = self.score_prayers(tick_a, tick_b);
        let deaths_score = self.score_deaths(tick_a, tick_b);

        // Apply a baseline reward when the ticks corroborate on some actors.
        let baseline = if compared_actors > 0 {
            self.weights.baseline_compatibility_weight
        } else {
            0.0
        };

        baseline
            + hitpoints_score * self.weights.component_hitpoints_weight
            + (player_attacks_score + npc_attacks_score) * self.weights.component_attacks_weight
            + prayers_score * self.weights.component_prayers_weight
            + deaths_score * self.weights.component_deaths_weight
    }

    fn score_npc_hitpoints(&self, tick_a: &TickState, tick_b: &TickState) -> f64 {
        let weights = &self.weights;
        let mut score = 0.0;

        for (room_id, state_a) in tick_a.npcs() {
            let Some(state_b) = tick_b.npc(room_id) else {
                continue;
            };

            let (weight, k) = if has_varbit_based_hitpoints(state_a.id) {
                (weights.hitpoints_varbit_weight, weights.hitpoints_varbit_k)
            } else {
                (
                    weights.hitpoints_regular_weight,
                    weights.hitpoints_regular_k,
                )
            };

            let delta = (normalize_hitpoints(state_a.hitpoints)
                - normalize_hitpoints(state_b.hitpoints))
            .abs();
            if delta > weights.hitpoints_delta_threshold {
                // Hitpoints are inherently fuzzy between clients, so large
                // differences are ignored instead of penalized.
                // TODO(frolv): Maybe penalize varbit-based NPCs?
                continue;
            }

            let decay = (-k * delta * delta).exp();
            score += weight * decay;
        }

        score.min(weights.hitpoints_max_score)
    }

    fn score_player_attacks(&self, tick_a: &TickState, tick_b: &TickState) -> f64 {
        fn transform(tick: &TickState) -> Vec<Attack<'_, PlayerAttack>> {
            tick.players()
                .filter_map(|(name, state)| {
                    let attack = state.attack.as_ref()?;
                    Some(Attack {
                        actor: Actor::Player(name),
                        target: attack.value.target.as_ref(),
                        kind: attack.value.kind,
                        secondary_id: attack.value.weapon.map_or(0, |weapon| weapon.id),
                    })
                })
                .collect()
        }

        score_attacks(
            (tick_a, &transform(tick_a)),
            (tick_b, &transform(tick_b)),
            normalize_player_attack,
            AttackScores {
                positive: self.weights.player_attack_positive_signal,
                weak_positive: self.weights.player_attack_weak_positive_signal,
                weak_negative: self.weights.player_attack_weak_negative_signal,
                contradictory: self.weights.player_attack_contradictory_penalty,
                min: self.weights.player_attack_min_score,
                max: self.weights.player_attack_max_score,
            },
        )
    }

    fn score_npc_attacks(&self, tick_a: &TickState, tick_b: &TickState) -> f64 {
        fn transform(tick: &TickState) -> Vec<Attack<'_, NpcAttack>> {
            tick.npcs()
                .filter_map(|(room_id, state)| {
                    let attack = state.attack.as_ref()?;
                    Some(Attack {
                        actor: Actor::Npc(room_id),
                        target: attack.value.target.as_ref(),
                        kind: attack.value.kind,
                        secondary_id: 0,
                    })
                })
                .collect()
        }

        score_attacks(
            (tick_a, &transform(tick_a)),
            (tick_b, &transform(tick_b)),
            normalize_npc_attack,
            AttackScores {
                positive: self.weights.npc_attack_positive_signal,
                weak_positive: self.weights.npc_attack_weak_positive_signal,
                weak_negative: self.weights.npc_attack_weak_negative_signal,
                contradictory: self.weights.npc_attack_contradictory_penalty,
                min: self.weights.npc_attack_min_score,
                max: self.weights.npc_attack_max_score,
            },
        )
    }

    fn score_prayers(&self, tick_a: &TickState, tick_b: &TickState) -> f64 {
        let mut score = 0.0;

        for (name, state_a) in tick_a.players() {
            let Some(state_b) = tick_b.player(name) else {
                continue;
            };

            let overheads_a = state_a.prayers.overheads();
            let overheads_b = state_b.prayers.overheads();
            if overheads_a.is_empty() && overheads_b.is_empty() {
                continue;
            }

            score += if overheads_a == overheads_b {
                self.weights.prayers_positive_signal
            } else {
                self.weights.prayers_negative_signal
            };
        }

        score.clamp(
            self.weights.prayers_min_score,
            self.weights.prayers_max_score,
        )
    }

    fn score_deaths(&self, tick_a: &TickState, tick_b: &TickState) -> f64 {
        let mut score = 0.0;

        for (name, _) in tick_a.players() {
            if tick_b.player(name).is_none() {
                continue;
            }

            let died = |tick: &TickState| {
                tick.events_of_type(event::Type::PlayerDeath).any(|event| {
                    event
                        .player
                        .as_ref()
                        .is_some_and(|player| player.name == name)
                })
            };
            if died(tick_a) && died(tick_b) {
                score += self.weights.player_death_positive_signal;
            }
        }

        for (room_id, _) in tick_a.npcs() {
            if tick_b.npc(room_id).is_none() {
                continue;
            }

            let died = |tick: &TickState| {
                tick.events_of_type(event::Type::NpcDeath)
                    .any(|event| event.npc.as_ref().is_some_and(|npc| npc.room_id == room_id))
            };
            if died(tick_a) && died(tick_b) {
                score += self.weights.npc_death_positive_signal;
            }
        }

        score.min(self.weights.deaths_max_score)
    }
}

/// Checks whether the actors that appear in both tick states could correspond
/// to the same tick. Returns the number of shared actors compared, or `None`
/// if the tick states are incompatible.
fn check_compatibility(tick_a: &TickState, tick_b: &TickState) -> Option<u32> {
    let players = check_player_compatibility(tick_a, tick_b)?;
    let npcs = check_npc_compatibility(tick_a, tick_b)?;
    Some(players + npcs)
}

/// Checks whether the players who appear in both tick states could correspond
/// to the same tick. Each player visible to both must be in the same position
/// and have the same visible gear equipped. Returns the number of players
/// compared, or `None` if any are incompatible.
fn check_player_compatibility(tick_a: &TickState, tick_b: &TickState) -> Option<u32> {
    let mut count = 0;

    for (name, state_a) in tick_a.players() {
        let Some(state_b) = tick_b.player(name) else {
            continue;
        };

        count += 1;

        // `died` is deliberately ignored, as it can come from various sources
        // (HP reaching 0, orb varbits, etc.) which can be affected by lag or
        // internal game client delays.

        if state_a.position != state_b.position {
            return None;
        }

        for slot in VISIBLE_EQUIPMENT_SLOTS {
            let id_a = state_a.equipment[slot as usize].map(|item| item.id);
            let id_b = state_b.equipment[slot as usize].map(|item| item.id);
            if id_a != id_b {
                return None;
            }
        }
    }

    Some(count)
}

/// Checks whether the NPCs that appear in both tick states could correspond to
/// the same tick. Each NPC visible to both must have the same NPC ID and be in
/// the same position. Returns the number of NPCs compared, or `None` if any are
/// incompatible.
fn check_npc_compatibility(tick_a: &TickState, tick_b: &TickState) -> Option<u32> {
    let mut count = 0;

    for (room_id, state_a) in tick_a.npcs() {
        let Some(state_b) = tick_b.npc(room_id) else {
            continue;
        };

        count += 1;

        if state_a.id != state_b.id || state_a.position != state_b.position {
            return None;
        }
    }

    Some(count)
}

/// Returns `true` if the plugin periodically syncs an NPC's hitpoints drift
/// via a varbit, giving all clients a shared view of them.
fn has_varbit_based_hitpoints(npc_id: u32) -> bool {
    npc::is_maiden(npc_id)
        || npc::is_bloat(npc_id)
        || npc::is_nylocas_vasilias(npc_id)
        || npc::is_sotetseg(npc_id)
        || npc::is_xarpus(npc_id)
        || npc::is_verzik(npc_id)
}

/// Normalizes current HP as a fraction of base.
fn normalize_hitpoints(hitpoints: SkillLevel) -> f64 {
    let base = hitpoints.base;
    if base == 0 {
        return 0.0;
    }

    let current = hitpoints.current.min(base);
    f64::from(current) / f64::from(base)
}

/// An attack recorded on a tick.
struct Attack<'a, K> {
    actor: Actor<'a>,
    target: Option<&'a Sourced<Target>>,
    kind: K,
    secondary_id: i32,
}

enum AttackComparison {
    Match,
    AmbiguousProjectile,
    Mismatch,
}

fn compare_attacks<K: PartialEq + Copy>(
    a: &Attack<'_, K>,
    b: &Attack<'_, K>,
    normalize: fn(K) -> K,
) -> AttackComparison {
    if a.secondary_id != b.secondary_id {
        return AttackComparison::Mismatch;
    }
    if a.kind == b.kind {
        return AttackComparison::Match;
    }
    if normalize(a.kind) == normalize(b.kind) {
        return AttackComparison::AmbiguousProjectile;
    }
    AttackComparison::Mismatch
}

/// Signals for scoring an attack.
#[derive(Clone, Copy)]
struct AttackScores {
    positive: f64,
    weak_positive: f64,
    weak_negative: f64,
    contradictory: f64,
    min: f64,
    max: f64,
}

#[allow(clippy::similar_names)]
fn score_attacks<A: PartialEq + Copy>(
    tick_a: (&TickState, &[Attack<'_, A>]),
    tick_b: (&TickState, &[Attack<'_, A>]),
    normalize: fn(A) -> A,
    scores: AttackScores,
) -> f64 {
    let (tick_a, attacks_a) = tick_a;
    let (tick_b, attacks_b) = tick_b;

    if attacks_a.is_empty() && attacks_b.is_empty() {
        return 0.0;
    }

    let has_actor = |tick: &TickState, actor: Actor| match actor {
        Actor::Npc(room_id) => tick.npc(room_id).is_some(),
        Actor::Player(name) => tick.player(name).is_some(),
    };

    // Each actor can only perform one attack per tick, so check whether the
    // same actor performed the same attack in both tick states.
    //
    // First, categorize actors' attacks by whether they are present in both
    // tick states, or only one, which will determine how the attack is scored.
    let mut attacked_in_both = Vec::new();
    let mut attacked_in_a_only = Vec::new();
    let mut attacked_in_b_only = Vec::new();

    for attack_a in attacks_a {
        match attacks_b.iter().find(|b| b.actor == attack_a.actor) {
            Some(attack_b) => attacked_in_both.push((attack_a, attack_b)),
            None => attacked_in_a_only.push(attack_a.actor),
        }
    }

    for attack_b in attacks_b {
        if !attacks_a.iter().any(|a| a.actor == attack_b.actor) {
            attacked_in_b_only.push(attack_b.actor);
        }
    }

    let mut score: f64 = 0.0;

    // For actors who attacked in both tick states, first strictly check if they
    // performed the same attack. If both have a target, it must also strictly
    // match.
    //
    // If neither has a target, add a weak positive signal for the attack type
    // matching.
    //
    // If one attack has a target but the other does not, check if the target is
    // visible in the other tick state. If it is not present, add a weak
    // positive signal for the attack matching. If it is present, apply a weak
    // penalty for omitting the target.
    //
    // For actors who attacked in only one of the tick states, check if that
    // actor is visible in the other. If they are not, ignore the event
    // altogether. Otherwise, apply a weak negative signal.
    //
    // We use weak negative signals for the latter cases instead of
    // contradictory penalties because clients do not know when attacks occur;
    // they infer attacks from actors' animations. This makes attacks inherently
    // fuzzy: if a client drops the tick in which an actor attacks, they may
    // first see the animation on the next tick, in which case the attack would
    // only exist in one of the tick states. Everything else in that tick could
    // indicate a match, so we don't want to penalize these omissions or minor
    // inconsistencies. The weak negative penalty primarily exists for
    // tiebreaking.
    for (a, b) in attacked_in_both {
        match compare_attacks(a, b, normalize) {
            AttackComparison::Match => {}
            AttackComparison::AmbiguousProjectile => {
                // Ambiguous attacks are not scored, but a contradictory target
                // is still penalized.
                if let (Some(target_a), Some(target_b)) = (a.target, b.target)
                    && Actor::from(target_a) != Actor::from(target_b)
                {
                    score += scores.contradictory;
                }
                continue;
            }
            AttackComparison::Mismatch => {
                score += scores.contradictory;
                continue;
            }
        }

        match (a.target, b.target) {
            (Some(target_a), Some(target_b)) => {
                score += if Actor::from(target_a) == Actor::from(target_b) {
                    scores.positive
                } else {
                    scores.contradictory
                };
            }
            (Some(t), None) => {
                score += if has_actor(tick_b, t.into()) {
                    scores.weak_negative
                } else {
                    scores.weak_positive
                };
            }
            (None, Some(t)) => {
                score += if has_actor(tick_a, t.into()) {
                    scores.weak_negative
                } else {
                    scores.weak_positive
                };
            }
            (None, None) => {
                score += scores.weak_positive;
            }
        }
    }

    for actor in attacked_in_a_only {
        if has_actor(tick_b, actor) {
            score += scores.weak_negative;
        }
    }

    for actor in attacked_in_b_only {
        if has_actor(tick_a, actor) {
            score += scores.weak_negative;
        }
    }

    score.clamp(scores.min, scores.max)
}

#[cfg(test)]
mod tests {
    #![expect(clippy::float_cmp, reason = "scoring constants are controlled")]

    use super::*;
    use crate::item::{self, ItemDelta};
    use crate::lifecycle::core::types::Stage;
    use crate::merging::{Tick, fixtures};
    use crate::prayer::{Prayer, PrayerBook, PrayerSet};
    use crate::proto::Event;

    const STAGE: Stage = Stage::TobMaiden;

    /// Builds the tick state a single client's events produce on `tick`.
    fn tick_state(tick: Tick, events: Vec<Event>) -> TickState {
        let party = vec!["715".to_string(), "caps lock13".to_string()];
        fixtures::timeline(&party, tick, events)
            .get(tick)
            .expect("tick has recorded state")
            .clone()
    }

    fn player_update(tick: Tick, name: &str, coords: (i32, i32), equipment: &[ItemDelta]) -> Event {
        fixtures::PlayerUpdateEvent::new(tick, STAGE, name, coords)
            .equipment_deltas(equipment)
            .build()
    }

    fn npc_spawn(
        tick: Tick,
        room_id: u64,
        npc_id: u32,
        coords: (i32, i32),
        hitpoints: u16,
    ) -> Event {
        fixtures::npc_spawn_event(fixtures::NpcEvent {
            tick,
            stage: STAGE,
            coords,
            npc_id,
            room_id,
            hitpoints: SkillLevel {
                current: hitpoints,
                base: hitpoints,
            },
            prayers: None,
            kind: None,
        })
    }

    fn player_attack(
        tick: Tick,
        name: &str,
        attack: PlayerAttack,
        weapon_id: u32,
        target: Option<u64>,
    ) -> Event {
        fixtures::player_attack_event(fixtures::PlayerAttackEvent {
            tick,
            stage: STAGE,
            coords: (0, 0),
            name,
            party_index: None,
            attack,
            weapon_id,
            distance_to_target: 1,
            target: target.map(|room_id| event::Npc {
                id: 67,
                room_id,
                ..Default::default()
            }),
        })
    }

    #[test]
    fn matching_overlapping_players_scores_baseline() {
        let weapon = [ItemDelta::Add(EquipmentSlot::Weapon, 100, 1)];
        let base = tick_state(
            Tick(5),
            vec![
                player_update(Tick(5), "715", (10, 20), &weapon),
                player_update(Tick(5), "caps lock13", (15, 30), &[]),
            ],
        );
        // "caps lock13" is missing from the target and is ignored.
        let target = tick_state(
            Tick(5),
            vec![player_update(Tick(5), "715", (10, 20), &weapon)],
        );

        let weights = ScoringWeights {
            baseline_compatibility_weight: 6.0,
            ..ScoringWeights::default()
        };
        assert_eq!(
            SimilarityScorer::with_weights(weights).score(&base, &target),
            6.0
        );
    }

    #[test]
    fn no_shared_actors_scores_zero() {
        let base = tick_state(Tick(1), vec![player_update(Tick(1), "715", (5, 5), &[])]);
        let actorless_target = tick_state(Tick(1), vec![fixtures::bloat_up_event(Tick(1))]);
        assert_eq!(SimilarityScorer::new().score(&base, &actorless_target), 0.0);

        let disjoint_target = tick_state(
            Tick(1),
            vec![player_update(Tick(1), "caps lock13", (9, 9), &[])],
        );
        assert_eq!(SimilarityScorer::new().score(&base, &disjoint_target), 0.0);
    }

    #[test]
    fn differing_player_positions_are_incompatible() {
        let base = tick_state(Tick(1), vec![player_update(Tick(1), "715", (5, 5), &[])]);
        let target = tick_state(Tick(1), vec![player_update(Tick(1), "715", (6, 5), &[])]);

        assert_eq!(
            SimilarityScorer::new().score(&base, &target),
            f64::NEG_INFINITY
        );
    }

    #[test]
    fn differing_visible_gear_is_incompatible() {
        let base = tick_state(
            Tick(2),
            vec![player_update(
                Tick(2),
                "715",
                (5, 5),
                &[ItemDelta::Add(EquipmentSlot::Head, 200, 1)],
            )],
        );
        let target = tick_state(
            Tick(2),
            vec![player_update(
                Tick(2),
                "715",
                (5, 5),
                &[ItemDelta::Add(EquipmentSlot::Head, 201, 1)],
            )],
        );

        assert_eq!(
            SimilarityScorer::new().score(&base, &target),
            f64::NEG_INFINITY
        );
    }

    #[test]
    fn matching_overlapping_npcs_scores_baseline() {
        let base = tick_state(
            Tick(3),
            vec![
                player_update(Tick(3), "715", (0, 0), &[]),
                npc_spawn(Tick(3), 1, 200, (100, 200), 500),
            ],
        );
        let target = tick_state(
            Tick(3),
            vec![
                player_update(Tick(3), "715", (0, 0), &[]),
                npc_spawn(Tick(3), 1, 200, (100, 200), 500),
            ],
        );

        let weights = ScoringWeights {
            baseline_compatibility_weight: 6.0,
            component_hitpoints_weight: 0.0,
            ..ScoringWeights::default()
        };
        assert_eq!(
            SimilarityScorer::with_weights(weights).score(&base, &target),
            6.0
        );
    }

    #[test]
    fn differing_npc_positions_are_incompatible() {
        let base = tick_state(
            Tick(4),
            vec![
                player_update(Tick(4), "715", (0, 0), &[]),
                npc_spawn(Tick(4), 10, 300, (200, 300), 600),
            ],
        );
        let target = tick_state(
            Tick(4),
            vec![
                player_update(Tick(4), "715", (0, 0), &[]),
                npc_spawn(Tick(4), 10, 300, (201, 300), 600),
            ],
        );

        assert_eq!(
            SimilarityScorer::new().score(&base, &target),
            f64::NEG_INFINITY
        );
    }

    #[test]
    fn differing_npc_ids_are_incompatible() {
        let base = tick_state(
            Tick(4),
            vec![
                player_update(Tick(4), "715", (0, 0), &[]),
                npc_spawn(Tick(4), 10, 100, (200, 300), 600),
            ],
        );
        let target = tick_state(
            Tick(4),
            vec![
                player_update(Tick(4), "715", (0, 0), &[]),
                npc_spawn(Tick(4), 10, 101, (200, 300), 600),
            ],
        );

        assert_eq!(
            SimilarityScorer::new().score(&base, &target),
            f64::NEG_INFINITY
        );
    }

    #[test]
    fn matching_npc_hitpoints_score_positively() {
        let base = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                npc_spawn(Tick(1), 1, 100, (10, 10), 500),
            ],
        );
        let target = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                npc_spawn(Tick(1), 1, 100, (10, 10), 500),
            ],
        );

        let weights = ScoringWeights {
            baseline_compatibility_weight: 0.0,
            ..ScoringWeights::default()
        };
        assert!(SimilarityScorer::with_weights(weights).score(&base, &target) > 0.0);
    }

    #[test]
    fn slightly_differing_npc_hitpoints_score_lower_than_matching() {
        let damaged_npc = fixtures::npc_spawn_event(fixtures::NpcEvent {
            tick: Tick(1),
            stage: STAGE,
            coords: (10, 10),
            npc_id: 100,
            room_id: 1,
            hitpoints: SkillLevel {
                current: 475,
                base: 500,
            },
            prayers: None,
            kind: None,
        });

        let base = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                npc_spawn(Tick(1), 1, 100, (10, 10), 500),
            ],
        );
        let target = tick_state(
            Tick(1),
            vec![player_update(Tick(1), "715", (0, 0), &[]), damaged_npc],
        );
        let matching_target = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                npc_spawn(Tick(1), 1, 100, (10, 10), 500),
            ],
        );

        let weights = ScoringWeights {
            baseline_compatibility_weight: 0.0,
            ..ScoringWeights::default()
        };
        let differing = SimilarityScorer::with_weights(weights.clone()).score(&base, &target);
        let matching = SimilarityScorer::with_weights(weights).score(&base, &matching_target);

        assert!(differing < matching);
        assert!(differing > 0.0);
    }

    #[test]
    fn large_npc_hitpoint_differences_are_ignored() {
        let half_dead_npc = fixtures::npc_spawn_event(fixtures::NpcEvent {
            tick: Tick(1),
            stage: STAGE,
            coords: (10, 10),
            npc_id: 100,
            room_id: 1,
            hitpoints: SkillLevel {
                current: 250,
                base: 500,
            },
            prayers: None,
            kind: None,
        });

        let base = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                npc_spawn(Tick(1), 1, 100, (10, 10), 500),
            ],
        );
        let target = tick_state(
            Tick(1),
            vec![player_update(Tick(1), "715", (0, 0), &[]), half_dead_npc],
        );

        let weights = ScoringWeights {
            baseline_compatibility_weight: 6.0,
            ..ScoringWeights::default()
        };
        assert_eq!(
            SimilarityScorer::with_weights(weights).score(&base, &target),
            6.0
        );
    }

    #[test]
    fn matching_player_attacks_score_positively() {
        let base = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                player_attack(
                    Tick(1),
                    "715",
                    PlayerAttack::Scythe,
                    item::id::SCYTHE_OF_VITUR.cast_unsigned(),
                    Some(5),
                ),
                npc_spawn(Tick(1), 5, 100, (10, 10), 500),
            ],
        );
        let target = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                player_attack(
                    Tick(1),
                    "715",
                    PlayerAttack::Scythe,
                    item::id::SCYTHE_OF_VITUR.cast_unsigned(),
                    Some(5),
                ),
                npc_spawn(Tick(1), 5, 100, (10, 10), 500),
            ],
        );

        let weights = ScoringWeights {
            baseline_compatibility_weight: 0.0,
            component_hitpoints_weight: 0.0,
            ..ScoringWeights::default()
        };
        assert!(SimilarityScorer::with_weights(weights).score(&base, &target) > 0.0);
    }

    #[test]
    fn differing_player_attack_weapons_are_penalized() {
        let base = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                player_attack(
                    Tick(1),
                    "715",
                    PlayerAttack::Scythe,
                    item::id::SCYTHE_OF_VITUR.cast_unsigned(),
                    Some(5),
                ),
                npc_spawn(Tick(1), 5, 100, (10, 10), 500),
            ],
        );
        let target = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                player_attack(
                    Tick(1),
                    "715",
                    PlayerAttack::Blowpipe,
                    item::id::TOXIC_BLOWPIPE.cast_unsigned(),
                    Some(5),
                ),
                npc_spawn(Tick(1), 5, 100, (10, 10), 500),
            ],
        );

        let weights = ScoringWeights {
            baseline_compatibility_weight: 0.0,
            component_hitpoints_weight: 0.0,
            ..ScoringWeights::default()
        };
        assert!(SimilarityScorer::with_weights(weights).score(&base, &target) < 0.0);
    }

    #[test]
    fn projectile_ambiguous_player_attacks_are_not_penalized() {
        let base = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                player_attack(
                    Tick(1),
                    "715",
                    PlayerAttack::ZcbAuto,
                    item::id::ZARYTE_CROSSBOW.cast_unsigned(),
                    Some(5),
                ),
                npc_spawn(Tick(1), 5, 100, (10, 10), 500),
            ],
        );
        let target = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                player_attack(
                    Tick(1),
                    "715",
                    PlayerAttack::ZcbSpec,
                    item::id::ZARYTE_CROSSBOW.cast_unsigned(),
                    Some(5),
                ),
                npc_spawn(Tick(1), 5, 100, (10, 10), 500),
            ],
        );

        let weights = ScoringWeights {
            baseline_compatibility_weight: 0.0,
            component_hitpoints_weight: 0.0,
            ..ScoringWeights::default()
        };
        assert_eq!(
            SimilarityScorer::with_weights(weights).score(&base, &target),
            0.0
        );
    }

    #[test]
    fn projectile_ambiguous_attacks_with_contradictory_targets_are_penalized() {
        let base = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                player_attack(
                    Tick(1),
                    "715",
                    PlayerAttack::Blowpipe,
                    item::id::TOXIC_BLOWPIPE.cast_unsigned(),
                    Some(5),
                ),
                npc_spawn(Tick(1), 5, 100, (10, 10), 500),
                npc_spawn(Tick(1), 6, 101, (15, 10), 500),
            ],
        );
        let target = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                player_attack(
                    Tick(1),
                    "715",
                    PlayerAttack::BlowpipeSpec,
                    item::id::TOXIC_BLOWPIPE.cast_unsigned(),
                    Some(6),
                ),
                npc_spawn(Tick(1), 5, 100, (10, 10), 500),
                npc_spawn(Tick(1), 6, 101, (15, 10), 500),
            ],
        );

        let weights = ScoringWeights {
            baseline_compatibility_weight: 0.0,
            component_hitpoints_weight: 0.0,
            ..ScoringWeights::default()
        };
        assert!(SimilarityScorer::with_weights(weights).score(&base, &target) < 0.0);
    }

    #[test]
    fn projectile_ambiguous_attacks_with_missing_targets_are_not_penalized() {
        let base = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                player_attack(
                    Tick(1),
                    "715",
                    PlayerAttack::Blowpipe,
                    item::id::TOXIC_BLOWPIPE.cast_unsigned(),
                    None,
                ),
                npc_spawn(Tick(1), 5, 100, (10, 10), 500),
            ],
        );
        let target = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                player_attack(
                    Tick(1),
                    "715",
                    PlayerAttack::BlowpipeSpec,
                    item::id::TOXIC_BLOWPIPE.cast_unsigned(),
                    Some(5),
                ),
                npc_spawn(Tick(1), 5, 100, (10, 10), 500),
            ],
        );

        let weights = ScoringWeights {
            baseline_compatibility_weight: 0.0,
            component_hitpoints_weight: 0.0,
            ..ScoringWeights::default()
        };
        assert_eq!(
            SimilarityScorer::with_weights(weights).score(&base, &target),
            0.0
        );
    }

    #[test]
    fn one_sided_player_attacks_score_weakly_negative() {
        let base = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                player_attack(
                    Tick(1),
                    "715",
                    PlayerAttack::Scythe,
                    item::id::SCYTHE_OF_VITUR.cast_unsigned(),
                    Some(5),
                ),
                npc_spawn(Tick(1), 5, 100, (10, 10), 500),
            ],
        );
        let target = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                npc_spawn(Tick(1), 5, 100, (10, 10), 500),
            ],
        );

        let weights = ScoringWeights {
            baseline_compatibility_weight: 0.0,
            component_hitpoints_weight: 0.0,
            component_attacks_weight: 1.0,
            player_attack_weak_negative_signal: -4.0,
            ..ScoringWeights::default()
        };
        assert_eq!(
            SimilarityScorer::with_weights(weights).score(&base, &target),
            -4.0
        );
    }

    #[test]
    fn matching_npc_attacks_score_positively() {
        let base = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                npc_spawn(Tick(1), 1, npc::id::MAIDEN_REGULAR, (10, 10), 3500),
                fixtures::npc_attack_event(
                    Tick(1),
                    STAGE,
                    (10, 10),
                    npc::id::MAIDEN_REGULAR,
                    1,
                    NpcAttack::TobMaidenAuto,
                    Some("715"),
                ),
            ],
        );
        let target = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                npc_spawn(Tick(1), 1, npc::id::MAIDEN_REGULAR, (10, 10), 3500),
                fixtures::npc_attack_event(
                    Tick(1),
                    STAGE,
                    (10, 10),
                    npc::id::MAIDEN_REGULAR,
                    1,
                    NpcAttack::TobMaidenAuto,
                    Some("715"),
                ),
            ],
        );

        let weights = ScoringWeights {
            baseline_compatibility_weight: 0.0,
            component_hitpoints_weight: 0.0,
            ..ScoringWeights::default()
        };
        assert!(SimilarityScorer::with_weights(weights).score(&base, &target) > 0.0);
    }

    #[test]
    fn projectile_ambiguous_npc_attacks_are_not_penalized() {
        let base = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                npc_spawn(Tick(1), 1, npc::id::SOTETSEG_REGULAR, (10, 10), 4000),
                fixtures::npc_attack_event(
                    Tick(1),
                    STAGE,
                    (10, 10),
                    npc::id::SOTETSEG_REGULAR,
                    1,
                    NpcAttack::TobSoteBall,
                    Some("715"),
                ),
            ],
        );
        let target = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                npc_spawn(Tick(1), 1, npc::id::SOTETSEG_REGULAR, (10, 10), 4000),
                fixtures::npc_attack_event(
                    Tick(1),
                    STAGE,
                    (10, 10),
                    npc::id::SOTETSEG_REGULAR,
                    1,
                    NpcAttack::TobSoteDeathBall,
                    Some("715"),
                ),
            ],
        );

        let weights = ScoringWeights {
            baseline_compatibility_weight: 0.0,
            component_hitpoints_weight: 0.0,
            ..ScoringWeights::default()
        };
        assert_eq!(
            SimilarityScorer::with_weights(weights).score(&base, &target),
            0.0
        );
    }

    #[test]
    fn differing_npc_attack_targets_are_penalized() {
        let base = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                player_update(Tick(1), "caps lock13", (5, 0), &[]),
                npc_spawn(Tick(1), 1, npc::id::MAIDEN_REGULAR, (10, 10), 3500),
                fixtures::npc_attack_event(
                    Tick(1),
                    STAGE,
                    (10, 10),
                    npc::id::MAIDEN_REGULAR,
                    1,
                    NpcAttack::TobMaidenAuto,
                    Some("715"),
                ),
            ],
        );
        let target = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                player_update(Tick(1), "caps lock13", (5, 0), &[]),
                npc_spawn(Tick(1), 1, npc::id::MAIDEN_REGULAR, (10, 10), 3500),
                fixtures::npc_attack_event(
                    Tick(1),
                    STAGE,
                    (10, 10),
                    npc::id::MAIDEN_REGULAR,
                    1,
                    NpcAttack::TobMaidenAuto,
                    Some("caps lock13"),
                ),
            ],
        );

        let weights = ScoringWeights {
            baseline_compatibility_weight: 0.0,
            component_hitpoints_weight: 0.0,
            ..ScoringWeights::default()
        };
        assert!(SimilarityScorer::with_weights(weights).score(&base, &target) < 0.0);
    }

    #[test]
    fn matching_overhead_prayers_score_positively_and_others_are_ignored() {
        let mut base_prayers = PrayerSet::empty(PrayerBook::Normal);
        base_prayers.add(Prayer::ProtectFromMagic);
        base_prayers.add(Prayer::Rigour);
        let mut target_prayers = PrayerSet::empty(PrayerBook::Normal);
        target_prayers.add(Prayer::ProtectFromMagic);
        target_prayers.add(Prayer::Piety);

        let base = tick_state(
            Tick(1),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(1), STAGE, "715", (0, 0))
                    .prayers(base_prayers)
                    .build(),
            ],
        );
        let target = tick_state(
            Tick(1),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(1), STAGE, "715", (0, 0))
                    .prayers(target_prayers)
                    .build(),
            ],
        );

        let weights = ScoringWeights {
            baseline_compatibility_weight: 0.0,
            ..ScoringWeights::default()
        };
        assert!(SimilarityScorer::with_weights(weights).score(&base, &target) > 0.0);
    }

    #[test]
    fn differing_overhead_prayers_score_negatively() {
        let mut base_prayers = PrayerSet::empty(PrayerBook::Normal);
        base_prayers.add(Prayer::ProtectFromMagic);
        let mut target_prayers = PrayerSet::empty(PrayerBook::Normal);
        target_prayers.add(Prayer::ProtectFromMissiles);

        let base = tick_state(
            Tick(1),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(1), STAGE, "715", (0, 0))
                    .prayers(base_prayers)
                    .build(),
            ],
        );
        let target = tick_state(
            Tick(1),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(1), STAGE, "715", (0, 0))
                    .prayers(target_prayers)
                    .build(),
            ],
        );

        let weights = ScoringWeights {
            baseline_compatibility_weight: 0.0,
            ..ScoringWeights::default()
        };
        assert!(SimilarityScorer::with_weights(weights).score(&base, &target) < 0.0);
    }

    #[test]
    fn empty_overheads_are_ignored() {
        let mut base_prayers = PrayerSet::empty(PrayerBook::Normal);
        base_prayers.add(Prayer::Rigour);
        let mut target_prayers = PrayerSet::empty(PrayerBook::Normal);
        target_prayers.add(Prayer::Piety);

        let base = tick_state(
            Tick(1),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(1), STAGE, "715", (0, 0))
                    .prayers(base_prayers)
                    .build(),
            ],
        );
        let target = tick_state(
            Tick(1),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(1), STAGE, "715", (0, 0))
                    .prayers(target_prayers)
                    .build(),
            ],
        );

        let weights = ScoringWeights {
            baseline_compatibility_weight: 6.0,
            ..ScoringWeights::default()
        };
        assert_eq!(
            SimilarityScorer::with_weights(weights).score(&base, &target),
            6.0
        );
    }

    #[test]
    fn matching_player_deaths_score_positively() {
        let base = tick_state(
            Tick(1),
            vec![fixtures::player_death_event(
                Tick(1),
                STAGE,
                (0, 0),
                "715",
                0,
            )],
        );
        let target = tick_state(
            Tick(1),
            vec![fixtures::player_death_event(
                Tick(1),
                STAGE,
                (0, 0),
                "715",
                0,
            )],
        );

        let weights = ScoringWeights {
            baseline_compatibility_weight: 0.0,
            ..ScoringWeights::default()
        };
        assert!(SimilarityScorer::with_weights(weights).score(&base, &target) > 0.0);
    }

    #[test]
    fn one_sided_player_deaths_are_ignored() {
        let base = tick_state(
            Tick(1),
            vec![fixtures::player_death_event(
                Tick(1),
                STAGE,
                (0, 0),
                "715",
                0,
            )],
        );
        let target = tick_state(
            Tick(1),
            vec![fixtures::PlayerUpdateEvent::new(Tick(1), STAGE, "715", (0, 0)).build()],
        );

        let weights = ScoringWeights {
            baseline_compatibility_weight: 0.0,
            ..ScoringWeights::default()
        };
        assert_eq!(
            SimilarityScorer::with_weights(weights).score(&base, &target),
            0.0
        );
    }

    #[test]
    fn matching_npc_deaths_score_positively() {
        let dead_npc = || {
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                npc_spawn(Tick(1), 1, 100, (10, 10), 0),
                fixtures::npc_death_event(fixtures::NpcEvent {
                    tick: Tick(1),
                    stage: STAGE,
                    coords: (10, 10),
                    npc_id: 100,
                    room_id: 1,
                    hitpoints: SkillLevel {
                        current: 0,
                        base: 500,
                    },
                    prayers: None,
                    kind: None,
                }),
            ]
        };
        let base = tick_state(Tick(1), dead_npc());
        let target = tick_state(Tick(1), dead_npc());

        let weights = ScoringWeights {
            baseline_compatibility_weight: 0.0,
            component_hitpoints_weight: 0.0,
            ..ScoringWeights::default()
        };
        assert!(SimilarityScorer::with_weights(weights).score(&base, &target) > 0.0);
    }

    #[test]
    fn one_sided_npc_deaths_are_ignored() {
        let base = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                npc_spawn(Tick(1), 1, 100, (10, 10), 0),
                fixtures::npc_death_event(fixtures::NpcEvent {
                    tick: Tick(1),
                    stage: STAGE,
                    coords: (10, 10),
                    npc_id: 100,
                    room_id: 1,
                    hitpoints: SkillLevel {
                        current: 0,
                        base: 500,
                    },
                    prayers: None,
                    kind: None,
                }),
            ],
        );
        let target = tick_state(
            Tick(1),
            vec![
                player_update(Tick(1), "715", (0, 0), &[]),
                npc_spawn(Tick(1), 1, 100, (10, 10), 0),
            ],
        );

        let weights = ScoringWeights {
            baseline_compatibility_weight: 0.0,
            component_hitpoints_weight: 0.0,
            ..ScoringWeights::default()
        };
        assert_eq!(
            SimilarityScorer::with_weights(weights).score(&base, &target),
            0.0
        );
    }
}

//! Consistency checks over the timeline produced by a merge step.

use std::collections::{BTreeMap, BTreeSet};

use blert::proto::event;
use blert::{Actor, EventKind, PartyIndex, PlayerAttack, RoomId, Stage, Tick, Ticks, Timeline};

use crate::lifecycle::core::types::StageExt;

use super::event::{IdentityKey, event_type, identity_key, stream_config};

/// Issues detected by the post-merge consistency checker.
/// Each issue is a violation of a game invariant that the plugin enforces on a
/// single client, meaning that it must have been introduced by the merger.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeConsistencyIssue {
    DuplicatePlayerDeath {
        player: PartyIndex,
        ticks: Vec<Tick>,
    },
    DuplicateNpcDeath {
        room_id: RoomId,
        occurrences: Vec<NpcOccurrence>,
    },
    DuplicateStreamEvent {
        kind: event::Type,
        identity_key: IdentityKey,
        ticks: Vec<Tick>,
    },
    WeaponCooldownViolation {
        player: PartyIndex,
        previous: PlayerAttackOccurrence,
        current: PlayerAttackOccurrence,
        cooldown: Ticks,
    },
    DeathBeforeSpawn {
        room_id: RoomId,
        death_tick: Tick,
        /// First observed spawn tick for this NPC, if seen.
        spawn_tick: Option<Tick>,
    },
    PhaseOutOfOrder {
        previous: PhaseOccurrence,
        current: PhaseOccurrence,
    },
    AttackTargetMissing {
        tick: Tick,
        attacker: Actor,
        target: Actor,
    },
    /// Emitted when an event type appears on a tick alongside another event type
    /// it is mutually exclusive with (e.g. `TOB_BLOAT_DOWN` and `TOB_BLOAT_UP`).
    ExclusiveEventViolation {
        exclusive_types: (event::Type, event::Type),
        tick: Tick,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NpcOccurrence {
    pub tick: Tick,
    pub npc_id: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlayerAttackOccurrence {
    pub tick: Tick,
    pub kind: PlayerAttack,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhaseOccurrence {
    pub kind: event::Type,
    pub identity_key: IdentityKey,
    pub tick: Tick,
}

/// Registry of event pairs that are mutually exclusive on a single tick.
fn exclusive_event_pairs(stage: Stage) -> &'static [(event::Type, event::Type)] {
    match stage {
        Stage::TobBloat => &[(event::Type::TobBloatDown, event::Type::TobBloatUp)],
        _ => &[],
    }
}

fn phase_ordinal(stage: Stage, kind: &EventKind) -> Option<i64> {
    let ordinal = match (stage, kind) {
        (Stage::TobXarpus, EventKind::XarpusPhase(phase)) => i64::from(i32::from(*phase)),
        (Stage::TobVerzik, EventKind::VerzikPhase(phase)) => i64::from(i32::from(*phase)),
        (Stage::TobNylocas, EventKind::NyloWaveSpawn(wave)) => i64::from(wave.wave),
        // Insert MAZE_END events after their corresponding MAZE_PROC events
        // in a linear sequence.
        (Stage::TobSotetseg, EventKind::SoteMazeProc(maze)) => *maze as i64 * 2,
        (Stage::TobSotetseg, EventKind::SoteMazeEnd(end)) => end.maze as i64 * 2 + 1,
        _ => return None,
    };
    Some(ordinal)
}

/// Runs all post-merge consistency checks against `timeline` and returns any
/// issues found.
pub(super) fn check(timeline: &Timeline) -> Result<(), Vec<MergeConsistencyIssue>> {
    let mut issues = Vec::new();

    check_actor_lifecycles(timeline, &mut issues);
    check_stream_events(timeline, &mut issues);
    check_weapon_cooldowns(timeline, &mut issues);
    check_attack_target_presence(timeline, &mut issues);
    check_exclusive_event_types(timeline, &mut issues);

    if issues.is_empty() {
        Ok(())
    } else {
        Err(issues)
    }
}

fn check_actor_lifecycles(timeline: &Timeline, issues: &mut Vec<MergeConsistencyIssue>) {
    let mut player_death_ticks: BTreeMap<PartyIndex, Vec<Tick>> = BTreeMap::new();
    let mut npc_death_occurrences: BTreeMap<RoomId, Vec<NpcOccurrence>> = BTreeMap::new();

    for (tick, event) in timeline.events() {
        match &event.kind {
            EventKind::PlayerDeath(player) => {
                player_death_ticks.entry(*player).or_default().push(tick);
            }
            EventKind::NpcDeath(death) => {
                npc_death_occurrences
                    .entry(death.npc)
                    .or_default()
                    .push(NpcOccurrence {
                        tick,
                        npc_id: death.npc_id,
                    });
            }
            _ => {}
        }
    }

    for (player, death_ticks) in player_death_ticks {
        if death_ticks.len() > 1 {
            issues.push(MergeConsistencyIssue::DuplicatePlayerDeath {
                player,
                ticks: death_ticks,
            });
        }
    }

    for (&room_id, occurrences) in &npc_death_occurrences {
        if occurrences.len() > 1 {
            issues.push(MergeConsistencyIssue::DuplicateNpcDeath {
                room_id,
                occurrences: occurrences.clone(),
            });
        }
    }

    // Every NPC death must have a preceding spawn.
    for (&room_id, deaths) in &npc_death_occurrences {
        let earliest_death = deaths[0].tick;
        let earliest_spawn = timeline.npc(room_id).map(|npc| npc.spawn);
        if earliest_spawn.is_none_or(|spawn| spawn > earliest_death) {
            issues.push(MergeConsistencyIssue::DeathBeforeSpawn {
                room_id,
                death_tick: earliest_death,
                spawn_tick: earliest_spawn,
            });
        }
    }
}

fn check_stream_events(timeline: &Timeline, issues: &mut Vec<MergeConsistencyIssue>) {
    let challenge = timeline
        .stage()
        .challenge_type()
        .expect("each stage has a challenge");

    // Every stream event without a temporal window is expected to appear at most
    // once per (type, identity). Actor lifecycle events are handled separately
    // by `check_actor_lifecycles` and excluded here to avoid double-reporting.
    let mut occurrences: BTreeMap<event::Type, BTreeMap<IdentityKey, Vec<Tick>>> = BTreeMap::new();

    // For events with ordering rules, track the latest occurrence seen.
    // Each stage has at most one ordering sequence.
    let mut previous: Option<(i64, PhaseOccurrence)> = None;

    for (tick, event) in timeline.events() {
        if matches!(
            event.kind,
            EventKind::PlayerDeath(_) | EventKind::NpcDeath(_)
        ) {
            continue;
        }
        let kind = event_type(&event.kind);
        let Some(config) = stream_config(challenge, kind) else {
            continue;
        };
        if config.temporal_window.is_some() {
            continue;
        }

        let identity_key = identity_key(&event.kind);

        occurrences
            .entry(kind)
            .or_default()
            .entry(identity_key.clone())
            .or_default()
            .push(tick);

        if let Some(ordinal) = phase_ordinal(timeline.stage(), &event.kind) {
            let current = PhaseOccurrence {
                kind,
                identity_key,
                tick,
            };
            if let Some((previous_ordinal, previous_occurrence)) = &previous
                && ordinal < *previous_ordinal
            {
                issues.push(MergeConsistencyIssue::PhaseOutOfOrder {
                    previous: previous_occurrence.clone(),
                    current: current.clone(),
                });
            }
            previous = Some((ordinal, current));
        }
    }

    for (kind, by_key) in occurrences {
        for (identity_key, ticks) in by_key {
            if ticks.len() > 1 {
                issues.push(MergeConsistencyIssue::DuplicateStreamEvent {
                    kind,
                    identity_key,
                    ticks,
                });
            }
        }
    }
}

fn check_weapon_cooldowns(timeline: &Timeline, issues: &mut Vec<MergeConsistencyIssue>) {
    // Most recent attacks by player. The plugin's `isOffCooldownOn` gate means
    // a single client's stream never contains attacks that violate cooldown in
    // its own tick space; any violation in the merged stream is therefore a
    // merger artifact.
    let mut last_attack: BTreeMap<PartyIndex, PlayerAttackOccurrence> = BTreeMap::new();

    // TODO(frolv): Move cooldown computation to blertlib.
    for (tick, event) in timeline.events() {
        let EventKind::PlayerAttack(attack) = &event.kind else {
            continue;
        };
        let current = PlayerAttackOccurrence {
            tick,
            kind: attack.attack,
        };
        if let Some(previous) = last_attack.get(&attack.player) {
            let cooldown = previous.kind.cooldown();
            if tick - previous.tick < cooldown {
                issues.push(MergeConsistencyIssue::WeaponCooldownViolation {
                    player: attack.player,
                    previous: *previous,
                    current,
                    cooldown,
                });
            }
        }
        last_attack.insert(attack.player, current);
    }
}

fn check_attack_target_presence(timeline: &Timeline, issues: &mut Vec<MergeConsistencyIssue>) {
    // If an attack has a target, that target must be present in the same tick's
    // state map. The merger combines attack and target data across multiple
    // clients, so a merge bug could drop the target's state while keeping the
    // attack's reference to it.
    //
    // The exception to this is players who have died; some boss NPC attacks
    // have long wind-up times and can target a player who has recently died.
    let mut dead_players: BTreeSet<PartyIndex> = BTreeSet::new();

    for tick in Tick(0).through(timeline.last_tick()) {
        let Some(state) = timeline.get_state(tick) else {
            continue;
        };

        for event in &state.events {
            match &event.kind {
                EventKind::PlayerAttack(attack) => {
                    let Some(target) = attack.target else {
                        continue;
                    };
                    if !state.has_actor(target) {
                        issues.push(MergeConsistencyIssue::AttackTargetMissing {
                            tick,
                            attacker: Actor::Player(attack.player),
                            target,
                        });
                    }
                }
                EventKind::NpcAttack(attack) => {
                    let Some(target) = attack.target else {
                        continue;
                    };
                    // Ignore NPC attacks on dead players.
                    // TODO(frolv): This would ideally be smarter, but that
                    // requires investigating what exact patterns attacks on
                    // dead players take. Duplicate player deaths might also
                    // throw this off, but those are a hard rejection anyway
                    // so it doesn't affect the outcome.
                    let ignored =
                        matches!(target, Actor::Player(player) if dead_players.contains(&player));
                    if !ignored && !state.has_actor(target) {
                        issues.push(MergeConsistencyIssue::AttackTargetMissing {
                            tick,
                            attacker: Actor::Npc(attack.npc),
                            target,
                        });
                    }
                }
                _ => {}
            }
        }

        for event in &state.events {
            if let EventKind::PlayerDeath(player) = event.kind {
                dead_players.insert(player);
            }
        }
    }
}

fn check_exclusive_event_types(timeline: &Timeline, issues: &mut Vec<MergeConsistencyIssue>) {
    let pairs = exclusive_event_pairs(timeline.stage());
    if pairs.is_empty() {
        return;
    }

    for tick in Tick(0).through(timeline.last_tick()) {
        let events = timeline.events_for_tick(tick);

        for &(a, b) in pairs {
            let has_a = events.iter().any(|event| event_type(&event.kind) == a);
            let has_b = events.iter().any(|event| event_type(&event.kind) == b);
            if has_a && has_b {
                issues.push(MergeConsistencyIssue::ExclusiveEventViolation {
                    exclusive_types: (a, b),
                    tick,
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use blert::proto::Event;
    use blert::{ChallengeMode, Rsn, item};

    use super::*;
    use crate::merging::fixtures::{self, NpcEvent};

    static PARTY: std::sync::LazyLock<Vec<Rsn>> = std::sync::LazyLock::new(|| {
        vec![
            Rsn::try_from("1Ogp").unwrap(),
            Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
        ]
    });

    fn npc_spawn(tick: Tick, room_id: u64, npc_id: u32) -> Event {
        fixtures::npc_spawn_event(NpcEvent {
            tick,
            stage: Stage::TobMaiden,
            npc_id,
            room_id,
            ..Default::default()
        })
    }

    fn npc_death(tick: Tick, room_id: u64, npc_id: u32) -> Event {
        fixtures::npc_death_event(NpcEvent {
            tick,
            stage: Stage::TobMaiden,
            npc_id,
            room_id,
            ..Default::default()
        })
    }

    #[test]
    fn lifecycle_permits_a_well_formed_timeline() {
        let timeline = fixtures::timeline(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            &PARTY,
            Tick(9),
            vec![
                npc_spawn(Tick(0), 1001, 8360),
                fixtures::player_death_event(Tick(5), Stage::TobMaiden, (0, 0), "1Ogp", 0),
                npc_death(Tick(8), 1001, 8360),
            ],
        );
        assert_eq!(check(&timeline), Ok(()));
    }

    #[test]
    fn lifecycle_flags_a_player_dying_twice() {
        let timeline = fixtures::timeline(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            &PARTY,
            Tick(9),
            vec![
                fixtures::player_death_event(Tick(3), Stage::TobMaiden, (0, 0), "1Ogp", 0),
                fixtures::player_death_event(Tick(7), Stage::TobMaiden, (0, 0), "1Ogp", 0),
            ],
        );
        assert_eq!(
            check(&timeline),
            Err(vec![MergeConsistencyIssue::DuplicatePlayerDeath {
                player: timeline.party_index(&PARTY[0]).unwrap(),
                ticks: vec![Tick(3), Tick(7)],
            }]),
        );
    }

    #[test]
    fn lifecycle_flags_a_player_dying_twice_on_one_tick() {
        let timeline = fixtures::timeline(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            &PARTY,
            Tick(4),
            vec![
                fixtures::player_death_event(Tick(2), Stage::TobMaiden, (0, 0), "1Ogp", 0),
                fixtures::player_death_event(Tick(2), Stage::TobMaiden, (0, 0), "1Ogp", 0),
            ],
        );
        assert_eq!(
            check(&timeline),
            Err(vec![MergeConsistencyIssue::DuplicatePlayerDeath {
                player: timeline.party_index(&PARTY[0]).unwrap(),
                ticks: vec![Tick(2), Tick(2)],
            }]),
        );
    }

    #[test]
    fn lifecycle_flags_a_room_id_dying_twice() {
        let timeline = fixtures::timeline(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            &PARTY,
            Tick(9),
            vec![
                npc_spawn(Tick(0), 1001, 8360),
                npc_death(Tick(5), 1001, 8360),
                npc_death(Tick(8), 1001, 8360),
            ],
        );
        assert_eq!(
            check(&timeline),
            Err(vec![MergeConsistencyIssue::DuplicateNpcDeath {
                room_id: RoomId(1001),
                occurrences: vec![
                    NpcOccurrence {
                        tick: Tick(5),
                        npc_id: Some(8360),
                    },
                    NpcOccurrence {
                        tick: Tick(8),
                        npc_id: Some(8360),
                    },
                ],
            }]),
        );
    }

    #[test]
    fn lifecycle_flags_a_death_without_a_spawn() {
        let timeline = fixtures::timeline(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            &PARTY,
            Tick(9),
            vec![npc_death(Tick(4), 1001, 8360)],
        );
        assert_eq!(
            check(&timeline),
            Err(vec![MergeConsistencyIssue::DeathBeforeSpawn {
                room_id: RoomId(1001),
                death_tick: Tick(4),
                spawn_tick: None,
            }]),
        );
    }

    #[test]
    fn lifecycle_flags_a_death_before_a_spawn() {
        let timeline = fixtures::timeline(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            &PARTY,
            Tick(9),
            vec![
                npc_death(Tick(3), 1001, 8360),
                npc_spawn(Tick(6), 1001, 8360),
            ],
        );
        assert_eq!(
            check(&timeline),
            Err(vec![MergeConsistencyIssue::DeathBeforeSpawn {
                room_id: RoomId(1001),
                death_tick: Tick(3),
                spawn_tick: Some(Tick(6)),
            }]),
        );
    }

    #[test]
    fn lifecycle_permits_a_death_on_its_spawn_tick() {
        let timeline = fixtures::timeline(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            &PARTY,
            Tick(9),
            vec![
                npc_spawn(Tick(3), 1001, 8360),
                npc_death(Tick(3), 1001, 8360),
            ],
        );
        assert_eq!(check(&timeline), Ok(()));
    }

    #[test]
    fn cooldown_permits_an_attack_off_cooldown() {
        let timeline = fixtures::timeline(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            &PARTY,
            Tick(14),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobMaiden, "1Ogp", (0, 0)).build(),
                fixtures::player_attack_event(fixtures::PlayerAttackEvent {
                    tick: Tick(0),
                    stage: Stage::TobMaiden,
                    coords: (0, 0),
                    name: "1Ogp",
                    party_index: None,
                    attack: PlayerAttack::Scythe,
                    weapon_id: item::id::SCYTHE_OF_VITUR,
                    distance_to_target: 1,
                    target: None,
                }),
                fixtures::PlayerUpdateEvent::new(Tick(5), Stage::TobMaiden, "1Ogp", (0, 0)).build(),
                fixtures::player_attack_event(fixtures::PlayerAttackEvent {
                    tick: Tick(5),
                    stage: Stage::TobMaiden,
                    coords: (0, 0),
                    name: "1Ogp",
                    party_index: None,
                    attack: PlayerAttack::BgsSpec,
                    weapon_id: item::id::BANDOS_GODSWORD,
                    distance_to_target: 1,
                    target: None,
                }),
            ],
        );
        assert_eq!(check(&timeline), Ok(()));
    }

    #[test]
    fn cooldown_flags_an_attack_while_on_cooldown() {
        let timeline = fixtures::timeline(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            &PARTY,
            Tick(9),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobMaiden, "1Ogp", (0, 0)).build(),
                fixtures::player_attack_event(fixtures::PlayerAttackEvent {
                    tick: Tick(0),
                    stage: Stage::TobMaiden,
                    coords: (0, 0),
                    name: "1Ogp",
                    party_index: None,
                    attack: PlayerAttack::BgsSpec,
                    weapon_id: item::id::BANDOS_GODSWORD,
                    distance_to_target: 1,
                    target: None,
                }),
                fixtures::PlayerUpdateEvent::new(Tick(3), Stage::TobMaiden, "1Ogp", (0, 0)).build(),
                fixtures::player_attack_event(fixtures::PlayerAttackEvent {
                    tick: Tick(3),
                    stage: Stage::TobMaiden,
                    coords: (0, 0),
                    name: "1Ogp",
                    party_index: None,
                    attack: PlayerAttack::Scythe,
                    weapon_id: item::id::SCYTHE_OF_VITUR,
                    distance_to_target: 1,
                    target: None,
                }),
            ],
        );
        assert_eq!(
            check(&timeline),
            Err(vec![MergeConsistencyIssue::WeaponCooldownViolation {
                player: timeline.party_index(&PARTY[0]).unwrap(),
                previous: PlayerAttackOccurrence {
                    tick: Tick(0),
                    kind: PlayerAttack::BgsSpec,
                },
                current: PlayerAttackOccurrence {
                    tick: Tick(3),
                    kind: PlayerAttack::Scythe,
                },
                cooldown: Ticks(6),
            }]),
        );
    }

    #[test]
    fn cooldown_ignores_ticks_without_an_attack() {
        let timeline = fixtures::timeline(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            &PARTY,
            Tick(9),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobMaiden, "1Ogp", (0, 0)).build(),
                fixtures::player_attack_event(fixtures::PlayerAttackEvent {
                    tick: Tick(0),
                    stage: Stage::TobMaiden,
                    coords: (0, 0),
                    name: "1Ogp",
                    party_index: None,
                    attack: PlayerAttack::BgsSpec,
                    weapon_id: item::id::BANDOS_GODSWORD,
                    distance_to_target: 1,
                    target: None,
                }),
                fixtures::PlayerUpdateEvent::new(Tick(3), Stage::TobMaiden, "1Ogp", (0, 0)).build(),
                fixtures::PlayerUpdateEvent::new(Tick(6), Stage::TobMaiden, "1Ogp", (0, 0)).build(),
                fixtures::player_attack_event(fixtures::PlayerAttackEvent {
                    tick: Tick(6),
                    stage: Stage::TobMaiden,
                    coords: (0, 0),
                    name: "1Ogp",
                    party_index: None,
                    attack: PlayerAttack::BgsSpec,
                    weapon_id: item::id::BANDOS_GODSWORD,
                    distance_to_target: 1,
                    target: None,
                }),
            ],
        );
        assert_eq!(check(&timeline), Ok(()));
    }

    #[test]
    fn stream_flags_a_unique_event_recurring() {
        let timeline = fixtures::timeline(
            Stage::TobVerzik,
            ChallengeMode::TobRegular,
            &PARTY,
            Tick(9),
            vec![
                fixtures::verzik_phase_event(Tick(2), event::VerzikPhase::VerzikP1),
                fixtures::verzik_phase_event(Tick(5), event::VerzikPhase::VerzikP1),
            ],
        );
        assert_eq!(
            check(&timeline),
            Err(vec![MergeConsistencyIssue::DuplicateStreamEvent {
                kind: event::Type::TobVerzikPhase,
                identity_key: IdentityKey::Number(1),
                ticks: vec![Tick(2), Tick(5)],
            }]),
        );
    }

    #[test]
    fn stream_flags_a_phase_out_of_order() {
        let timeline = fixtures::timeline(
            Stage::TobVerzik,
            ChallengeMode::TobRegular,
            &PARTY,
            Tick(14),
            vec![
                fixtures::verzik_phase_event(Tick(2), event::VerzikPhase::VerzikP1),
                fixtures::verzik_phase_event(Tick(5), event::VerzikPhase::VerzikP3),
                fixtures::verzik_phase_event(Tick(10), event::VerzikPhase::VerzikP2),
            ],
        );
        assert_eq!(
            check(&timeline),
            Err(vec![MergeConsistencyIssue::PhaseOutOfOrder {
                previous: PhaseOccurrence {
                    kind: event::Type::TobVerzikPhase,
                    identity_key: IdentityKey::Number(3),
                    tick: Tick(5),
                },
                current: PhaseOccurrence {
                    kind: event::Type::TobVerzikPhase,
                    identity_key: IdentityKey::Number(2),
                    tick: Tick(10),
                },
            }]),
        );
    }

    #[test]
    fn stream_flags_a_maze_proc_before_the_previous_maze_end() {
        let timeline = fixtures::timeline(
            Stage::TobSotetseg,
            ChallengeMode::TobRegular,
            &PARTY,
            Tick(14),
            vec![
                fixtures::sote_maze_proc_event(Tick(2), event::sote_maze::Maze::Maze66),
                fixtures::sote_maze_proc_event(Tick(8), event::sote_maze::Maze::Maze33),
                fixtures::sote_maze_end_event(Tick(10), event::sote_maze::Maze::Maze66, None),
            ],
        );
        assert_eq!(
            check(&timeline),
            Err(vec![MergeConsistencyIssue::PhaseOutOfOrder {
                previous: PhaseOccurrence {
                    kind: event::Type::TobSoteMazeProc,
                    identity_key: IdentityKey::Number(1),
                    tick: Tick(8),
                },
                current: PhaseOccurrence {
                    kind: event::Type::TobSoteMazeEnd,
                    identity_key: IdentityKey::Number(0),
                    tick: Tick(10),
                },
            }]),
        );
    }

    #[test]
    fn stream_permits_a_windowed_event_recurring() {
        let timeline = fixtures::timeline(
            Stage::TobBloat,
            ChallengeMode::TobRegular,
            &PARTY,
            Tick(139),
            vec![
                fixtures::bloat_down_event(Tick(41), (3299, 4440), 1, Ticks(41)),
                fixtures::bloat_up_event(Tick(73)),
                fixtures::bloat_down_event(Tick(107), (3291, 4451), 2, Ticks(34)),
                fixtures::bloat_up_event(Tick(139)),
            ],
        );
        assert_eq!(check(&timeline), Ok(()));
    }

    #[test]
    fn target_flags_a_player_attack_on_an_absent_npc() {
        let timeline = fixtures::timeline(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            &PARTY,
            Tick(0),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobMaiden, "1Ogp", (0, 0)).build(),
                fixtures::player_attack_event(fixtures::PlayerAttackEvent {
                    tick: Tick(0),
                    stage: Stage::TobMaiden,
                    coords: (0, 0),
                    name: "1Ogp",
                    party_index: None,
                    attack: PlayerAttack::Scythe,
                    weapon_id: item::id::SCYTHE_OF_VITUR,
                    distance_to_target: 1,
                    target: Some(event::Npc {
                        id: 8360,
                        room_id: 1001,
                        ..Default::default()
                    }),
                }),
            ],
        );
        assert_eq!(
            check(&timeline),
            Err(vec![MergeConsistencyIssue::AttackTargetMissing {
                tick: Tick(0),
                attacker: Actor::Player(timeline.party_index(&PARTY[0]).unwrap()),
                target: Actor::Npc(RoomId(1001)),
            }]),
        );
    }

    #[test]
    fn target_flags_an_npc_attack_on_an_absent_player() {
        let timeline = fixtures::timeline(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            &PARTY,
            Tick(0),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobMaiden, "1Ogp", (0, 0)).build(),
                fixtures::npc_update_event(NpcEvent {
                    tick: Tick(0),
                    stage: Stage::TobMaiden,
                    npc_id: 8360,
                    room_id: 1001,
                    ..Default::default()
                }),
                fixtures::npc_attack_event(
                    Tick(0),
                    Stage::TobMaiden,
                    (0, 0),
                    8360,
                    1001,
                    blert::NpcAttack::TobMaidenAuto,
                    Some("WWWWWWWWWWQQ"),
                ),
            ],
        );
        assert_eq!(
            check(&timeline),
            Err(vec![MergeConsistencyIssue::AttackTargetMissing {
                tick: Tick(0),
                attacker: Actor::Npc(RoomId(1001)),
                target: Actor::Player(timeline.party_index(&PARTY[1]).unwrap()),
            }]),
        );
    }

    #[test]
    fn target_permits_an_npc_attack_on_a_dead_player() {
        let timeline = fixtures::timeline(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            &PARTY,
            Tick(1),
            vec![
                fixtures::player_death_event(Tick(0), Stage::TobMaiden, (0, 0), "1Ogp", 0),
                fixtures::npc_update_event(NpcEvent {
                    tick: Tick(0),
                    stage: Stage::TobMaiden,
                    npc_id: 8360,
                    room_id: 1001,
                    ..Default::default()
                }),
                fixtures::npc_update_event(NpcEvent {
                    tick: Tick(1),
                    stage: Stage::TobMaiden,
                    npc_id: 8360,
                    room_id: 1001,
                    ..Default::default()
                }),
                fixtures::npc_attack_event(
                    Tick(1),
                    Stage::TobMaiden,
                    (0, 0),
                    8360,
                    1001,
                    blert::NpcAttack::TobMaidenAuto,
                    Some("1Ogp"),
                ),
            ],
        );
        assert_eq!(check(&timeline), Ok(()));
    }

    #[test]
    fn exclusive_flags_bloat_down_and_up_on_one_tick() {
        let timeline = fixtures::timeline(
            Stage::TobBloat,
            ChallengeMode::TobRegular,
            &PARTY,
            Tick(4),
            vec![
                fixtures::bloat_down_event(Tick(2), (3299, 4440), 1, Ticks(2)),
                fixtures::bloat_up_event(Tick(2)),
            ],
        );
        assert_eq!(
            check(&timeline),
            Err(vec![MergeConsistencyIssue::ExclusiveEventViolation {
                exclusive_types: (event::Type::TobBloatDown, event::Type::TobBloatUp),
                tick: Tick(2),
            }]),
        );
    }
}

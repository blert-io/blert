//! Consistency checks over the timeline produced by a merge step.

use std::collections::{BTreeMap, BTreeSet};

use crate::proto::{Event, PlayerAttack, Stage, event};

use super::event::{identity_key, stream_config};
use super::timeline::{Actor, Target, TickState, Timeline};
use super::{MergeContext, Tick, Ticks};

/// Issues detected by the post-merge consistency checker.
/// Each issue is a violation of a game invariant that the plugin enforces on a
/// single client, meaning that it must have been introduced by the merger.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeConsistencyIssue<'a> {
    DuplicatePlayerDeath {
        player: &'a str,
        ticks: Vec<Tick>,
    },
    DuplicateNpcSpawn {
        room_id: u64,
        occurrences: Vec<NpcOccurrence>,
    },
    DuplicateNpcDeath {
        room_id: u64,
        occurrences: Vec<NpcOccurrence>,
    },
    DuplicateStreamEvent {
        kind: event::Type,
        identity_key: String,
        ticks: Vec<Tick>,
    },
    WeaponCooldownViolation {
        player: &'a str,
        previous: PlayerAttackOccurrence,
        current: PlayerAttackOccurrence,
        cooldown: Ticks,
    },
    DeathBeforeSpawn {
        room_id: u64,
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
        attacker: Actor<'a>,
        target: Actor<'a>,
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
    pub npc_id: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlayerAttackOccurrence {
    pub tick: Tick,
    pub kind: PlayerAttack,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhaseOccurrence {
    pub kind: event::Type,
    pub identity_key: String,
    pub tick: Tick,
}

/// Defines an ordering invariant over a set of stream event types.
struct OrderingRule {
    event_types: &'static [event::Type],
    extract_ordinal: fn(&Event, event::Type) -> i64,
}

/// Registry of event pairs that are mutually exclusive on a single tick.
fn exclusive_event_pairs(stage: Stage) -> &'static [(event::Type, event::Type)] {
    match stage {
        Stage::TobBloat => &[(event::Type::TobBloatDown, event::Type::TobBloatUp)],
        _ => &[],
    }
}

/// Rules for validating the order of sequential events within a stage.
fn ordering_rules(stage: Stage) -> &'static [OrderingRule] {
    match stage {
        Stage::TobXarpus => &[OrderingRule {
            event_types: &[event::Type::TobXarpusPhase],
            extract_ordinal: |e, _| i64::from(e.xarpus_phase.expect("validated at build")),
        }],
        Stage::TobVerzik => &[OrderingRule {
            event_types: &[event::Type::TobVerzikPhase],
            extract_ordinal: |e, _| i64::from(e.verzik_phase.expect("validated at build")),
        }],
        Stage::TobNylocas => &[OrderingRule {
            event_types: &[event::Type::TobNyloWaveSpawn],
            extract_ordinal: |e, _| {
                i64::from(e.nylo_wave.as_ref().expect("validated at build").wave)
            },
        }],
        Stage::TobSotetseg => &[OrderingRule {
            event_types: &[event::Type::TobSoteMazeProc, event::Type::TobSoteMazeEnd],
            // Insert MAZE_END events after their corresponding MAZE_PROC events
            // in a linear sequence.
            extract_ordinal: |e, t| {
                i64::from(e.sote_maze.as_ref().expect("validated at build").maze) * 2
                    + i64::from(t == event::Type::TobSoteMazeEnd)
            },
        }],
        _ => &[],
    }
}

/// Runs all post-merge consistency checks against `timeline` and returns any
/// issues found.
pub(super) fn check<'a>(
    ctx: &MergeContext<'a>,
    timeline: &Timeline<'a>,
) -> Result<(), Vec<MergeConsistencyIssue<'a>>> {
    let mut issues = Vec::new();

    check_actor_lifecycles(ctx, timeline, &mut issues);
    check_stream_events(ctx, timeline, &mut issues);
    check_weapon_cooldowns(timeline, &mut issues);
    check_attack_target_presence(timeline, &mut issues);
    check_exclusive_event_types(ctx.stage, timeline, &mut issues);

    if issues.is_empty() {
        Ok(())
    } else {
        Err(issues)
    }
}

fn check_actor_lifecycles<'a>(
    ctx: &MergeContext<'a>,
    timeline: &Timeline<'a>,
    issues: &mut Vec<MergeConsistencyIssue<'a>>,
) {
    let mut player_death_ticks: BTreeMap<&'a str, Vec<Tick>> = BTreeMap::new();
    let mut npc_spawn_occurrences: BTreeMap<u64, Vec<NpcOccurrence>> = BTreeMap::new();
    let mut npc_death_occurrences: BTreeMap<u64, Vec<NpcOccurrence>> = BTreeMap::new();

    for state in timeline.tick_states().iter().flatten() {
        let tick = state.tick();

        for event in state.events_of_type(event::Type::PlayerDeath) {
            let name = &event.player.as_ref().expect("validated at build").name;
            player_death_ticks
                .entry(ctx.player(name))
                .or_default()
                .push(tick);
        }

        for event in state.events_of_type(event::Type::NpcSpawn) {
            let npc = event.npc.as_ref().expect("validated at build");
            npc_spawn_occurrences
                .entry(npc.room_id)
                .or_default()
                .push(NpcOccurrence {
                    tick,
                    npc_id: npc.id,
                });
        }

        for event in state.events_of_type(event::Type::NpcDeath) {
            let npc = event.npc.as_ref().expect("validated at build");
            npc_death_occurrences
                .entry(npc.room_id)
                .or_default()
                .push(NpcOccurrence {
                    tick,
                    npc_id: npc.id,
                });
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

    for (&room_id, occurrences) in &npc_spawn_occurrences {
        if occurrences.len() > 1 {
            issues.push(MergeConsistencyIssue::DuplicateNpcSpawn {
                room_id,
                occurrences: occurrences.clone(),
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
        let earliest_spawn = npc_spawn_occurrences
            .get(&room_id)
            .map(|spawns| spawns[0].tick);
        if earliest_spawn.is_none_or(|spawn| spawn >= earliest_death) {
            issues.push(MergeConsistencyIssue::DeathBeforeSpawn {
                room_id,
                death_tick: earliest_death,
                spawn_tick: earliest_spawn,
            });
        }
    }
}

fn check_stream_events(
    ctx: &MergeContext<'_>,
    timeline: &Timeline<'_>,
    issues: &mut Vec<MergeConsistencyIssue<'_>>,
) {
    // Every stream event is without a temporal window expected to appear at most
    // once per (type, identity). Actor lifecycle events are handled separately
    // by `check_actor_lifecycles` and excluded here to avoid double-reporting.
    const EXCLUDED: [event::Type; 3] = [
        event::Type::PlayerDeath,
        event::Type::NpcSpawn,
        event::Type::NpcDeath,
    ];
    let mut occurrences: BTreeMap<event::Type, BTreeMap<String, Vec<Tick>>> = BTreeMap::new();

    // For events with ordering rules, track the latest occurrence seen.
    let stage_rules = ordering_rules(ctx.stage);
    let mut previous_by_rule: Vec<Option<(i64, PhaseOccurrence)>> = vec![None; stage_rules.len()];

    for state in timeline.tick_states().iter().flatten() {
        let tick = state.tick();

        for event in state.events() {
            let kind = event.r#type();
            if EXCLUDED.contains(&kind) {
                continue;
            }
            let Some(config) = stream_config(ctx.challenge.challenge_type, kind) else {
                continue;
            };
            if config.temporal_window.is_some() {
                continue;
            }

            let identity_key = identity_key(event).to_string();

            occurrences
                .entry(kind)
                .or_default()
                .entry(identity_key.clone())
                .or_default()
                .push(tick);

            for (rule, previous) in stage_rules.iter().zip(&mut previous_by_rule) {
                if !rule.event_types.contains(&kind) {
                    continue;
                }
                let ordinal = (rule.extract_ordinal)(event, kind);
                let current = PhaseOccurrence {
                    kind,
                    identity_key: identity_key.clone(),
                    tick,
                };
                if let Some((previous_ordinal, previous_occurrence)) = previous
                    && ordinal < *previous_ordinal
                {
                    issues.push(MergeConsistencyIssue::PhaseOutOfOrder {
                        previous: previous_occurrence.clone(),
                        current: current.clone(),
                    });
                }
                *previous = Some((ordinal, current));
            }
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

fn check_weapon_cooldowns<'a>(
    timeline: &Timeline<'a>,
    issues: &mut Vec<MergeConsistencyIssue<'a>>,
) {
    // Most recent attacks by player. The plugin's `isOffCooldownOn` gate means
    // a single client's stream never contains attacks that violate cooldown in
    // its own tick space; any violation in the merged stream is therefore a
    // merger artifact.
    let mut last_attack: BTreeMap<&'a str, PlayerAttackOccurrence> = BTreeMap::new();

    for state in timeline.tick_states().iter().flatten() {
        let tick = state.tick();

        for (name, player) in state.players() {
            let Some(attack) = &player.attack else {
                continue;
            };
            let current = PlayerAttackOccurrence {
                tick,
                kind: attack.value.kind,
            };
            if let Some(previous) = last_attack.get(name) {
                let cooldown = previous.kind.cooldown();
                if tick - previous.tick < cooldown {
                    issues.push(MergeConsistencyIssue::WeaponCooldownViolation {
                        player: name,
                        previous: *previous,
                        current,
                        cooldown,
                    });
                }
            }
            last_attack.insert(name, current);
        }
    }
}

fn check_target(
    state: &TickState<'_>,
    target: &Target<'_>,
    ignore: impl Fn(Actor<'_>) -> bool,
) -> bool {
    if ignore(target.into()) {
        return true;
    }
    match target {
        Target::Npc { room_id, .. } => state.npc(*room_id).is_some(),
        Target::Player(name) => state.player(name).is_some(),
    }
}

fn check_attack_target_presence<'a>(
    timeline: &Timeline<'a>,
    issues: &mut Vec<MergeConsistencyIssue<'a>>,
) {
    // When an attack carries a non-null target, that target must be present in
    // the same tick's state map. The merger combines attack and target data
    // across multiple clients, so a merge bug could drop the target's state
    // while keeping the attack's reference to it.
    //
    // The exception to this is players who have died; some boss NPC attack
    // have long wind-up times and can target a player who has recently died.
    let mut dead_players: BTreeSet<&str> = BTreeSet::new();

    for state in timeline.tick_states().iter().flatten() {
        let tick = state.tick();

        for (name, player) in state.players() {
            let Some(target) = player
                .attack
                .as_ref()
                .and_then(|attack| attack.value.target.as_ref())
            else {
                continue;
            };
            if !check_target(state, &target.value, |_| false) {
                issues.push(MergeConsistencyIssue::AttackTargetMissing {
                    tick,
                    attacker: Actor::Player(name),
                    target: Actor::from(&target.value),
                });
            }
        }

        for (room_id, npc) in state.npcs() {
            let Some(target) = npc
                .attack
                .as_ref()
                .and_then(|attack| attack.value.target.as_ref())
            else {
                continue;
            };
            let ok = check_target(state, &target.value, |actor| {
                if let Actor::Player(name) = actor {
                    // Ignore NPC attacks on dead players.
                    // TODO(frolv): This would ideally be smarter, but that
                    // requires investigating what exact patterns attacks on
                    // dead players take. Duplicate player deaths might also
                    // throw this off, but those are a hard rejection anyway
                    // so it doesn't affect the outcome.
                    dead_players.contains(name)
                } else {
                    false
                }
            });
            if !ok {
                issues.push(MergeConsistencyIssue::AttackTargetMissing {
                    tick,
                    attacker: Actor::Npc(room_id),
                    target: Actor::from(&target.value),
                });
            }
        }

        for event in state.events_of_type(event::Type::PlayerDeath) {
            dead_players.insert(&event.player.as_ref().expect("validated at build").name);
        }
    }
}

fn check_exclusive_event_types(
    stage: Stage,
    timeline: &Timeline<'_>,
    issues: &mut Vec<MergeConsistencyIssue<'_>>,
) {
    let pairs = exclusive_event_pairs(stage);
    if pairs.is_empty() {
        return;
    }

    for state in timeline.tick_states().iter().flatten() {
        let tick = state.tick();

        for &(a, b) in pairs {
            let has_a = state.events_of_type(a).next().is_some();
            let has_b = state.events_of_type(b).next().is_some();
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
    use super::*;
    use crate::item;
    use crate::lifecycle::core::types::ChallengeMode;
    use crate::merging::ChallengeInfo;
    use crate::merging::fixtures::{self, NpcEvent};

    static PARTY: std::sync::LazyLock<Vec<String>> =
        std::sync::LazyLock::new(|| vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()]);

    fn check_events<'a>(
        challenge: &'a ChallengeInfo<'a>,
        stage: Stage,
        last_tick: Tick,
        events: Vec<Event>,
    ) -> Result<(), Vec<MergeConsistencyIssue<'a>>> {
        let ctx = fixtures::merge_context(challenge, stage)
            .recording(true, last_tick, events)
            .build();
        check(&ctx, &ctx.client(0).timeline)
    }

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
        let challenge =
            fixtures::challenge_info(Stage::TobMaiden, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobMaiden,
            Tick(9),
            vec![
                npc_spawn(Tick(0), 1001, 8360),
                fixtures::player_death_event(Tick(5), Stage::TobMaiden, (0, 0), "1Ogp", 0),
                npc_death(Tick(8), 1001, 8360),
            ],
        );
        assert_eq!(result, Ok(()));
    }

    #[test]
    fn lifecycle_flags_a_player_dying_twice() {
        let challenge =
            fixtures::challenge_info(Stage::TobMaiden, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobMaiden,
            Tick(9),
            vec![
                fixtures::player_death_event(Tick(3), Stage::TobMaiden, (0, 0), "1Ogp", 0),
                fixtures::player_death_event(Tick(7), Stage::TobMaiden, (0, 0), "1Ogp", 0),
            ],
        );
        assert_eq!(
            result,
            Err(vec![MergeConsistencyIssue::DuplicatePlayerDeath {
                player: "1Ogp",
                ticks: vec![Tick(3), Tick(7)],
            }]),
        );
    }

    #[test]
    fn lifecycle_flags_a_player_dying_twice_on_one_tick() {
        let challenge =
            fixtures::challenge_info(Stage::TobMaiden, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobMaiden,
            Tick(4),
            vec![
                fixtures::player_death_event(Tick(2), Stage::TobMaiden, (0, 0), "1Ogp", 0),
                fixtures::player_death_event(Tick(2), Stage::TobMaiden, (0, 0), "1Ogp", 0),
            ],
        );
        assert_eq!(
            result,
            Err(vec![MergeConsistencyIssue::DuplicatePlayerDeath {
                player: "1Ogp",
                ticks: vec![Tick(2), Tick(2)],
            }]),
        );
    }

    #[test]
    fn lifecycle_flags_a_room_id_spawning_twice() {
        let challenge =
            fixtures::challenge_info(Stage::TobMaiden, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobMaiden,
            Tick(9),
            vec![
                npc_spawn(Tick(0), 1001, 8360),
                npc_spawn(Tick(4), 1001, 8360),
            ],
        );
        assert_eq!(
            result,
            Err(vec![MergeConsistencyIssue::DuplicateNpcSpawn {
                room_id: 1001,
                occurrences: vec![
                    NpcOccurrence {
                        tick: Tick(0),
                        npc_id: 8360,
                    },
                    NpcOccurrence {
                        tick: Tick(4),
                        npc_id: 8360,
                    },
                ],
            }]),
        );
    }

    #[test]
    fn lifecycle_records_the_npc_id_of_each_duplicate_spawn() {
        let challenge =
            fixtures::challenge_info(Stage::TobMaiden, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobMaiden,
            Tick(9),
            vec![npc_spawn(Tick(0), 1001, 100), npc_spawn(Tick(4), 1001, 200)],
        );
        assert_eq!(
            result,
            Err(vec![MergeConsistencyIssue::DuplicateNpcSpawn {
                room_id: 1001,
                occurrences: vec![
                    NpcOccurrence {
                        tick: Tick(0),
                        npc_id: 100,
                    },
                    NpcOccurrence {
                        tick: Tick(4),
                        npc_id: 200,
                    },
                ],
            }]),
        );
    }

    #[test]
    fn lifecycle_flags_a_room_id_dying_twice() {
        let challenge =
            fixtures::challenge_info(Stage::TobMaiden, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobMaiden,
            Tick(9),
            vec![
                npc_spawn(Tick(0), 1001, 8360),
                npc_death(Tick(5), 1001, 8360),
                npc_death(Tick(8), 1001, 8360),
            ],
        );
        assert_eq!(
            result,
            Err(vec![MergeConsistencyIssue::DuplicateNpcDeath {
                room_id: 1001,
                occurrences: vec![
                    NpcOccurrence {
                        tick: Tick(5),
                        npc_id: 8360,
                    },
                    NpcOccurrence {
                        tick: Tick(8),
                        npc_id: 8360,
                    },
                ],
            }]),
        );
    }

    #[test]
    fn lifecycle_flags_a_death_without_a_spawn() {
        let challenge =
            fixtures::challenge_info(Stage::TobMaiden, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobMaiden,
            Tick(9),
            vec![npc_death(Tick(4), 1001, 8360)],
        );
        assert_eq!(
            result,
            Err(vec![MergeConsistencyIssue::DeathBeforeSpawn {
                room_id: 1001,
                death_tick: Tick(4),
                spawn_tick: None,
            }]),
        );
    }

    #[test]
    fn lifecycle_flags_a_death_before_a_spawn() {
        let challenge =
            fixtures::challenge_info(Stage::TobMaiden, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobMaiden,
            Tick(9),
            vec![
                npc_death(Tick(3), 1001, 8360),
                npc_spawn(Tick(6), 1001, 8360),
            ],
        );
        assert_eq!(
            result,
            Err(vec![MergeConsistencyIssue::DeathBeforeSpawn {
                room_id: 1001,
                death_tick: Tick(3),
                spawn_tick: Some(Tick(6)),
            }]),
        );
    }

    #[test]
    fn lifecycle_flags_a_death_on_its_spawn_tick() {
        let challenge =
            fixtures::challenge_info(Stage::TobMaiden, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobMaiden,
            Tick(9),
            vec![
                npc_spawn(Tick(3), 1001, 8360),
                npc_death(Tick(3), 1001, 8360),
            ],
        );
        assert_eq!(
            result,
            Err(vec![MergeConsistencyIssue::DeathBeforeSpawn {
                room_id: 1001,
                death_tick: Tick(3),
                spawn_tick: Some(Tick(3)),
            }]),
        );
    }

    #[test]
    fn lifecycle_reports_a_duplicate_spawn_and_a_death_before_spawn_together() {
        let challenge =
            fixtures::challenge_info(Stage::TobMaiden, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobMaiden,
            Tick(9),
            vec![
                npc_death(Tick(2), 1001, 8360),
                npc_spawn(Tick(5), 1001, 8360),
                npc_spawn(Tick(8), 1001, 8360),
            ],
        );
        assert_eq!(
            result,
            Err(vec![
                MergeConsistencyIssue::DuplicateNpcSpawn {
                    room_id: 1001,
                    occurrences: vec![
                        NpcOccurrence {
                            tick: Tick(5),
                            npc_id: 8360,
                        },
                        NpcOccurrence {
                            tick: Tick(8),
                            npc_id: 8360,
                        },
                    ],
                },
                MergeConsistencyIssue::DeathBeforeSpawn {
                    room_id: 1001,
                    death_tick: Tick(2),
                    spawn_tick: Some(Tick(5)),
                },
            ]),
        );
    }

    #[test]
    fn cooldown_permits_an_attack_off_cooldown() {
        let challenge =
            fixtures::challenge_info(Stage::TobMaiden, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobMaiden,
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
        assert_eq!(result, Ok(()));
    }

    #[test]
    fn cooldown_flags_an_attack_while_on_cooldown() {
        let challenge =
            fixtures::challenge_info(Stage::TobMaiden, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobMaiden,
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
            result,
            Err(vec![MergeConsistencyIssue::WeaponCooldownViolation {
                player: "1Ogp",
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
        let challenge =
            fixtures::challenge_info(Stage::TobMaiden, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobMaiden,
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
        assert_eq!(result, Ok(()));
    }

    #[test]
    fn stream_flags_a_unique_event_recurring() {
        let challenge =
            fixtures::challenge_info(Stage::TobVerzik, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobVerzik,
            Tick(9),
            vec![
                fixtures::verzik_phase_event(Tick(2), event::VerzikPhase::VerzikP1),
                fixtures::verzik_phase_event(Tick(5), event::VerzikPhase::VerzikP1),
            ],
        );
        assert_eq!(
            result,
            Err(vec![MergeConsistencyIssue::DuplicateStreamEvent {
                kind: event::Type::TobVerzikPhase,
                identity_key: "1".to_string(),
                ticks: vec![Tick(2), Tick(5)],
            }]),
        );
    }

    #[test]
    fn stream_flags_a_phase_out_of_order() {
        let challenge =
            fixtures::challenge_info(Stage::TobVerzik, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobVerzik,
            Tick(14),
            vec![
                fixtures::verzik_phase_event(Tick(2), event::VerzikPhase::VerzikP1),
                fixtures::verzik_phase_event(Tick(5), event::VerzikPhase::VerzikP3),
                fixtures::verzik_phase_event(Tick(10), event::VerzikPhase::VerzikP2),
            ],
        );
        assert_eq!(
            result,
            Err(vec![MergeConsistencyIssue::PhaseOutOfOrder {
                previous: PhaseOccurrence {
                    kind: event::Type::TobVerzikPhase,
                    identity_key: "3".to_string(),
                    tick: Tick(5),
                },
                current: PhaseOccurrence {
                    kind: event::Type::TobVerzikPhase,
                    identity_key: "2".to_string(),
                    tick: Tick(10),
                },
            }]),
        );
    }

    #[test]
    fn stream_flags_a_maze_proc_before_the_previous_maze_end() {
        let challenge =
            fixtures::challenge_info(Stage::TobSotetseg, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobSotetseg,
            Tick(14),
            vec![
                fixtures::sote_maze_proc_event(Tick(2), event::sote_maze::Maze::Maze66),
                fixtures::sote_maze_proc_event(Tick(8), event::sote_maze::Maze::Maze33),
                fixtures::sote_maze_end_event(Tick(10), event::sote_maze::Maze::Maze66, None),
            ],
        );
        assert_eq!(
            result,
            Err(vec![MergeConsistencyIssue::PhaseOutOfOrder {
                previous: PhaseOccurrence {
                    kind: event::Type::TobSoteMazeProc,
                    identity_key: "1".to_string(),
                    tick: Tick(8),
                },
                current: PhaseOccurrence {
                    kind: event::Type::TobSoteMazeEnd,
                    identity_key: "0".to_string(),
                    tick: Tick(10),
                },
            }]),
        );
    }

    #[test]
    fn stream_permits_a_windowed_event_recurring() {
        let challenge =
            fixtures::challenge_info(Stage::TobBloat, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobBloat,
            Tick(139),
            vec![
                fixtures::bloat_down_event(Tick(41), (3299, 4440), 1, Ticks(41)),
                fixtures::bloat_up_event(Tick(73)),
                fixtures::bloat_down_event(Tick(107), (3291, 4451), 2, Ticks(34)),
                fixtures::bloat_up_event(Tick(139)),
            ],
        );
        assert_eq!(result, Ok(()));
    }

    #[test]
    fn target_flags_a_player_attack_on_an_absent_npc() {
        let challenge =
            fixtures::challenge_info(Stage::TobMaiden, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobMaiden,
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
            result,
            Err(vec![MergeConsistencyIssue::AttackTargetMissing {
                tick: Tick(0),
                attacker: Actor::Player("1Ogp"),
                target: Actor::Npc(1001),
            }]),
        );
    }

    #[test]
    fn target_flags_an_npc_attack_on_an_absent_player() {
        let challenge =
            fixtures::challenge_info(Stage::TobMaiden, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobMaiden,
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
                    crate::proto::NpcAttack::TobMaidenAuto,
                    Some("WWWWWWWWWWQQ"),
                ),
            ],
        );
        assert_eq!(
            result,
            Err(vec![MergeConsistencyIssue::AttackTargetMissing {
                tick: Tick(0),
                attacker: Actor::Npc(1001),
                target: Actor::Player("WWWWWWWWWWQQ"),
            }]),
        );
    }

    #[test]
    fn target_permits_an_npc_attack_on_a_dead_player() {
        let challenge =
            fixtures::challenge_info(Stage::TobMaiden, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobMaiden,
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
                    crate::proto::NpcAttack::TobMaidenAuto,
                    Some("1Ogp"),
                ),
            ],
        );
        assert_eq!(result, Ok(()));
    }

    #[test]
    fn exclusive_flags_bloat_down_and_up_on_one_tick() {
        let challenge =
            fixtures::challenge_info(Stage::TobBloat, ChallengeMode::TobRegular, &PARTY);
        let result = check_events(
            &challenge,
            Stage::TobBloat,
            Tick(4),
            vec![
                fixtures::bloat_down_event(Tick(2), (3299, 4440), 1, Ticks(2)),
                fixtures::bloat_up_event(Tick(2)),
            ],
        );
        assert_eq!(
            result,
            Err(vec![MergeConsistencyIssue::ExclusiveEventViolation {
                exclusive_types: (event::Type::TobBloatDown, event::Type::TobBloatUp),
                tick: Tick(2),
            }]),
        );
    }
}

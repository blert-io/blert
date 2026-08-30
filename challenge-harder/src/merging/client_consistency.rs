//! Cursory consistency checks over a client's recorded events for a stage,
//! looking for obvious indications of tick loss.
//!
//! Lag detection in the general case is impossible. The absence of issues
//! does not imply that a timeline is of high quality.

use crate::lifecycle::core::types::{ChallengeMode, ChallengeType, StageExt};
use crate::npc;
use crate::proto::{Coords, NpcAttack, Stage, event};

use super::event::MalformedEvent;
use super::timeline::{TickState, Timeline};
use super::world;
use super::{BadData, ChallengeInfo};

pub(super) const MAX_RECORDED_TICKS: u32 = 36_000; // six hour logout timer

/// A problem detected in a client's events.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConsistencyIssue {
    /// A player moved an impossibly large distance.
    LargeJump {
        player: String,
        tick: u32,
        last_tick: u32,
        start: Coords,
        end: Coords,
    },
    /// Events arrived in an order inconsistent with the mechanics of a fight.
    InvalidEventSequence { kind: event::Type, tick: u32 },
    /// Consecutive events occurred closer than the game allows.
    InvalidTickGap {
        kind: event::Type,
        tick: u32,
        observed: u32,
        min: u32,
    },
}

impl ConsistencyIssue {
    /// The tick on which the issue occurred.
    pub fn tick(&self) -> u32 {
        match self {
            ConsistencyIssue::LargeJump { tick, .. }
            | ConsistencyIssue::InvalidEventSequence { tick, .. }
            | ConsistencyIssue::InvalidTickGap { tick, .. } => *tick,
        }
    }
}

/// Checks a client's timeline for consistency issues.
pub(super) fn check(
    challenge: &ChallengeInfo<'_>,
    stage: Stage,
    timeline: &Timeline,
) -> Result<Vec<ConsistencyIssue>, BadData> {
    let mut issues = check_movement(stage, challenge.party, timeline);
    match stage {
        Stage::TobBloat => issues.extend(check_bloat(timeline)?),
        Stage::TobNylocas => issues.extend(check_nylocas(challenge.mode, timeline)?),
        _ => {}
    }
    Ok(issues)
}

fn has_npc_attack(
    state: Option<&TickState>,
    id_matches: impl Fn(u32) -> bool,
    kind: NpcAttack,
) -> bool {
    state.is_some_and(|state| {
        state.npcs().any(|(_, npc)| {
            id_matches(npc.id)
                && npc
                    .attack
                    .as_ref()
                    .is_some_and(|attack| attack.value.kind == kind)
        })
    })
}

fn check_movement(stage: Stage, party: &[String], timeline: &Timeline) -> Vec<ConsistencyIssue> {
    MovementChecker {
        stage,
        party,
        timeline,
    }
    .check()
}

struct MovementChecker<'a> {
    stage: Stage,
    party: &'a [String],
    timeline: &'a Timeline,
}

impl MovementChecker<'_> {
    fn check(&self) -> Vec<ConsistencyIssue> {
        let mut issues = Vec::new();
        let mut last_seen: Vec<Option<(u32, Coords)>> = vec![None; self.party.len()];
        let mut dead = vec![false; self.party.len()];

        for state in self.timeline.ticks().iter().flatten() {
            let tick = state.tick();

            for (index, player) in self.party.iter().enumerate() {
                let Some(player_state) = state.player(player) else {
                    continue;
                };
                if !dead[index]
                    && state.events_of_type(event::Type::PlayerDeath).any(|event| {
                        event
                            .player
                            .as_ref()
                            .is_some_and(|dead_player| dead_player.name == *player)
                    })
                {
                    dead[index] = true;
                }

                if let Some((last_tick, last_position)) = last_seen[index] {
                    let delta_ticks = tick - last_tick;
                    // Players can move at most 2 tiles per tick.
                    let max_distance = 2 * delta_ticks;
                    let jumped = !dead[index]
                        && world::chebyshev(last_position, player_state.position) > max_distance
                        && !self.is_special_teleport(
                            tick,
                            player,
                            last_position,
                            player_state.position,
                            delta_ticks,
                        );
                    if jumped {
                        issues.push(ConsistencyIssue::LargeJump {
                            player: player.clone(),
                            tick,
                            last_tick,
                            start: last_position,
                            end: player_state.position,
                        });
                    }
                }

                last_seen[index] = Some((tick, player_state.position));
            }
        }

        issues
    }

    /// Checks if `player` moving between `last` and `current` over `delta_ticks`
    /// is explainable by a boss mechanic or teleport.
    fn is_special_teleport(
        &self,
        tick: u32,
        player: &str,
        last: Coords,
        current: Coords,
        delta_ticks: u32,
    ) -> bool {
        if world::is_in_death_area(self.stage, current) {
            return true;
        }

        match self.stage.challenge_type() {
            Some(ChallengeType::Colosseum) => {
                // During the cutscene at the start of the boss fight, players
                // remain on their original tile, then are teleported to the
                // fight start tile when the cutscene ends.
                self.stage == Stage::ColosseumWave12
                    && tick < 5
                    && current == world::COLOSSEUM_BOSS_START_TILE
            }
            Some(ChallengeType::Tob) => match self.stage {
                Stage::TobSotetseg => Self::check_sotetseg_teleport(last, current, delta_ticks),
                Stage::TobVerzik => {
                    self.check_verzik_teleport(tick, player, last, current, delta_ticks)
                }
                // Maiden, Bloat, Nylocas, and Xarpus have no special teleports.
                _ => false,
            },
            // Not yet supported.
            Some(ChallengeType::Cox | ChallengeType::Toa) => {
                unimplemented!("hello implementer fill this in")
            }
            Some(
                ChallengeType::UnknownChallenge | ChallengeType::Inferno | ChallengeType::Mokhaiotl,
            )
            | None => false,
        }
    }

    fn check_sotetseg_teleport(last: Coords, current: Coords, delta_ticks: u32) -> bool {
        // Maze teleports between the overworld and underworld.
        if world::SOTETSEG_UNDERWORLD_AREA.contains(current)
            && world::SOTETSEG_ROOM_AREA.contains(last)
        {
            return true;
        }
        if world::SOTETSEG_ROOM_AREA.contains(current)
            && world::SOTETSEG_UNDERWORLD_AREA.contains(last)
        {
            return true;
        }

        // The only other teleport is from anywhere in the room to the start
        // of the maze when it procs, which is a one-tick movement.
        delta_ticks == 1
            && world::SOTETSEG_ROOM_AREA.contains(last)
            && current == world::SOTETSEG_OVERWORLD_MAZE_START_TILE
    }

    fn check_verzik_teleport(
        &self,
        tick: u32,
        player: &str,
        last: Coords,
        current: Coords,
        delta_ticks: u32,
    ) -> bool {
        if delta_ticks != 1 {
            return false;
        }

        // Check the previous tick's NPC because a bounce can happen right on
        // a phase transition.
        let verzik = self
            .timeline
            .get(tick - 1)
            .and_then(|state| state.npcs().find(|(_, npc)| npc::is_verzik(npc.id)));
        let Some((verzik_room_id, verzik)) = verzik else {
            return false;
        };

        if npc::is_verzik_p2(verzik.id) {
            return self.check_for_p2_bounce(verzik_room_id, tick, player, last, current);
        }

        if npc::is_verzik_p3(verzik.id) {
            return self.check_for_p3_webs_push(tick, last, current);
        }

        false
    }

    fn check_for_p2_bounce(
        &self,
        verzik_room_id: u64,
        tick: u32,
        player: &str,
        last: Coords,
        current: Coords,
    ) -> bool {
        // Verzik's bounce pushes a player away from under or adjacent to her.
        if !world::VERZIK_P2_BOUNCEABLE_AREA.contains(last)
            || !world::is_valid_p2_bounce_destination(current)
        {
            return false;
        }

        let potential_bounce_tick = tick - 1;

        for t in potential_bounce_tick..=tick + 5 {
            let Some(bounce) = self
                .timeline
                .get(t)
                .and_then(|state| state.events_of_type(event::Type::TobVerzikBounce).next())
                .and_then(|event| event.verzik_bounce.as_ref())
            else {
                continue;
            };

            let attack_tick = u32::try_from(bounce.npc_attack_tick).ok();
            let valid_tick =
                attack_tick == Some(potential_bounce_tick) || attack_tick == Some(tick);
            if valid_tick && bounce.bounced_player.as_deref() == Some(player) {
                return true;
            }
        }

        // It's possible for a client to not send a bounce event, which could
        // happen in two ways:
        //
        // 1. The bounce occurred right at the transition from P2 to P3, so
        //    Verzik's bounce animation was superseded by the transition
        //    animation.
        // 2. The plugin didn't attribute the bounce event due to its state
        //    machine becoming desynced. In this case, the client should still
        //    have sent a bounce attack for Verzik.
        //
        // In both cases, the target of the bounce is not known. However, since
        // it's single-target, we can check that only the player we are testing
        // made a bounce-like movement and allow it if so.
        let is_at_p3_transition = self
            .timeline
            .get(tick + 1)
            .and_then(|state| state.npc(verzik_room_id))
            .is_some_and(|npc| npc::is_verzik_p3_transition(npc.id));

        let has_bounce = |t: u32| {
            has_npc_attack(
                self.timeline.get(t),
                npc::is_verzik_p2,
                NpcAttack::TobVerzikP2Bounce,
            )
        };

        if !is_at_p3_transition && !has_bounce(potential_bounce_tick) && !has_bounce(tick) {
            return false;
        }

        let mut bounce_like_movements = 0;
        let mut player_was_bounced = false;

        for name in self.party {
            let curr = self.timeline.get(tick).and_then(|state| state.player(name));
            let prev = self
                .timeline
                .get(potential_bounce_tick)
                .and_then(|state| state.player(name));
            let (Some(curr), Some(prev)) = (curr, prev) else {
                continue;
            };

            if world::VERZIK_P2_BOUNCEABLE_AREA.contains(prev.position)
                && world::is_valid_p2_bounce_destination(curr.position)
            {
                bounce_like_movements += 1;
                if name.as_str() == player {
                    player_was_bounced = true;
                }
            }
        }

        player_was_bounced && bounce_like_movements == 1
    }

    fn check_for_p3_webs_push(&self, tick: u32, last: Coords, current: Coords) -> bool {
        // When webs starts, players under Verzik are pushed directly outside
        // of her area.
        let is_webs = (tick.saturating_sub(3)..=tick).any(|t| {
            has_npc_attack(
                self.timeline.get(t),
                npc::is_verzik_p3,
                NpcAttack::TobVerzikP3Webs,
            )
        });

        is_webs
            && world::VERZIK_P3_WEBS_AREA.contains(last)
            && world::is_valid_p3_webs_push_destination(current)
    }
}

fn check_bloat(timeline: &Timeline) -> Result<Vec<ConsistencyIssue>, BadData> {
    let mut issues = Vec::new();
    let mut is_down = false;

    for state in timeline.ticks().iter().flatten() {
        let down = state
            .events_of_type(event::Type::TobBloatDown)
            .next()
            .is_some();
        let up = state
            .events_of_type(event::Type::TobBloatUp)
            .next()
            .is_some();

        if down && up {
            return Err(BadData::Inconsistent {
                tick: state.tick(),
                message: "Bloat down and up events on the same tick".to_string(),
            });
        }

        if down {
            if is_down {
                issues.push(ConsistencyIssue::InvalidEventSequence {
                    kind: event::Type::TobBloatDown,
                    tick: state.tick(),
                });
            }
            is_down = true;
        } else if up {
            if !is_down {
                issues.push(ConsistencyIssue::InvalidEventSequence {
                    kind: event::Type::TobBloatUp,
                    tick: state.tick(),
                });
            }
            is_down = false;
        }
    }

    Ok(issues)
}

fn check_nylocas(
    mode: ChallengeMode,
    timeline: &Timeline,
) -> Result<Vec<ConsistencyIssue>, BadData> {
    let mut issues = Vec::new();
    let mut last_wave = 0;
    let mut last_spawn_tick = 0;

    for state in timeline.ticks().iter().flatten() {
        let Some(spawn) = state.events_of_type(event::Type::TobNyloWaveSpawn).next() else {
            continue;
        };

        let Some(nylo_wave) = &spawn.nylo_wave else {
            return Err(MalformedEvent::MissingPayload {
                kind: event::Type::TobNyloWaveSpawn,
                tick: state.tick(),
                field: "nylo_wave",
            }
            .into());
        };
        let wave = nylo_wave.wave;

        if !(1..=31).contains(&wave) {
            return Err(MalformedEvent::OutOfDomain {
                kind: event::Type::TobNyloWaveSpawn,
                tick: state.tick(),
                field: "nylo_wave.wave",
                value: wave.to_string(),
            }
            .into());
        }

        if last_wave > 0 {
            if wave <= last_wave {
                return Err(BadData::Inconsistent {
                    tick: state.tick(),
                    message: format!("Nylocas wave {wave} after wave {last_wave}"),
                });
            }

            let delta = state.tick() - last_spawn_tick;
            let min = world::sum_natural_stalls(mode, last_wave, wave);
            if delta < min {
                issues.push(ConsistencyIssue::InvalidTickGap {
                    kind: event::Type::TobNyloWaveSpawn,
                    tick: state.tick(),
                    observed: delta,
                    min,
                });
            }
        }

        last_spawn_tick = state.tick();
        last_wave = wave;
    }

    Ok(issues)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::merging::fixtures;
    use crate::proto::Event;

    #[test]
    fn movement_permits_up_to_two_tiles_per_tick() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            3,
            vec![
                fixtures::PlayerUpdateEvent::new(0, Stage::TobMaiden, "1Ogp", (3184, 4447)).build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobMaiden, "1Ogp", (3182, 4446)).build(),
                fixtures::PlayerUpdateEvent::new(2, Stage::TobMaiden, "1Ogp", (3180, 4445)).build(),
            ],
        );
        assert_eq!(check_movement(Stage::TobMaiden, &party, &timeline), vec![]);
    }

    #[test]
    fn movement_flags_greater_than_two_tiles() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            2,
            vec![
                fixtures::PlayerUpdateEvent::new(0, Stage::TobMaiden, "1Ogp", (3184, 4447)).build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobMaiden, "1Ogp", (3174, 4447)).build(),
            ],
        );
        assert_eq!(
            check_movement(Stage::TobMaiden, &party, &timeline),
            vec![ConsistencyIssue::LargeJump {
                player: "1Ogp".to_string(),
                tick: 1,
                last_tick: 0,
                start: (3184, 4447).into(),
                end: (3174, 4447).into(),
            }],
        );
    }

    #[test]
    fn movement_distance_scales_with_the_tick_gap() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            6,
            vec![
                fixtures::PlayerUpdateEvent::new(0, Stage::TobMaiden, "1Ogp", (3184, 4447)).build(),
                fixtures::PlayerUpdateEvent::new(3, Stage::TobMaiden, "1Ogp", (3178, 4447)).build(), // valid
                fixtures::PlayerUpdateEvent::new(5, Stage::TobMaiden, "1Ogp", (3184, 4447)).build(), // invalid
            ],
        );
        assert_eq!(
            check_movement(Stage::TobMaiden, &party, &timeline),
            vec![ConsistencyIssue::LargeJump {
                player: "1Ogp".to_string(),
                tick: 5,
                last_tick: 3,
                start: (3178, 4447).into(),
                end: (3184, 4447).into(),
            }],
        );
    }

    #[test]
    fn movement_ignores_dead_players() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            2,
            vec![
                fixtures::PlayerUpdateEvent::new(0, Stage::TobMaiden, "1Ogp", (3184, 4447)).build(),
                fixtures::player_death_event(1, Stage::TobMaiden, (3177, 4440), "1Ogp", 0),
            ],
        );
        assert_eq!(check_movement(Stage::TobMaiden, &party, &timeline), vec![]);
    }

    #[test]
    fn movement_tracks_each_player() {
        let party = vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()];
        let timeline = fixtures::timeline(
            &party,
            2,
            vec![
                fixtures::PlayerUpdateEvent::new(0, Stage::TobMaiden, "1Ogp", (3184, 4447)).build(),
                fixtures::PlayerUpdateEvent::new(0, Stage::TobMaiden, "WWWWWWWWWWQQ", (3184, 4445))
                    .build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobMaiden, "1Ogp", (3183, 4446)).build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobMaiden, "WWWWWWWWWWQQ", (3172, 4445))
                    .build(),
            ],
        );
        assert_eq!(
            check_movement(Stage::TobMaiden, &party, &timeline),
            vec![ConsistencyIssue::LargeJump {
                player: "WWWWWWWWWWQQ".to_string(),
                tick: 1,
                last_tick: 0,
                start: (3184, 4445).into(),
                end: (3172, 4445).into(),
            }],
        );
    }

    #[test]
    fn movement_unconditionally_flags_in_stages_without_special_teleports() {
        let party = vec!["1Ogp".to_string()];
        let stages = [
            (Stage::TobMaiden, (3184, 4447)),
            (Stage::InfernoWave1, (2273, 5353)),
            (Stage::ColosseumWave2, (1815, 3110)),
            (Stage::MokhaiotlDelve3, (3423, 6433)),
            (Stage::UnknownStage, (3184, 4447)),
        ];
        for (stage, start) in stages {
            let end = (start.0 + 10, start.1);
            let timeline = fixtures::timeline(
                &party,
                2,
                vec![
                    fixtures::PlayerUpdateEvent::new(0, stage, "1Ogp", start).build(),
                    fixtures::PlayerUpdateEvent::new(1, stage, "1Ogp", end).build(),
                ],
            );
            assert_eq!(
                check_movement(stage, &party, &timeline),
                vec![ConsistencyIssue::LargeJump {
                    player: "1Ogp".to_string(),
                    tick: 1,
                    last_tick: 0,
                    start: start.into(),
                    end: end.into(),
                }],
                "stage {stage:?}",
            );
        }
    }

    #[test]
    fn movement_permits_teleports_into_death_areas() {
        let cases = [
            (Stage::TobMaiden, (3170, 4440), (3166, 4433)),
            (Stage::TobBloat, (3292, 4446), (3295, 4436)),
            (Stage::TobNylocas, (3296, 4249), (3290, 4240)),
            (Stage::TobSotetseg, (3276, 4326), (3270, 4313)),
            (Stage::TobXarpus, (3170, 4386), (3157, 4387)),
            (Stage::TobVerzik, (3168, 4312), (3159, 4325)),
        ];
        let party = vec!["1Ogp".to_string()];
        for (stage, start, end) in cases {
            let timeline = fixtures::timeline(
                &party,
                2,
                vec![
                    fixtures::PlayerUpdateEvent::new(0, stage, "1Ogp", start).build(),
                    fixtures::PlayerUpdateEvent::new(1, stage, "1Ogp", end).build(),
                ],
            );
            assert_eq!(
                check_movement(stage, &party, &timeline),
                vec![],
                "stage {stage:?}",
            );
        }
    }

    #[test]
    fn movement_permits_colosseum_boss_start_teleport() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            5,
            vec![
                fixtures::PlayerUpdateEvent::new(3, Stage::ColosseumWave12, "1Ogp", (1819, 3118))
                    .build(),
                fixtures::PlayerUpdateEvent::new(4, Stage::ColosseumWave12, "1Ogp", (1825, 3103))
                    .build(),
            ],
        );
        assert_eq!(
            check_movement(Stage::ColosseumWave12, &party, &timeline),
            vec![],
        );
    }

    #[test]
    fn movement_flags_colosseum_boss_start_teleport_after_start() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            6,
            vec![
                fixtures::PlayerUpdateEvent::new(4, Stage::ColosseumWave12, "1Ogp", (1819, 3118))
                    .build(),
                fixtures::PlayerUpdateEvent::new(5, Stage::ColosseumWave12, "1Ogp", (1825, 3103))
                    .build(),
            ],
        );
        assert_eq!(
            check_movement(Stage::ColosseumWave12, &party, &timeline),
            vec![ConsistencyIssue::LargeJump {
                player: "1Ogp".to_string(),
                tick: 5,
                last_tick: 4,
                start: (1819, 3118).into(),
                end: (1825, 3103).into(),
            }],
        );
    }

    #[test]
    fn movement_flags_colosseum_teleport_to_non_start_tiles() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            5,
            vec![
                fixtures::PlayerUpdateEvent::new(3, Stage::ColosseumWave12, "1Ogp", (1819, 3118))
                    .build(),
                fixtures::PlayerUpdateEvent::new(4, Stage::ColosseumWave12, "1Ogp", (1817, 3103))
                    .build(),
            ],
        );
        assert_eq!(
            check_movement(Stage::ColosseumWave12, &party, &timeline),
            vec![ConsistencyIssue::LargeJump {
                player: "1Ogp".to_string(),
                tick: 4,
                last_tick: 3,
                start: (1819, 3118).into(),
                end: (1817, 3103).into(),
            }],
        );
    }

    #[test]
    fn movement_flags_colosseum_jumps_in_earlier_waves() {
        let party = vec!["1Ogp".to_string()];
        for value in (Stage::ColosseumWave1 as i32)..=(Stage::ColosseumWave11 as i32) {
            let stage = Stage::try_from(value).expect("colosseum wave stages are contiguous");
            let timeline = fixtures::timeline(
                &party,
                2,
                vec![
                    fixtures::PlayerUpdateEvent::new(0, stage, "1Ogp", (1815, 3110)).build(),
                    fixtures::PlayerUpdateEvent::new(1, stage, "1Ogp", (1825, 3103)).build(),
                ],
            );
            assert_eq!(
                check_movement(stage, &party, &timeline),
                vec![ConsistencyIssue::LargeJump {
                    player: "1Ogp".to_string(),
                    tick: 1,
                    last_tick: 0,
                    start: (1815, 3110).into(),
                    end: (1825, 3103).into(),
                }],
                "stage {stage:?}",
            );
        }
    }

    #[test]
    fn movement_permits_sotetseg_maze_start_teleport() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            2,
            vec![
                fixtures::PlayerUpdateEvent::new(0, Stage::TobSotetseg, "1Ogp", (3275, 4310))
                    .build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobSotetseg, "1Ogp", (3274, 4307))
                    .build(),
            ],
        );
        assert_eq!(
            check_movement(Stage::TobSotetseg, &party, &timeline),
            vec![]
        );
    }

    #[test]
    fn movement_permits_sotetseg_room_to_underworld_teleport() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            2,
            vec![
                fixtures::PlayerUpdateEvent::new(0, Stage::TobSotetseg, "1Ogp", (3280, 4320))
                    .build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobSotetseg, "1Ogp", (3360, 4315))
                    .build(),
            ],
        );
        assert_eq!(
            check_movement(Stage::TobSotetseg, &party, &timeline),
            vec![]
        );
    }

    #[test]
    fn movement_permits_sotetseg_underworld_to_room_teleport() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            8,
            vec![
                fixtures::PlayerUpdateEvent::new(0, Stage::TobSotetseg, "1Ogp", (3360, 4315))
                    .build(),
                fixtures::PlayerUpdateEvent::new(7, Stage::TobSotetseg, "1Ogp", (3275, 4310))
                    .build(),
            ],
        );
        assert_eq!(
            check_movement(Stage::TobSotetseg, &party, &timeline),
            vec![]
        );
    }

    #[test]
    fn movement_permits_sotetseg_underworld_teleport_over_multiple_ticks() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            6,
            vec![
                fixtures::PlayerUpdateEvent::new(0, Stage::TobSotetseg, "1Ogp", (3275, 4310))
                    .build(),
                fixtures::PlayerUpdateEvent::new(5, Stage::TobSotetseg, "1Ogp", (3360, 4315))
                    .build(),
            ],
        );
        assert_eq!(
            check_movement(Stage::TobSotetseg, &party, &timeline),
            vec![]
        );
    }

    #[test]
    fn movement_flags_sotetseg_jumps_to_non_maze_tiles() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            2,
            vec![
                fixtures::PlayerUpdateEvent::new(0, Stage::TobSotetseg, "1Ogp", (3275, 4310))
                    .build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobSotetseg, "1Ogp", (3300, 4350))
                    .build(),
            ],
        );
        assert_eq!(
            check_movement(Stage::TobSotetseg, &party, &timeline),
            vec![ConsistencyIssue::LargeJump {
                player: "1Ogp".to_string(),
                tick: 1,
                last_tick: 0,
                start: (3275, 4310).into(),
                end: (3300, 4350).into(),
            }],
        );
    }

    #[test]
    fn movement_flags_sotetseg_maze_start_teleport_across_multiple_ticks() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            3,
            vec![
                fixtures::PlayerUpdateEvent::new(0, Stage::TobSotetseg, "1Ogp", (3275, 4312))
                    .build(),
                fixtures::PlayerUpdateEvent::new(2, Stage::TobSotetseg, "1Ogp", (3274, 4307))
                    .build(),
            ],
        );
        assert_eq!(
            check_movement(Stage::TobSotetseg, &party, &timeline),
            vec![ConsistencyIssue::LargeJump {
                player: "1Ogp".to_string(),
                tick: 2,
                last_tick: 0,
                start: (3275, 4312).into(),
                end: (3274, 4307).into(),
            }],
        );
    }

    #[test]
    fn movement_flags_verzik_jumps_if_verzik_is_missing() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            2,
            vec![
                fixtures::PlayerUpdateEvent::new(0, Stage::TobVerzik, "1Ogp", (3168, 4313)).build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobVerzik, "1Ogp", (3168, 4309)).build(),
            ],
        );
        assert_eq!(
            check_movement(Stage::TobVerzik, &party, &timeline),
            vec![ConsistencyIssue::LargeJump {
                player: "1Ogp".to_string(),
                tick: 1,
                last_tick: 0,
                start: (3168, 4313).into(),
                end: (3168, 4309).into(),
            }],
        );
    }

    fn verzik_p2_spawn() -> Event {
        fixtures::npc_spawn_event(fixtures::NpcEvent {
            tick: 0,
            stage: Stage::TobVerzik,
            coords: (3167, 4313),
            npc_id: npc::id::VERZIK_P2_REGULAR,
            room_id: 57001,
            ..Default::default()
        })
    }

    #[test]
    fn movement_permits_verzik_bounce() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            2,
            vec![
                verzik_p2_spawn(),
                fixtures::PlayerUpdateEvent::new(0, Stage::TobVerzik, "1Ogp", (3168, 4313)).build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobVerzik, "1Ogp", (3168, 4309)).build(),
                fixtures::verzik_bounce_event(1, 0, 1, 0, Some("1Ogp")),
            ],
        );
        assert_eq!(check_movement(Stage::TobVerzik, &party, &timeline), vec![]);
    }

    #[test]
    fn movement_permits_verzik_bounce_from_corner() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            2,
            vec![
                verzik_p2_spawn(),
                fixtures::PlayerUpdateEvent::new(0, Stage::TobVerzik, "1Ogp", (3167, 4313)).build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobVerzik, "1Ogp", (3162, 4308)).build(),
                fixtures::verzik_bounce_event(1, 0, 1, 0, Some("1Ogp")),
            ],
        );
        assert_eq!(check_movement(Stage::TobVerzik, &party, &timeline), vec![]);
    }

    #[test]
    fn movement_permits_verzik_bounce_at_the_end_of_p2() {
        let party = vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()];
        let timeline = fixtures::timeline(
            &party,
            3,
            vec![
                verzik_p2_spawn(),
                fixtures::PlayerUpdateEvent::new(0, Stage::TobVerzik, "1Ogp", (3168, 4313)).build(),
                fixtures::PlayerUpdateEvent::new(0, Stage::TobVerzik, "WWWWWWWWWWQQ", (3160, 4310))
                    .build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobVerzik, "1Ogp", (3168, 4309)).build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobVerzik, "WWWWWWWWWWQQ", (3160, 4310))
                    .build(),
                fixtures::npc_update_event(fixtures::NpcEvent {
                    tick: 2,
                    stage: Stage::TobVerzik,
                    coords: (3167, 4313),
                    npc_id: npc::id::VERZIK_P3_TRANSITION_REGULAR,
                    room_id: 57001,
                    ..Default::default()
                }),
            ],
        );
        assert_eq!(check_movement(Stage::TobVerzik, &party, &timeline), vec![]);
    }

    #[test]
    fn movement_flags_verzik_bounce_like_movement_when_another_player_was_bounced() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            2,
            vec![
                verzik_p2_spawn(),
                fixtures::PlayerUpdateEvent::new(0, Stage::TobVerzik, "1Ogp", (3168, 4313)).build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobVerzik, "1Ogp", (3168, 4309)).build(),
                fixtures::verzik_bounce_event(1, 0, 1, 0, Some("WWWWWWWWWWQQ")),
            ],
        );
        assert_eq!(
            check_movement(Stage::TobVerzik, &party, &timeline),
            vec![ConsistencyIssue::LargeJump {
                player: "1Ogp".to_string(),
                tick: 1,
                last_tick: 0,
                start: (3168, 4313).into(),
                end: (3168, 4309).into(),
            }],
        );
    }

    #[test]
    fn movement_flags_verzik_p2_jumps_outside_of_bounce_area() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            2,
            vec![
                verzik_p2_spawn(),
                fixtures::PlayerUpdateEvent::new(0, Stage::TobVerzik, "1Ogp", (3168, 4305)).build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobVerzik, "1Ogp", (3168, 4309)).build(),
                fixtures::verzik_bounce_event(1, 0, 1, 0, Some("1Ogp")),
            ],
        );
        assert_eq!(
            check_movement(Stage::TobVerzik, &party, &timeline),
            vec![ConsistencyIssue::LargeJump {
                player: "1Ogp".to_string(),
                tick: 1,
                last_tick: 0,
                start: (3168, 4305).into(),
                end: (3168, 4309).into(),
            }],
        );
    }

    #[test]
    fn movement_flags_verzik_bounce_like_movement_over_multiple_ticks() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            3,
            vec![
                verzik_p2_spawn(),
                fixtures::PlayerUpdateEvent::new(0, Stage::TobVerzik, "1Ogp", (3168, 4313)).build(),
                fixtures::verzik_bounce_event(1, 0, 1, 0, Some("1Ogp")),
                fixtures::PlayerUpdateEvent::new(2, Stage::TobVerzik, "1Ogp", (3168, 4303)).build(),
            ],
        );
        assert_eq!(
            check_movement(Stage::TobVerzik, &party, &timeline),
            vec![ConsistencyIssue::LargeJump {
                player: "1Ogp".to_string(),
                tick: 2,
                last_tick: 0,
                start: (3168, 4313).into(),
                end: (3168, 4303).into(),
            }],
        );
    }

    #[test]
    fn movement_permits_verzik_bounce_like_movements_following_a_bounce_attack() {
        let party = vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()];
        let timeline = fixtures::timeline(
            &party,
            2,
            vec![
                verzik_p2_spawn(),
                fixtures::npc_attack_event(
                    0,
                    Stage::TobVerzik,
                    (3168, 4314),
                    npc::id::VERZIK_P2_REGULAR,
                    57001,
                    NpcAttack::TobVerzikP2Bounce,
                    None,
                ),
                fixtures::PlayerUpdateEvent::new(0, Stage::TobVerzik, "1Ogp", (3168, 4313)).build(),
                fixtures::PlayerUpdateEvent::new(0, Stage::TobVerzik, "WWWWWWWWWWQQ", (3160, 4310))
                    .build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobVerzik, "1Ogp", (3168, 4309)).build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobVerzik, "WWWWWWWWWWQQ", (3160, 4310))
                    .build(),
            ],
        );
        assert_eq!(check_movement(Stage::TobVerzik, &party, &timeline), vec![]);
    }

    #[test]
    fn movement_flags_verzik_bounce_like_movement_without_an_attack() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            2,
            vec![
                verzik_p2_spawn(),
                fixtures::PlayerUpdateEvent::new(0, Stage::TobVerzik, "1Ogp", (3168, 4313)).build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobVerzik, "1Ogp", (3168, 4309)).build(),
            ],
        );
        assert_eq!(
            check_movement(Stage::TobVerzik, &party, &timeline),
            vec![ConsistencyIssue::LargeJump {
                player: "1Ogp".to_string(),
                tick: 1,
                last_tick: 0,
                start: (3168, 4313).into(),
                end: (3168, 4309).into(),
            }],
        );
    }

    #[test]
    fn movement_flags_verzik_bounce_like_movements_for_multiple_players() {
        let party = vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()];
        let timeline = fixtures::timeline(
            &party,
            2,
            vec![
                verzik_p2_spawn(),
                fixtures::npc_attack_event(
                    0,
                    Stage::TobVerzik,
                    (3168, 4314),
                    npc::id::VERZIK_P2_REGULAR,
                    57001,
                    NpcAttack::TobVerzikP2Bounce,
                    None,
                ),
                fixtures::PlayerUpdateEvent::new(0, Stage::TobVerzik, "1Ogp", (3168, 4313)).build(),
                fixtures::PlayerUpdateEvent::new(0, Stage::TobVerzik, "WWWWWWWWWWQQ", (3169, 4313))
                    .build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobVerzik, "1Ogp", (3168, 4309)).build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobVerzik, "WWWWWWWWWWQQ", (3173, 4314))
                    .build(),
            ],
        );
        assert_eq!(
            check_movement(Stage::TobVerzik, &party, &timeline),
            vec![
                ConsistencyIssue::LargeJump {
                    player: "1Ogp".to_string(),
                    tick: 1,
                    last_tick: 0,
                    start: (3168, 4313).into(),
                    end: (3168, 4309).into(),
                },
                ConsistencyIssue::LargeJump {
                    player: "WWWWWWWWWWQQ".to_string(),
                    tick: 1,
                    last_tick: 0,
                    start: (3169, 4313).into(),
                    end: (3173, 4314).into(),
                },
            ],
        );
    }

    fn verzik_p3_update(tick: u32) -> Event {
        fixtures::npc_update_event(fixtures::NpcEvent {
            tick,
            stage: Stage::TobVerzik,
            coords: (3165, 4309),
            npc_id: npc::id::VERZIK_P3_REGULAR,
            room_id: 57001,
            ..Default::default()
        })
    }

    fn verzik_webs_attack(tick: u32) -> Event {
        fixtures::npc_attack_event(
            tick,
            Stage::TobVerzik,
            (3165, 4309),
            npc::id::VERZIK_P3_REGULAR,
            57001,
            NpcAttack::TobVerzikP3Webs,
            None,
        )
    }

    #[test]
    fn movement_permits_verzik_webs_push() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            2,
            vec![
                verzik_p3_update(0),
                verzik_webs_attack(0),
                fixtures::PlayerUpdateEvent::new(0, Stage::TobVerzik, "1Ogp", (3168, 4312)).build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobVerzik, "1Ogp", (3168, 4308)).build(),
            ],
        );
        assert_eq!(check_movement(Stage::TobVerzik, &party, &timeline), vec![]);
    }

    #[test]
    fn movement_flags_verzik_webs_push_to_an_invalid_tile() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            2,
            vec![
                verzik_p3_update(0),
                verzik_webs_attack(0),
                fixtures::PlayerUpdateEvent::new(0, Stage::TobVerzik, "1Ogp", (3168, 4312)).build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobVerzik, "1Ogp", (3168, 4307)).build(),
            ],
        );
        assert_eq!(
            check_movement(Stage::TobVerzik, &party, &timeline),
            vec![ConsistencyIssue::LargeJump {
                player: "1Ogp".to_string(),
                tick: 1,
                last_tick: 0,
                start: (3168, 4312).into(),
                end: (3168, 4307).into(),
            }],
        );
    }

    #[test]
    fn movement_flags_verzik_p3_jumps_outside_of_webs_area() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            2,
            vec![
                verzik_p3_update(0),
                verzik_webs_attack(0),
                fixtures::PlayerUpdateEvent::new(0, Stage::TobVerzik, "1Ogp", (3160, 4310)).build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobVerzik, "1Ogp", (3168, 4308)).build(),
            ],
        );
        assert_eq!(
            check_movement(Stage::TobVerzik, &party, &timeline),
            vec![ConsistencyIssue::LargeJump {
                player: "1Ogp".to_string(),
                tick: 1,
                last_tick: 0,
                start: (3160, 4310).into(),
                end: (3168, 4308).into(),
            }],
        );
    }

    #[test]
    fn movement_flags_verzik_webs_like_movement_without_an_attack() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            2,
            vec![
                verzik_p3_update(0),
                fixtures::PlayerUpdateEvent::new(0, Stage::TobVerzik, "1Ogp", (3168, 4312)).build(),
                fixtures::PlayerUpdateEvent::new(1, Stage::TobVerzik, "1Ogp", (3168, 4308)).build(),
            ],
        );
        assert_eq!(
            check_movement(Stage::TobVerzik, &party, &timeline),
            vec![ConsistencyIssue::LargeJump {
                player: "1Ogp".to_string(),
                tick: 1,
                last_tick: 0,
                start: (3168, 4312).into(),
                end: (3168, 4308).into(),
            }],
        );
    }

    #[test]
    fn movement_permits_verzik_webs_push_within_three_ticks_of_the_attack() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            5,
            vec![
                verzik_p3_update(1),
                verzik_webs_attack(1),
                verzik_p3_update(3),
                fixtures::PlayerUpdateEvent::new(3, Stage::TobVerzik, "1Ogp", (3168, 4312)).build(),
                fixtures::PlayerUpdateEvent::new(4, Stage::TobVerzik, "1Ogp", (3168, 4308)).build(),
            ],
        );
        assert_eq!(check_movement(Stage::TobVerzik, &party, &timeline), vec![]);
    }

    #[test]
    fn movement_flags_verzik_webs_push_more_than_three_ticks_after_the_attack() {
        let party = vec!["1Ogp".to_string()];
        let timeline = fixtures::timeline(
            &party,
            6,
            vec![
                verzik_p3_update(0),
                verzik_webs_attack(0),
                verzik_p3_update(4),
                fixtures::PlayerUpdateEvent::new(4, Stage::TobVerzik, "1Ogp", (3168, 4312)).build(),
                fixtures::PlayerUpdateEvent::new(5, Stage::TobVerzik, "1Ogp", (3168, 4308)).build(),
            ],
        );
        assert_eq!(
            check_movement(Stage::TobVerzik, &party, &timeline),
            vec![ConsistencyIssue::LargeJump {
                player: "1Ogp".to_string(),
                tick: 5,
                last_tick: 4,
                start: (3168, 4312).into(),
                end: (3168, 4308).into(),
            }],
        );
    }

    #[test]
    fn bloat_permits_normal_cycle() {
        let timeline = fixtures::timeline(
            &[],
            150,
            vec![
                fixtures::bloat_down_event(41, (3299, 4440), 1, 41),
                fixtures::bloat_up_event(73),
                fixtures::bloat_down_event(107, (3291, 4451), 2, 34),
                fixtures::bloat_up_event(139),
            ],
        );
        assert_eq!(check_bloat(&timeline), Ok(vec![]));
    }

    #[test]
    fn bloat_flags_consecutive_downs() {
        let timeline = fixtures::timeline(
            &[],
            110,
            vec![
                fixtures::bloat_down_event(41, (3299, 4440), 1, 41),
                fixtures::bloat_down_event(107, (3291, 4451), 2, 34),
            ],
        );
        assert_eq!(
            check_bloat(&timeline),
            Ok(vec![ConsistencyIssue::InvalidEventSequence {
                kind: event::Type::TobBloatDown,
                tick: 107,
            }]),
        );
    }

    #[test]
    fn bloat_flags_up_without_a_down() {
        let timeline = fixtures::timeline(&[], 80, vec![fixtures::bloat_up_event(73)]);
        assert_eq!(
            check_bloat(&timeline),
            Ok(vec![ConsistencyIssue::InvalidEventSequence {
                kind: event::Type::TobBloatUp,
                tick: 73,
            }]),
        );
    }

    #[test]
    fn bloat_returns_bad_data_for_down_and_up_on_one_tick() {
        let timeline = fixtures::timeline(
            &[],
            80,
            vec![
                fixtures::bloat_down_event(41, (3299, 4440), 1, 41),
                fixtures::bloat_up_event(41),
                fixtures::bloat_up_event(73),
            ],
        );
        assert!(matches!(
            check_bloat(&timeline),
            Err(BadData::Inconsistent { tick: 41, .. }),
        ));
    }

    fn nylo_wave_spawn(tick: u32, wave: u32) -> Event {
        fixtures::nylo_wave_event(event::Type::TobNyloWaveSpawn, tick, wave, 3, 12)
    }

    #[test]
    fn nylo_permits_wave_spawns_at_natural_pace() {
        let timeline = fixtures::timeline(
            &[],
            12,
            vec![
                nylo_wave_spawn(4, 1),
                nylo_wave_spawn(8, 2),
                nylo_wave_spawn(12, 3),
            ],
        );
        assert_eq!(
            check_nylocas(ChallengeMode::TobRegular, &timeline),
            Ok(vec![]),
        );
    }

    #[test]
    fn nylo_flags_wave_spawning_too_soon() {
        let timeline =
            fixtures::timeline(&[], 6, vec![nylo_wave_spawn(4, 1), nylo_wave_spawn(6, 2)]);
        assert_eq!(
            check_nylocas(ChallengeMode::TobRegular, &timeline),
            Ok(vec![ConsistencyIssue::InvalidTickGap {
                kind: event::Type::TobNyloWaveSpawn,
                tick: 6,
                observed: 2,
                min: 4,
            }]),
        );
    }

    #[test]
    fn nylo_checks_missed_wave_events_against_cumulative_natural_stall() {
        let timeline =
            fixtures::timeline(&[], 22, vec![nylo_wave_spawn(4, 1), nylo_wave_spawn(20, 5)]);
        assert_eq!(
            check_nylocas(ChallengeMode::TobRegular, &timeline),
            Ok(vec![]),
        );

        let timeline =
            fixtures::timeline(&[], 22, vec![nylo_wave_spawn(4, 1), nylo_wave_spawn(19, 5)]);
        assert_eq!(
            check_nylocas(ChallengeMode::TobRegular, &timeline),
            Ok(vec![ConsistencyIssue::InvalidTickGap {
                kind: event::Type::TobNyloWaveSpawn,
                tick: 19,
                observed: 15,
                min: 16,
            }]),
        );
    }

    #[test]
    fn nylo_accounts_for_hmt_prince_waves() {
        let timeline = fixtures::timeline(
            &[],
            20,
            vec![nylo_wave_spawn(0, 10), nylo_wave_spawn(16, 11)],
        );
        assert_eq!(check_nylocas(ChallengeMode::TobHard, &timeline), Ok(vec![]));

        let timeline = fixtures::timeline(
            &[],
            15,
            vec![nylo_wave_spawn(0, 10), nylo_wave_spawn(10, 11)],
        );
        assert_eq!(
            check_nylocas(ChallengeMode::TobHard, &timeline),
            Ok(vec![ConsistencyIssue::InvalidTickGap {
                kind: event::Type::TobNyloWaveSpawn,
                tick: 10,
                observed: 10,
                min: 16,
            }]),
        );
    }

    #[test]
    fn nylo_returns_bad_data_for_out_of_order_waves() {
        let timeline =
            fixtures::timeline(&[], 10, vec![nylo_wave_spawn(0, 3), nylo_wave_spawn(4, 1)]);
        assert!(matches!(
            check_nylocas(ChallengeMode::TobRegular, &timeline),
            Err(BadData::Inconsistent { tick: 4, .. }),
        ));
    }

    #[test]
    fn nylo_returns_bad_data_for_duplicate_waves() {
        let timeline =
            fixtures::timeline(&[], 10, vec![nylo_wave_spawn(4, 1), nylo_wave_spawn(8, 1)]);
        assert!(matches!(
            check_nylocas(ChallengeMode::TobRegular, &timeline),
            Err(BadData::Inconsistent { tick: 8, .. }),
        ));
    }

    #[test]
    fn nylo_returns_bad_data_for_invalid_waves() {
        let timeline = fixtures::timeline(&[], 3, vec![nylo_wave_spawn(0, 32)]);
        assert_eq!(
            check_nylocas(ChallengeMode::TobRegular, &timeline),
            Err(BadData::MalformedEvent(MalformedEvent::OutOfDomain {
                kind: event::Type::TobNyloWaveSpawn,
                tick: 0,
                field: "nylo_wave.wave",
                value: "32".to_string(),
            })),
        );

        let timeline = fixtures::timeline(&[], 3, vec![nylo_wave_spawn(0, 0)]);
        assert_eq!(
            check_nylocas(ChallengeMode::TobRegular, &timeline),
            Err(BadData::MalformedEvent(MalformedEvent::OutOfDomain {
                kind: event::Type::TobNyloWaveSpawn,
                tick: 0,
                field: "nylo_wave.wave",
                value: "0".to_string(),
            })),
        );
    }
}

//! Cursory consistency checks over a client's recorded events for a stage,
//! looking for obvious indications of tick loss.
//!
//! Lag detection in the general case is impossible. The absence of issues
//! does not imply that a timeline is of high quality.

use blert::proto::event;
use blert::{
    Actor, EventKind, NpcAttack, NpcAttacked, NyloWave, PartyIndex, Point, RoomId, Stage, Tick,
    Ticks, Timeline, npc,
};

use crate::lifecycle::core::types::{ChallengeType, StageExt};

use super::BadData;
use super::world;

pub(super) const MAX_RECORDED_TICK: Tick = Tick(36_000); // six hour logout timer

/// A problem detected in a client's events.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConsistencyIssue {
    /// A player moved an impossibly large distance.
    LargeJump {
        player: PartyIndex,
        tick: Tick,
        last_tick: Tick,
        start: Point,
        end: Point,
    },
    /// Events arrived in an order inconsistent with the mechanics of a fight.
    InvalidEventSequence { kind: event::Type, tick: Tick },
    /// Consecutive events occurred closer than the game allows.
    InvalidTickGap {
        kind: event::Type,
        tick: Tick,
        observed: Ticks,
        min: Ticks,
    },
}

impl ConsistencyIssue {
    /// The tick on which the issue occurred.
    pub fn tick(&self) -> Tick {
        match self {
            ConsistencyIssue::LargeJump { tick, .. }
            | ConsistencyIssue::InvalidEventSequence { tick, .. }
            | ConsistencyIssue::InvalidTickGap { tick, .. } => *tick,
        }
    }
}

/// Checks a client's timeline for consistency issues.
pub(super) fn check(timeline: &Timeline) -> Result<Vec<ConsistencyIssue>, BadData> {
    let mut issues = MovementChecker { timeline }.check();
    match timeline.stage() {
        Stage::TobBloat => issues.extend(check_bloat(timeline)?),
        Stage::TobNylocas => issues.extend(check_nylocas(timeline)?),
        _ => {}
    }
    Ok(issues)
}

fn find_npc_attack(
    timeline: &Timeline,
    tick: Tick,
    id_matches: impl Fn(u32) -> bool,
    kind: NpcAttack,
) -> Option<&NpcAttacked> {
    timeline.get_state(tick).and_then(|state| {
        state.events.iter().find_map(|event| match &event.kind {
            EventKind::NpcAttack(attack)
                if attack.attack == kind
                    && state
                        .npcs
                        .get(&attack.npc)
                        .is_some_and(|npc| id_matches(npc.id)) =>
            {
                Some(attack)
            }
            _ => None,
        })
    })
}

struct MovementChecker<'t> {
    timeline: &'t Timeline,
}

impl MovementChecker<'_> {
    fn check(&self) -> Vec<ConsistencyIssue> {
        let mut issues = Vec::new();
        let party_size = self.timeline.party().len();
        let mut last_seen: Vec<Option<(Tick, Point)>> = vec![None; party_size];
        let mut dead = vec![false; party_size];

        for tick in Tick(0).through(self.timeline.last_tick()) {
            for event in self.timeline.events_for_tick(tick) {
                if let EventKind::PlayerDeath(player) = event.kind {
                    dead[player.as_usize()] = true;
                }
            }
            let Some(state) = self.timeline.get_state(tick) else {
                continue;
            };

            for (player, player_state) in state.players.iter() {
                let index = player.as_usize();
                if let Some((last_tick, last_position)) = last_seen[index] {
                    let delta = tick - last_tick;
                    // Players can move at most 2 tiles per tick.
                    let max_distance = 2 * delta.0;
                    let jumped = !dead[index]
                        && u32::from(last_position.distance(player_state.position)) > max_distance
                        && !self.is_special_teleport(
                            tick,
                            player,
                            last_position,
                            player_state.position,
                            delta,
                        );
                    if jumped {
                        issues.push(ConsistencyIssue::LargeJump {
                            player,
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

    /// Checks if `player` moving between `last` and `current` over `delta` ticks
    /// is explainable by a boss mechanic or teleport.
    fn is_special_teleport(
        &self,
        tick: Tick,
        player: PartyIndex,
        last: Point,
        current: Point,
        delta: Ticks,
    ) -> bool {
        let stage = self.timeline.stage();
        if world::is_in_death_area(stage, current) {
            return true;
        }

        match stage.challenge_type() {
            Some(ChallengeType::Colosseum) => {
                // During the cutscene at the start of the boss fight, players
                // remain on their original tile, then are teleported to the
                // fight start tile when the cutscene ends.
                stage == Stage::ColosseumWave12
                    && tick < Tick(5)
                    && current == world::COLOSSEUM_BOSS_START_TILE
            }
            Some(ChallengeType::Tob) => match stage {
                Stage::TobSotetseg => Self::check_sotetseg_teleport(last, current, delta),
                Stage::TobVerzik => self.check_verzik_teleport(tick, player, last, current, delta),
                // Maiden, Bloat, Nylocas, and Xarpus have no special teleports.
                _ => false,
            },
            // Not yet supported.
            Some(ChallengeType::Cox | ChallengeType::Toa | ChallengeType::Tfa) => {
                unimplemented!("hello implementer fill this in")
            }
            Some(
                ChallengeType::UnknownChallenge | ChallengeType::Inferno | ChallengeType::Mokhaiotl,
            )
            | None => false,
        }
    }

    fn check_sotetseg_teleport(last: Point, current: Point, delta: Ticks) -> bool {
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
        delta == 1
            && world::SOTETSEG_ROOM_AREA.contains(last)
            && current == world::SOTETSEG_OVERWORLD_MAZE_START_TILE
    }

    fn check_verzik_teleport(
        &self,
        tick: Tick,
        player: PartyIndex,
        last: Point,
        current: Point,
        delta: Ticks,
    ) -> bool {
        if delta != 1 {
            return false;
        }

        // Check the previous tick's NPC because a bounce can happen right on
        // a phase transition.
        let verzik = self
            .timeline
            .get_state(tick.pred())
            .and_then(|state| state.npcs.iter().find(|(_, npc)| npc::is_verzik(npc.id)));
        let Some((&verzik_room_id, verzik)) = verzik else {
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
        verzik_room_id: RoomId,
        tick: Tick,
        player: PartyIndex,
        last: Point,
        current: Point,
    ) -> bool {
        // Verzik's bounce pushes a player away from under or adjacent to her.
        if !world::VERZIK_P2_BOUNCEABLE_AREA.contains(last)
            || !world::is_valid_p2_bounce_destination(current)
        {
            return false;
        }

        let potential_bounce_tick = tick.pred();

        let find_bounce_attack = |t: Tick| {
            find_npc_attack(
                self.timeline,
                t,
                npc::is_verzik_p2,
                NpcAttack::TobVerzikP2Bounce,
            )
        };
        let attack = find_bounce_attack(potential_bounce_tick).or_else(|| find_bounce_attack(tick));

        if let Some(Actor::Player(bounced)) = attack.and_then(|attack| attack.target) {
            return bounced == player;
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
            .get_state(tick.succ())
            .and_then(|state| state.npcs.get(&verzik_room_id))
            .is_some_and(|npc| npc::is_verzik_p3_transition(npc.id));

        if !is_at_p3_transition && attack.is_none() {
            return false;
        }

        let (Some(curr), Some(prev)) = (
            self.timeline.get_state(tick),
            self.timeline.get_state(potential_bounce_tick),
        ) else {
            return false;
        };

        let mut bounce_like_movements = 0;
        let mut player_was_bounced = false;

        for (index, curr) in curr.players.iter() {
            let Some(prev) = prev.players.get(index) else {
                continue;
            };

            if world::VERZIK_P2_BOUNCEABLE_AREA.contains(prev.position)
                && world::is_valid_p2_bounce_destination(curr.position)
            {
                bounce_like_movements += 1;
                if index == player {
                    player_was_bounced = true;
                }
            }
        }

        player_was_bounced && bounce_like_movements == 1
    }

    fn check_for_p3_webs_push(&self, tick: Tick, last: Point, current: Point) -> bool {
        // When webs starts, players under Verzik are pushed directly outside
        // of her area.
        let is_webs = (tick - Ticks(3)).through(tick).any(|t| {
            find_npc_attack(
                self.timeline,
                t,
                npc::is_verzik_p3,
                NpcAttack::TobVerzikP3Webs,
            )
            .is_some()
        });

        is_webs
            && world::VERZIK_P3_WEBS_AREA.contains(last)
            && world::is_valid_p3_webs_push_destination(current)
    }
}

fn check_bloat(timeline: &Timeline) -> Result<Vec<ConsistencyIssue>, BadData> {
    let mut issues = Vec::new();
    let mut is_down = false;

    for tick in Tick(0).through(timeline.last_tick()) {
        let events = timeline.events_for_tick(tick);
        let down = events
            .iter()
            .any(|event| matches!(event.kind, EventKind::BloatDown(_)));
        let up = events
            .iter()
            .any(|event| matches!(event.kind, EventKind::BloatUp));

        if down && up {
            return Err(BadData::Inconsistent {
                tick,
                message: "Bloat down and up events on the same tick".to_string(),
            });
        }

        if down {
            if is_down {
                issues.push(ConsistencyIssue::InvalidEventSequence {
                    kind: event::Type::TobBloatDown,
                    tick,
                });
            }
            is_down = true;
        } else if up {
            if !is_down {
                issues.push(ConsistencyIssue::InvalidEventSequence {
                    kind: event::Type::TobBloatUp,
                    tick,
                });
            }
            is_down = false;
        }
    }

    Ok(issues)
}

fn check_nylocas(timeline: &Timeline) -> Result<Vec<ConsistencyIssue>, BadData> {
    let mut issues = Vec::new();
    let mut last_wave = 0;
    let mut last_spawn_tick = Tick(0);

    for (tick, event) in timeline.events() {
        let EventKind::NyloWaveSpawn(NyloWave { wave, .. }) = event.kind else {
            continue;
        };

        if last_wave > 0 {
            if wave <= last_wave {
                return Err(BadData::Inconsistent {
                    tick,
                    message: format!("Nylocas wave {wave} after wave {last_wave}"),
                });
            }

            let delta = tick - last_spawn_tick;
            let min = (last_wave..wave)
                .map(|wave| NyloWave::natural_stall(timeline.mode(), wave))
                .sum();
            if delta < min {
                issues.push(ConsistencyIssue::InvalidTickGap {
                    kind: event::Type::TobNyloWaveSpawn,
                    tick,
                    observed: delta,
                    min,
                });
            }
        }

        last_spawn_tick = tick;
        last_wave = wave;
    }

    Ok(issues)
}

#[cfg(test)]
mod tests {
    use blert::proto::Event;
    use blert::{ChallengeMode, Rsn};

    use super::*;
    use crate::merging::fixtures;

    #[test]
    fn movement_permits_up_to_two_tiles_per_tick() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            &party,
            Tick(3),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobMaiden, "1Ogp", (3184, 4447))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(1), Stage::TobMaiden, "1Ogp", (3182, 4446))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(2), Stage::TobMaiden, "1Ogp", (3180, 4445))
                    .build(),
            ],
        );
        assert_eq!(check(&timeline), Ok(vec![]));
    }

    #[test]
    fn movement_flags_greater_than_two_tiles() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            &party,
            Tick(2),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobMaiden, "1Ogp", (3184, 4447))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(1), Stage::TobMaiden, "1Ogp", (3174, 4447))
                    .build(),
            ],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::LargeJump {
                player: timeline.party_index(&party[0]).unwrap(),
                tick: Tick(1),
                last_tick: Tick(0),
                start: Point(3184, 4447),
                end: Point(3174, 4447),
            }]),
        );
    }

    #[test]
    fn movement_distance_scales_with_the_tick_gap() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            &party,
            Tick(6),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobMaiden, "1Ogp", (3184, 4447))
                    .build(),
                // valid
                fixtures::PlayerUpdateEvent::new(Tick(3), Stage::TobMaiden, "1Ogp", (3178, 4447))
                    .build(),
                // invalid
                fixtures::PlayerUpdateEvent::new(Tick(5), Stage::TobMaiden, "1Ogp", (3184, 4447))
                    .build(),
            ],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::LargeJump {
                player: timeline.party_index(&party[0]).unwrap(),
                tick: Tick(5),
                last_tick: Tick(3),
                start: Point(3178, 4447),
                end: Point(3184, 4447),
            }]),
        );
    }

    #[test]
    fn movement_ignores_dead_players() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            &party,
            Tick(3),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobMaiden, "1Ogp", (3184, 4447))
                    .build(),
                fixtures::player_death_event(Tick(1), Stage::TobMaiden, (3177, 4440), "1Ogp", 0),
                fixtures::PlayerUpdateEvent::new(Tick(2), Stage::TobMaiden, "1Ogp", (3170, 4460))
                    .build(),
            ],
        );
        assert_eq!(check(&timeline), Ok(vec![]));
    }

    #[test]
    fn movement_tracks_each_player() {
        let party = vec![
            Rsn::try_from("1Ogp").unwrap(),
            Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
        ];
        let timeline = fixtures::timeline(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            &party,
            Tick(2),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobMaiden, "1Ogp", (3184, 4447))
                    .build(),
                fixtures::PlayerUpdateEvent::new(
                    Tick(0),
                    Stage::TobMaiden,
                    "WWWWWWWWWWQQ",
                    (3184, 4445),
                )
                .build(),
                fixtures::PlayerUpdateEvent::new(Tick(1), Stage::TobMaiden, "1Ogp", (3183, 4446))
                    .build(),
                fixtures::PlayerUpdateEvent::new(
                    Tick(1),
                    Stage::TobMaiden,
                    "WWWWWWWWWWQQ",
                    (3172, 4445),
                )
                .build(),
            ],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::LargeJump {
                player: timeline.party_index(&party[1]).unwrap(),
                tick: Tick(1),
                last_tick: Tick(0),
                start: Point(3184, 4445),
                end: Point(3172, 4445),
            }]),
        );
    }

    #[test]
    fn movement_unconditionally_flags_in_stages_without_special_teleports() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let stages = [
            (Stage::TobMaiden, ChallengeMode::TobRegular, (3184, 4447)),
            (Stage::InfernoWave1, ChallengeMode::NoMode, (2273, 5353)),
            (Stage::ColosseumWave2, ChallengeMode::NoMode, (1815, 3110)),
            (Stage::MokhaiotlDelve3, ChallengeMode::NoMode, (3423, 6433)),
            (Stage::UnknownStage, ChallengeMode::NoMode, (3184, 4447)),
        ];
        for (stage, mode, start) in stages {
            let end = (start.0 + 10, start.1);
            let timeline = fixtures::timeline(
                stage,
                mode,
                &party,
                Tick(2),
                vec![
                    fixtures::PlayerUpdateEvent::new(Tick(0), stage, "1Ogp", start).build(),
                    fixtures::PlayerUpdateEvent::new(Tick(1), stage, "1Ogp", end).build(),
                ],
            );
            let point =
                |(x, y): (i32, i32)| Point(u16::try_from(x).unwrap(), u16::try_from(y).unwrap());
            assert_eq!(
                check(&timeline),
                Ok(vec![ConsistencyIssue::LargeJump {
                    player: timeline.party_index(&party[0]).unwrap(),
                    tick: Tick(1),
                    last_tick: Tick(0),
                    start: point(start),
                    end: point(end),
                }]),
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
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        for (stage, start, end) in cases {
            let timeline = fixtures::timeline(
                stage,
                ChallengeMode::TobRegular,
                &party,
                Tick(2),
                vec![
                    fixtures::PlayerUpdateEvent::new(Tick(0), stage, "1Ogp", start).build(),
                    fixtures::PlayerUpdateEvent::new(Tick(1), stage, "1Ogp", end).build(),
                ],
            );
            assert_eq!(check(&timeline), Ok(vec![]), "stage {stage:?}");
        }
    }

    #[test]
    fn movement_permits_colosseum_boss_start_teleport() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::ColosseumWave12,
            ChallengeMode::NoMode,
            &party,
            Tick(5),
            vec![
                fixtures::PlayerUpdateEvent::new(
                    Tick(3),
                    Stage::ColosseumWave12,
                    "1Ogp",
                    (1819, 3118),
                )
                .build(),
                fixtures::PlayerUpdateEvent::new(
                    Tick(4),
                    Stage::ColosseumWave12,
                    "1Ogp",
                    (1825, 3103),
                )
                .build(),
            ],
        );
        assert_eq!(check(&timeline), Ok(vec![]));
    }

    #[test]
    fn movement_flags_colosseum_boss_start_teleport_after_start() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::ColosseumWave12,
            ChallengeMode::NoMode,
            &party,
            Tick(6),
            vec![
                fixtures::PlayerUpdateEvent::new(
                    Tick(4),
                    Stage::ColosseumWave12,
                    "1Ogp",
                    (1819, 3118),
                )
                .build(),
                fixtures::PlayerUpdateEvent::new(
                    Tick(5),
                    Stage::ColosseumWave12,
                    "1Ogp",
                    (1825, 3103),
                )
                .build(),
            ],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::LargeJump {
                player: timeline.party_index(&party[0]).unwrap(),
                tick: Tick(5),
                last_tick: Tick(4),
                start: Point(1819, 3118),
                end: Point(1825, 3103),
            }]),
        );
    }

    #[test]
    fn movement_flags_colosseum_teleport_to_non_start_tiles() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::ColosseumWave12,
            ChallengeMode::NoMode,
            &party,
            Tick(5),
            vec![
                fixtures::PlayerUpdateEvent::new(
                    Tick(3),
                    Stage::ColosseumWave12,
                    "1Ogp",
                    (1819, 3118),
                )
                .build(),
                fixtures::PlayerUpdateEvent::new(
                    Tick(4),
                    Stage::ColosseumWave12,
                    "1Ogp",
                    (1817, 3103),
                )
                .build(),
            ],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::LargeJump {
                player: timeline.party_index(&party[0]).unwrap(),
                tick: Tick(4),
                last_tick: Tick(3),
                start: Point(1819, 3118),
                end: Point(1817, 3103),
            }]),
        );
    }

    #[test]
    fn movement_flags_colosseum_jumps_in_earlier_waves() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        for value in (Stage::ColosseumWave1 as i32)..=(Stage::ColosseumWave11 as i32) {
            let stage = Stage::try_from(value).expect("colosseum wave stages are contiguous");
            let timeline = fixtures::timeline(
                stage,
                ChallengeMode::NoMode,
                &party,
                Tick(2),
                vec![
                    fixtures::PlayerUpdateEvent::new(Tick(0), stage, "1Ogp", (1815, 3110)).build(),
                    fixtures::PlayerUpdateEvent::new(Tick(1), stage, "1Ogp", (1825, 3103)).build(),
                ],
            );
            assert_eq!(
                check(&timeline),
                Ok(vec![ConsistencyIssue::LargeJump {
                    player: timeline.party_index(&party[0]).unwrap(),
                    tick: Tick(1),
                    last_tick: Tick(0),
                    start: Point(1815, 3110),
                    end: Point(1825, 3103),
                }]),
                "stage {stage:?}",
            );
        }
    }

    #[test]
    fn movement_permits_sotetseg_maze_start_teleport() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobSotetseg,
            ChallengeMode::TobRegular,
            &party,
            Tick(2),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobSotetseg, "1Ogp", (3275, 4310))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(1), Stage::TobSotetseg, "1Ogp", (3274, 4307))
                    .build(),
            ],
        );
        assert_eq!(check(&timeline), Ok(vec![]));
    }

    #[test]
    fn movement_permits_sotetseg_room_to_underworld_teleport() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobSotetseg,
            ChallengeMode::TobRegular,
            &party,
            Tick(2),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobSotetseg, "1Ogp", (3280, 4320))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(1), Stage::TobSotetseg, "1Ogp", (3360, 4315))
                    .build(),
            ],
        );
        assert_eq!(check(&timeline), Ok(vec![]));
    }

    #[test]
    fn movement_permits_sotetseg_underworld_to_room_teleport() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobSotetseg,
            ChallengeMode::TobRegular,
            &party,
            Tick(8),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobSotetseg, "1Ogp", (3360, 4315))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(7), Stage::TobSotetseg, "1Ogp", (3275, 4310))
                    .build(),
            ],
        );
        assert_eq!(check(&timeline), Ok(vec![]));
    }

    #[test]
    fn movement_permits_sotetseg_underworld_teleport_over_multiple_ticks() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobSotetseg,
            ChallengeMode::TobRegular,
            &party,
            Tick(6),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobSotetseg, "1Ogp", (3275, 4310))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(5), Stage::TobSotetseg, "1Ogp", (3360, 4315))
                    .build(),
            ],
        );
        assert_eq!(check(&timeline), Ok(vec![]));
    }

    #[test]
    fn movement_flags_sotetseg_jumps_to_non_maze_tiles() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobSotetseg,
            ChallengeMode::TobRegular,
            &party,
            Tick(2),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobSotetseg, "1Ogp", (3275, 4310))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(1), Stage::TobSotetseg, "1Ogp", (3300, 4350))
                    .build(),
            ],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::LargeJump {
                player: timeline.party_index(&party[0]).unwrap(),
                tick: Tick(1),
                last_tick: Tick(0),
                start: Point(3275, 4310),
                end: Point(3300, 4350),
            }]),
        );
    }

    #[test]
    fn movement_flags_sotetseg_maze_start_teleport_across_multiple_ticks() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobSotetseg,
            ChallengeMode::TobRegular,
            &party,
            Tick(3),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobSotetseg, "1Ogp", (3275, 4312))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(2), Stage::TobSotetseg, "1Ogp", (3274, 4307))
                    .build(),
            ],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::LargeJump {
                player: timeline.party_index(&party[0]).unwrap(),
                tick: Tick(2),
                last_tick: Tick(0),
                start: Point(3275, 4312),
                end: Point(3274, 4307),
            }]),
        );
    }

    #[test]
    fn movement_flags_verzik_jumps_if_verzik_is_missing() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobVerzik,
            ChallengeMode::TobRegular,
            &party,
            Tick(2),
            vec![
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobVerzik, "1Ogp", (3168, 4313))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(1), Stage::TobVerzik, "1Ogp", (3168, 4309))
                    .build(),
            ],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::LargeJump {
                player: timeline.party_index(&party[0]).unwrap(),
                tick: Tick(1),
                last_tick: Tick(0),
                start: Point(3168, 4313),
                end: Point(3168, 4309),
            }]),
        );
    }

    fn verzik_p2_spawn() -> Event {
        fixtures::npc_spawn_event(fixtures::NpcEvent {
            tick: Tick(0),
            stage: Stage::TobVerzik,
            coords: (3167, 4313),
            npc_id: npc::id::VERZIK_P2_REGULAR,
            room_id: 57001,
            ..Default::default()
        })
    }

    #[test]
    fn movement_permits_verzik_bounce() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobVerzik,
            ChallengeMode::TobRegular,
            &party,
            Tick(2),
            vec![
                verzik_p2_spawn(),
                fixtures::npc_attack_event(
                    Tick(0),
                    Stage::TobVerzik,
                    (3168, 4314),
                    npc::id::VERZIK_P2_REGULAR,
                    57001,
                    NpcAttack::TobVerzikP2Bounce,
                    None,
                ),
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobVerzik, "1Ogp", (3168, 4313))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(1), Stage::TobVerzik, "1Ogp", (3168, 4309))
                    .build(),
                fixtures::verzik_bounce_event(Tick(1), Tick(0), 1, 0, Some("1Ogp")),
            ],
        );
        assert_eq!(check(&timeline), Ok(vec![]));
    }

    #[test]
    fn movement_permits_verzik_bounce_from_corner() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobVerzik,
            ChallengeMode::TobRegular,
            &party,
            Tick(2),
            vec![
                verzik_p2_spawn(),
                fixtures::npc_attack_event(
                    Tick(0),
                    Stage::TobVerzik,
                    (3168, 4314),
                    npc::id::VERZIK_P2_REGULAR,
                    57001,
                    NpcAttack::TobVerzikP2Bounce,
                    None,
                ),
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobVerzik, "1Ogp", (3167, 4313))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(1), Stage::TobVerzik, "1Ogp", (3162, 4308))
                    .build(),
                fixtures::verzik_bounce_event(Tick(1), Tick(0), 1, 0, Some("1Ogp")),
            ],
        );
        assert_eq!(check(&timeline), Ok(vec![]));
    }

    #[test]
    fn movement_permits_verzik_bounce_at_the_end_of_p2() {
        let party = vec![
            Rsn::try_from("1Ogp").unwrap(),
            Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
        ];
        let timeline = fixtures::timeline(
            Stage::TobVerzik,
            ChallengeMode::TobRegular,
            &party,
            Tick(3),
            vec![
                verzik_p2_spawn(),
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobVerzik, "1Ogp", (3168, 4313))
                    .build(),
                fixtures::PlayerUpdateEvent::new(
                    Tick(0),
                    Stage::TobVerzik,
                    "WWWWWWWWWWQQ",
                    (3160, 4310),
                )
                .build(),
                fixtures::PlayerUpdateEvent::new(Tick(1), Stage::TobVerzik, "1Ogp", (3168, 4309))
                    .build(),
                fixtures::PlayerUpdateEvent::new(
                    Tick(1),
                    Stage::TobVerzik,
                    "WWWWWWWWWWQQ",
                    (3160, 4310),
                )
                .build(),
                fixtures::npc_update_event(fixtures::NpcEvent {
                    tick: Tick(2),
                    stage: Stage::TobVerzik,
                    coords: (3167, 4313),
                    npc_id: npc::id::VERZIK_P3_TRANSITION_REGULAR,
                    room_id: 57001,
                    ..Default::default()
                }),
            ],
        );
        assert_eq!(check(&timeline), Ok(vec![]));
    }

    #[test]
    fn movement_flags_verzik_bounce_like_movement_when_another_player_was_bounced() {
        let party = vec![
            Rsn::try_from("1Ogp").unwrap(),
            Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
        ];
        let timeline = fixtures::timeline(
            Stage::TobVerzik,
            ChallengeMode::TobRegular,
            &party,
            Tick(2),
            vec![
                verzik_p2_spawn(),
                fixtures::npc_attack_event(
                    Tick(0),
                    Stage::TobVerzik,
                    (3168, 4314),
                    npc::id::VERZIK_P2_REGULAR,
                    57001,
                    NpcAttack::TobVerzikP2Bounce,
                    None,
                ),
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobVerzik, "1Ogp", (3168, 4313))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(1), Stage::TobVerzik, "1Ogp", (3168, 4309))
                    .build(),
                fixtures::verzik_bounce_event(Tick(1), Tick(0), 1, 0, Some("WWWWWWWWWWQQ")),
            ],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::LargeJump {
                player: timeline.party_index(&party[0]).unwrap(),
                tick: Tick(1),
                last_tick: Tick(0),
                start: Point(3168, 4313),
                end: Point(3168, 4309),
            }]),
        );
    }

    #[test]
    fn movement_flags_verzik_p2_jumps_outside_of_bounce_area() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobVerzik,
            ChallengeMode::TobRegular,
            &party,
            Tick(2),
            vec![
                verzik_p2_spawn(),
                fixtures::npc_attack_event(
                    Tick(0),
                    Stage::TobVerzik,
                    (3168, 4314),
                    npc::id::VERZIK_P2_REGULAR,
                    57001,
                    NpcAttack::TobVerzikP2Bounce,
                    None,
                ),
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobVerzik, "1Ogp", (3168, 4305))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(1), Stage::TobVerzik, "1Ogp", (3168, 4309))
                    .build(),
                fixtures::verzik_bounce_event(Tick(1), Tick(0), 1, 0, Some("1Ogp")),
            ],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::LargeJump {
                player: timeline.party_index(&party[0]).unwrap(),
                tick: Tick(1),
                last_tick: Tick(0),
                start: Point(3168, 4305),
                end: Point(3168, 4309),
            }]),
        );
    }

    #[test]
    fn movement_flags_verzik_bounce_like_movement_over_multiple_ticks() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobVerzik,
            ChallengeMode::TobRegular,
            &party,
            Tick(3),
            vec![
                verzik_p2_spawn(),
                fixtures::npc_attack_event(
                    Tick(0),
                    Stage::TobVerzik,
                    (3168, 4314),
                    npc::id::VERZIK_P2_REGULAR,
                    57001,
                    NpcAttack::TobVerzikP2Bounce,
                    None,
                ),
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobVerzik, "1Ogp", (3168, 4313))
                    .build(),
                fixtures::verzik_bounce_event(Tick(1), Tick(0), 1, 0, Some("1Ogp")),
                fixtures::PlayerUpdateEvent::new(Tick(2), Stage::TobVerzik, "1Ogp", (3168, 4303))
                    .build(),
            ],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::LargeJump {
                player: timeline.party_index(&party[0]).unwrap(),
                tick: Tick(2),
                last_tick: Tick(0),
                start: Point(3168, 4313),
                end: Point(3168, 4303),
            }]),
        );
    }

    #[test]
    fn movement_permits_verzik_bounce_like_movements_following_a_bounce_attack() {
        let party = vec![
            Rsn::try_from("1Ogp").unwrap(),
            Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
        ];
        let timeline = fixtures::timeline(
            Stage::TobVerzik,
            ChallengeMode::TobRegular,
            &party,
            Tick(2),
            vec![
                verzik_p2_spawn(),
                fixtures::npc_attack_event(
                    Tick(0),
                    Stage::TobVerzik,
                    (3168, 4314),
                    npc::id::VERZIK_P2_REGULAR,
                    57001,
                    NpcAttack::TobVerzikP2Bounce,
                    None,
                ),
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobVerzik, "1Ogp", (3168, 4313))
                    .build(),
                fixtures::PlayerUpdateEvent::new(
                    Tick(0),
                    Stage::TobVerzik,
                    "WWWWWWWWWWQQ",
                    (3160, 4310),
                )
                .build(),
                fixtures::PlayerUpdateEvent::new(Tick(1), Stage::TobVerzik, "1Ogp", (3168, 4309))
                    .build(),
                fixtures::PlayerUpdateEvent::new(
                    Tick(1),
                    Stage::TobVerzik,
                    "WWWWWWWWWWQQ",
                    (3160, 4310),
                )
                .build(),
            ],
        );
        assert_eq!(check(&timeline), Ok(vec![]));
    }

    #[test]
    fn movement_flags_verzik_bounce_like_movement_without_an_attack() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobVerzik,
            ChallengeMode::TobRegular,
            &party,
            Tick(2),
            vec![
                verzik_p2_spawn(),
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobVerzik, "1Ogp", (3168, 4313))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(1), Stage::TobVerzik, "1Ogp", (3168, 4309))
                    .build(),
            ],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::LargeJump {
                player: timeline.party_index(&party[0]).unwrap(),
                tick: Tick(1),
                last_tick: Tick(0),
                start: Point(3168, 4313),
                end: Point(3168, 4309),
            }]),
        );
    }

    #[test]
    fn movement_flags_verzik_bounce_like_movements_for_multiple_players() {
        let party = vec![
            Rsn::try_from("1Ogp").unwrap(),
            Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
        ];
        let timeline = fixtures::timeline(
            Stage::TobVerzik,
            ChallengeMode::TobRegular,
            &party,
            Tick(2),
            vec![
                verzik_p2_spawn(),
                fixtures::npc_attack_event(
                    Tick(0),
                    Stage::TobVerzik,
                    (3168, 4314),
                    npc::id::VERZIK_P2_REGULAR,
                    57001,
                    NpcAttack::TobVerzikP2Bounce,
                    None,
                ),
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobVerzik, "1Ogp", (3168, 4313))
                    .build(),
                fixtures::PlayerUpdateEvent::new(
                    Tick(0),
                    Stage::TobVerzik,
                    "WWWWWWWWWWQQ",
                    (3169, 4313),
                )
                .build(),
                fixtures::PlayerUpdateEvent::new(Tick(1), Stage::TobVerzik, "1Ogp", (3168, 4309))
                    .build(),
                fixtures::PlayerUpdateEvent::new(
                    Tick(1),
                    Stage::TobVerzik,
                    "WWWWWWWWWWQQ",
                    (3173, 4314),
                )
                .build(),
            ],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![
                ConsistencyIssue::LargeJump {
                    player: timeline.party_index(&party[0]).unwrap(),
                    tick: Tick(1),
                    last_tick: Tick(0),
                    start: Point(3168, 4313),
                    end: Point(3168, 4309),
                },
                ConsistencyIssue::LargeJump {
                    player: timeline.party_index(&party[1]).unwrap(),
                    tick: Tick(1),
                    last_tick: Tick(0),
                    start: Point(3169, 4313),
                    end: Point(3173, 4314),
                },
            ]),
        );
    }

    fn verzik_p3_update(tick: Tick) -> Event {
        fixtures::npc_update_event(fixtures::NpcEvent {
            tick,
            stage: Stage::TobVerzik,
            coords: (3165, 4309),
            npc_id: npc::id::VERZIK_P3_REGULAR,
            room_id: 57001,
            ..Default::default()
        })
    }

    fn verzik_webs_attack(tick: Tick) -> Event {
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
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobVerzik,
            ChallengeMode::TobRegular,
            &party,
            Tick(2),
            vec![
                verzik_p3_update(Tick(0)),
                verzik_webs_attack(Tick(0)),
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobVerzik, "1Ogp", (3168, 4312))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(1), Stage::TobVerzik, "1Ogp", (3168, 4308))
                    .build(),
            ],
        );
        assert_eq!(check(&timeline), Ok(vec![]));
    }

    #[test]
    fn movement_flags_verzik_webs_push_to_an_invalid_tile() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobVerzik,
            ChallengeMode::TobRegular,
            &party,
            Tick(2),
            vec![
                verzik_p3_update(Tick(0)),
                verzik_webs_attack(Tick(0)),
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobVerzik, "1Ogp", (3168, 4312))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(1), Stage::TobVerzik, "1Ogp", (3168, 4307))
                    .build(),
            ],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::LargeJump {
                player: timeline.party_index(&party[0]).unwrap(),
                tick: Tick(1),
                last_tick: Tick(0),
                start: Point(3168, 4312),
                end: Point(3168, 4307),
            }]),
        );
    }

    #[test]
    fn movement_flags_verzik_p3_jumps_outside_of_webs_area() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobVerzik,
            ChallengeMode::TobRegular,
            &party,
            Tick(2),
            vec![
                verzik_p3_update(Tick(0)),
                verzik_webs_attack(Tick(0)),
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobVerzik, "1Ogp", (3160, 4310))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(1), Stage::TobVerzik, "1Ogp", (3168, 4308))
                    .build(),
            ],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::LargeJump {
                player: timeline.party_index(&party[0]).unwrap(),
                tick: Tick(1),
                last_tick: Tick(0),
                start: Point(3160, 4310),
                end: Point(3168, 4308),
            }]),
        );
    }

    #[test]
    fn movement_flags_verzik_webs_like_movement_without_an_attack() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobVerzik,
            ChallengeMode::TobRegular,
            &party,
            Tick(2),
            vec![
                verzik_p3_update(Tick(0)),
                fixtures::PlayerUpdateEvent::new(Tick(0), Stage::TobVerzik, "1Ogp", (3168, 4312))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(1), Stage::TobVerzik, "1Ogp", (3168, 4308))
                    .build(),
            ],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::LargeJump {
                player: timeline.party_index(&party[0]).unwrap(),
                tick: Tick(1),
                last_tick: Tick(0),
                start: Point(3168, 4312),
                end: Point(3168, 4308),
            }]),
        );
    }

    #[test]
    fn movement_permits_verzik_webs_push_within_three_ticks_of_the_attack() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobVerzik,
            ChallengeMode::TobRegular,
            &party,
            Tick(5),
            vec![
                verzik_p3_update(Tick(1)),
                verzik_webs_attack(Tick(1)),
                verzik_p3_update(Tick(3)),
                fixtures::PlayerUpdateEvent::new(Tick(3), Stage::TobVerzik, "1Ogp", (3168, 4312))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(4), Stage::TobVerzik, "1Ogp", (3168, 4308))
                    .build(),
            ],
        );
        assert_eq!(check(&timeline), Ok(vec![]));
    }

    #[test]
    fn movement_flags_verzik_webs_push_more_than_three_ticks_after_the_attack() {
        let party = vec![Rsn::try_from("1Ogp").unwrap()];
        let timeline = fixtures::timeline(
            Stage::TobVerzik,
            ChallengeMode::TobRegular,
            &party,
            Tick(6),
            vec![
                verzik_p3_update(Tick(0)),
                verzik_webs_attack(Tick(0)),
                verzik_p3_update(Tick(4)),
                fixtures::PlayerUpdateEvent::new(Tick(4), Stage::TobVerzik, "1Ogp", (3168, 4312))
                    .build(),
                fixtures::PlayerUpdateEvent::new(Tick(5), Stage::TobVerzik, "1Ogp", (3168, 4308))
                    .build(),
            ],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::LargeJump {
                player: timeline.party_index(&party[0]).unwrap(),
                tick: Tick(5),
                last_tick: Tick(4),
                start: Point(3168, 4312),
                end: Point(3168, 4308),
            }]),
        );
    }

    #[test]
    fn bloat_permits_normal_cycle() {
        let timeline = fixtures::timeline(
            Stage::TobBloat,
            ChallengeMode::TobRegular,
            &[],
            Tick(150),
            vec![
                fixtures::bloat_down_event(Tick(41), (3299, 4440), 1, Ticks(41)),
                fixtures::bloat_up_event(Tick(73)),
                fixtures::bloat_down_event(Tick(107), (3291, 4451), 2, Ticks(34)),
                fixtures::bloat_up_event(Tick(139)),
            ],
        );
        assert_eq!(check(&timeline), Ok(vec![]));
    }

    #[test]
    fn bloat_flags_consecutive_downs() {
        let timeline = fixtures::timeline(
            Stage::TobBloat,
            ChallengeMode::TobRegular,
            &[],
            Tick(110),
            vec![
                fixtures::bloat_down_event(Tick(41), (3299, 4440), 1, Ticks(41)),
                fixtures::bloat_down_event(Tick(107), (3291, 4451), 2, Ticks(34)),
            ],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::InvalidEventSequence {
                kind: event::Type::TobBloatDown,
                tick: Tick(107),
            }]),
        );
    }

    #[test]
    fn bloat_flags_up_without_a_down() {
        let timeline = fixtures::timeline(
            Stage::TobBloat,
            ChallengeMode::TobRegular,
            &[],
            Tick(80),
            vec![fixtures::bloat_up_event(Tick(73))],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::InvalidEventSequence {
                kind: event::Type::TobBloatUp,
                tick: Tick(73),
            }]),
        );
    }

    #[test]
    fn bloat_returns_bad_data_for_down_and_up_on_one_tick() {
        let timeline = fixtures::timeline(
            Stage::TobBloat,
            ChallengeMode::TobRegular,
            &[],
            Tick(80),
            vec![
                fixtures::bloat_down_event(Tick(41), (3299, 4440), 1, Ticks(41)),
                fixtures::bloat_up_event(Tick(41)),
                fixtures::bloat_up_event(Tick(73)),
            ],
        );
        assert_eq!(
            check(&timeline),
            Err(BadData::Inconsistent {
                tick: Tick(41),
                message: "Bloat down and up events on the same tick".to_string(),
            }),
        );
    }

    fn nylo_wave_spawn(tick: Tick, wave: u32) -> Event {
        fixtures::nylo_wave_event(event::Type::TobNyloWaveSpawn, tick, wave, 3, 12)
    }

    #[test]
    fn nylo_permits_wave_spawns_at_natural_pace() {
        let timeline = fixtures::timeline(
            Stage::TobNylocas,
            ChallengeMode::TobRegular,
            &[],
            Tick(12),
            vec![
                nylo_wave_spawn(Tick(4), 1),
                nylo_wave_spawn(Tick(8), 2),
                nylo_wave_spawn(Tick(12), 3),
            ],
        );
        assert_eq!(check(&timeline), Ok(vec![]));
    }

    #[test]
    fn nylo_flags_wave_spawning_too_soon() {
        let timeline = fixtures::timeline(
            Stage::TobNylocas,
            ChallengeMode::TobRegular,
            &[],
            Tick(6),
            vec![nylo_wave_spawn(Tick(4), 1), nylo_wave_spawn(Tick(6), 2)],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::InvalidTickGap {
                kind: event::Type::TobNyloWaveSpawn,
                tick: Tick(6),
                observed: Ticks(2),
                min: Ticks(4),
            }]),
        );
    }

    #[test]
    fn nylo_checks_missed_wave_events_against_cumulative_natural_stall() {
        let timeline = fixtures::timeline(
            Stage::TobNylocas,
            ChallengeMode::TobRegular,
            &[],
            Tick(22),
            vec![nylo_wave_spawn(Tick(4), 1), nylo_wave_spawn(Tick(20), 5)],
        );
        assert_eq!(check(&timeline), Ok(vec![]));

        let timeline = fixtures::timeline(
            Stage::TobNylocas,
            ChallengeMode::TobRegular,
            &[],
            Tick(22),
            vec![nylo_wave_spawn(Tick(4), 1), nylo_wave_spawn(Tick(19), 5)],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::InvalidTickGap {
                kind: event::Type::TobNyloWaveSpawn,
                tick: Tick(19),
                observed: Ticks(15),
                min: Ticks(16),
            }]),
        );
    }

    #[test]
    fn nylo_accounts_for_hmt_prince_waves() {
        let timeline = fixtures::timeline(
            Stage::TobNylocas,
            ChallengeMode::TobHard,
            &[],
            Tick(20),
            vec![nylo_wave_spawn(Tick(0), 10), nylo_wave_spawn(Tick(16), 11)],
        );
        assert_eq!(check(&timeline), Ok(vec![]));

        let timeline = fixtures::timeline(
            Stage::TobNylocas,
            ChallengeMode::TobHard,
            &[],
            Tick(15),
            vec![nylo_wave_spawn(Tick(0), 10), nylo_wave_spawn(Tick(10), 11)],
        );
        assert_eq!(
            check(&timeline),
            Ok(vec![ConsistencyIssue::InvalidTickGap {
                kind: event::Type::TobNyloWaveSpawn,
                tick: Tick(10),
                observed: Ticks(10),
                min: Ticks(16),
            }]),
        );
    }

    #[test]
    fn nylo_returns_bad_data_for_out_of_order_waves() {
        let timeline = fixtures::timeline(
            Stage::TobNylocas,
            ChallengeMode::TobRegular,
            &[],
            Tick(10),
            vec![nylo_wave_spawn(Tick(0), 3), nylo_wave_spawn(Tick(4), 1)],
        );
        assert_eq!(
            check(&timeline),
            Err(BadData::Inconsistent {
                tick: Tick(4),
                message: "Nylocas wave 1 after wave 3".to_string(),
            }),
        );
    }

    #[test]
    fn nylo_returns_bad_data_for_duplicate_waves() {
        let timeline = fixtures::timeline(
            Stage::TobNylocas,
            ChallengeMode::TobRegular,
            &[],
            Tick(10),
            vec![nylo_wave_spawn(Tick(4), 1), nylo_wave_spawn(Tick(8), 1)],
        );
        assert_eq!(
            check(&timeline),
            Err(BadData::Inconsistent {
                tick: Tick(8),
                message: "Nylocas wave 1 after wave 1".to_string(),
            }),
        );
    }
}

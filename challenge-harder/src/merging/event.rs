//! Event classification by merge policy.

use blert::proto::event;
use blert::{
    Actor, EventKind, NpcAttack, PartyIndex, PlayerAttack, Point, RoomId, SoteMazeEnd, Ticks,
};

use crate::lifecycle::core::types::ChallengeType;

/// The category of an event within the merger, determining its handling.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum Class {
    /// Event types from solo-only challenges that never have to be merged.
    /// They pass through the pipeline as-is.
    Solo,

    /// Event types derived from the final merged timeline rather than
    /// reconciled between clients.
    Derived,

    /// Event types representing per-tick game state. Consumed into tick state
    /// on ingest, merged tick by tick, and reconstructed afterwards.
    TickState,

    /// Event types that are temporally deduplicated between clients.
    Stream,

    /// Event types that augment a previous attack with additional context.
    /// Resolved by mapping them back to their attack in the merged timeline.
    AttackMapped,
}

pub const fn classify(kind: &EventKind) -> Class {
    match kind {
        EventKind::HandicapChoice(_)
        | EventKind::DoomApplied
        | EventKind::TotemHeal(_)
        | EventKind::SolDust(_)
        | EventKind::SolGrapple(_)
        | EventKind::SolPools(_)
        | EventKind::SolLasers(_)
        | EventKind::MokhaiotlOrb(_)
        | EventKind::MokhaiotlLarvaLeak(_) => Class::Solo,

        EventKind::NyloWaveStall(_) | EventKind::NyloCleanupEnd | EventKind::NyloBossSpawn => {
            Class::Derived
        }

        EventKind::PlayerAttack(_) | EventKind::PlayerSpell(_) | EventKind::NpcAttack(_) => {
            Class::TickState
        }

        EventKind::PlayerDeath(_)
        | EventKind::NpcDeath(_)
        | EventKind::MaidenCrabLeak(_)
        | EventKind::BloatDown(_)
        | EventKind::BloatUp
        | EventKind::BloatHandsDrop(_)
        | EventKind::BloatHandsSplat(_)
        | EventKind::NyloWaveSpawn(_)
        | EventKind::SoteMazeProc(_)
        | EventKind::SoteMazeEnd(_)
        | EventKind::XarpusPhase(_)
        | EventKind::XarpusExhumed(_)
        | EventKind::XarpusSplat(_)
        | EventKind::VerzikPhase(_)
        | EventKind::VerzikDawnDropped(_)
        | EventKind::VerzikDawnPickedUp(_)
        | EventKind::VerzikHeal(_) => Class::Stream,

        EventKind::VerzikDawnHit(_) | EventKind::VerzikBounce(_) => Class::AttackMapped,
    }
}

// TODO(frolv): Temporary mapping while the merger operates on events.
pub(super) const fn event_type(kind: &EventKind) -> event::Type {
    match kind {
        EventKind::PlayerDeath(_) => event::Type::PlayerDeath,
        EventKind::PlayerAttack(_) => event::Type::PlayerAttack,
        EventKind::PlayerSpell(_) => event::Type::PlayerSpell,
        EventKind::NpcDeath(_) => event::Type::NpcDeath,
        EventKind::NpcAttack(_) => event::Type::NpcAttack,

        EventKind::MaidenCrabLeak(_) => event::Type::TobMaidenCrabLeak,
        EventKind::BloatDown(_) => event::Type::TobBloatDown,
        EventKind::BloatUp => event::Type::TobBloatUp,
        EventKind::BloatHandsDrop(_) => event::Type::TobBloatHandsDrop,
        EventKind::BloatHandsSplat(_) => event::Type::TobBloatHandsSplat,
        EventKind::NyloWaveSpawn(_) => event::Type::TobNyloWaveSpawn,
        EventKind::NyloWaveStall(_) => event::Type::TobNyloWaveStall,
        EventKind::NyloCleanupEnd => event::Type::TobNyloCleanupEnd,
        EventKind::NyloBossSpawn => event::Type::TobNyloBossSpawn,
        EventKind::SoteMazeProc(_) => event::Type::TobSoteMazeProc,
        EventKind::SoteMazeEnd(_) => event::Type::TobSoteMazeEnd,
        EventKind::XarpusPhase(_) => event::Type::TobXarpusPhase,
        EventKind::XarpusExhumed(_) => event::Type::TobXarpusExhumed,
        EventKind::XarpusSplat(_) => event::Type::TobXarpusSplat,
        EventKind::VerzikPhase(_) => event::Type::TobVerzikPhase,
        EventKind::VerzikDawnDropped(_) | EventKind::VerzikDawnPickedUp(_) => {
            event::Type::TobVerzikDawnDrop
        }
        EventKind::VerzikDawnHit(_) => event::Type::TobVerzikDawn,
        EventKind::VerzikBounce(_) => event::Type::TobVerzikBounce,
        EventKind::VerzikHeal(_) => event::Type::TobVerzikHeal,

        EventKind::HandicapChoice(_) => event::Type::ColosseumHandicapChoice,
        EventKind::DoomApplied => event::Type::ColosseumDoomApplied,
        EventKind::TotemHeal(_) => event::Type::ColosseumTotemHeal,
        EventKind::SolDust(_) => event::Type::ColosseumSolDust,
        EventKind::SolGrapple(_) => event::Type::ColosseumSolGrapple,
        EventKind::SolPools(_) => event::Type::ColosseumSolPools,
        EventKind::SolLasers(_) => event::Type::ColosseumSolLasers,

        EventKind::MokhaiotlOrb(_) => event::Type::MokhaiotlOrb,
        EventKind::MokhaiotlLarvaLeak(_) => event::Type::MokhaiotlLarvaLeak,
    }
}

/// How a stream event's occurrences are matched between clients.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct StreamConfig {
    /// Maximum tick gap within which two events are considered the same.
    /// If `None`, the event is unique within the stage.
    pub temporal_window: Option<Ticks>,
    /// The tick gap between two paired occurrences above which the pair is
    /// flagged, or `None` to disable the signal.
    pub large_gap_threshold: Option<Ticks>,
}

impl StreamConfig {
    const fn new(temporal_window: Option<Ticks>, large_gap_threshold: Option<Ticks>) -> Self {
        Self {
            temporal_window,
            large_gap_threshold,
        }
    }
}

/// Tick window within which two deaths for a player are treated as one event in
/// a challenge with respawns. Must be configured below the minimum time for a
/// player to run back to the boss and die again so two genuine deaths are not
/// deduped.
const PLAYER_DEATH_RESPAWN_WINDOW: Ticks = Ticks(15);

/// Returns how a stream event type is matched between clients, or `None` for
/// non stream events.
pub(super) fn stream_config(challenge: ChallengeType, kind: event::Type) -> Option<StreamConfig> {
    #[allow(clippy::match_same_arms)]
    let config = match kind {
        event::Type::PlayerDeath => StreamConfig::new(
            match challenge {
                ChallengeType::Cox => Some(PLAYER_DEATH_RESPAWN_WINDOW),
                ChallengeType::Tob
                | ChallengeType::Toa
                | ChallengeType::Tfa
                | ChallengeType::Mokhaiotl
                | ChallengeType::Colosseum
                | ChallengeType::Inferno
                | ChallengeType::UnknownChallenge => None,
            },
            Some(Ticks(20)),
        ),

        event::Type::NpcDeath => StreamConfig::new(Some(Ticks(8)), Some(Ticks(5))),

        event::Type::TobMaidenCrabLeak => StreamConfig::new(None, Some(Ticks(10))),

        event::Type::TobBloatDown | event::Type::TobBloatUp => {
            StreamConfig::new(Some(Ticks(32)), Some(Ticks(16)))
        }

        event::Type::TobBloatHandsDrop | event::Type::TobBloatHandsSplat => {
            StreamConfig::new(Some(Ticks(5)), None)
        }

        event::Type::TobNyloWaveSpawn => StreamConfig::new(None, Some(Ticks(10))),
        event::Type::TobSoteMazeProc => StreamConfig::new(None, Some(Ticks(20))),
        event::Type::TobSoteMazeEnd => StreamConfig::new(None, Some(Ticks(10))),
        event::Type::TobXarpusPhase => StreamConfig::new(None, Some(Ticks(10))),
        event::Type::TobXarpusExhumed => StreamConfig::new(Some(Ticks(16)), Some(Ticks(10))),

        // Xarpus splats are permanent; the same coord across the fight always
        // refers to the same splat regardless of when each client first saw it.
        event::Type::TobXarpusSplat => StreamConfig::new(None, None),

        event::Type::TobVerzikPhase => StreamConfig::new(None, None),

        // Dawn drops repeat every 4 ticks with alternating dropped values.
        event::Type::TobVerzikDawnDrop => StreamConfig::new(Some(Ticks(3)), None),

        event::Type::TobVerzikHeal => StreamConfig::new(Some(Ticks(30)), Some(Ticks(10))),
        _ => return None,
    };

    Some(config)
}

/// Unique identity for an occurrence of a stream event.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum IdentityKey {
    /// Distinguished by time alone.
    Singleton,
    Player(PartyIndex),
    Npc(RoomId),
    Number(u64),
    Point(Point),
    /// A sorted set of coordinates.
    Points(Vec<Point>),
}

impl std::fmt::Display for IdentityKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Singleton => Ok(()),
            Self::Player(index) => write!(f, "{}", index.as_usize()),
            Self::Npc(room_id) => write!(f, "{}", room_id.0),
            Self::Number(number) => write!(f, "{number}"),
            Self::Point(point) => write!(f, "{},{}", point.0, point.1),
            Self::Points(points) => {
                for (i, point) in points.iter().enumerate() {
                    if i > 0 {
                        f.write_str("|")?;
                    }
                    write!(f, "{},{}", point.0, point.1)?;
                }
                Ok(())
            }
        }
    }
}

/// Returns the identity of a stream event.
pub(super) fn identity_key(kind: &EventKind) -> IdentityKey {
    debug_assert_eq!(classify(kind), Class::Stream);

    match kind {
        EventKind::PlayerDeath(player) => IdentityKey::Player(*player),
        EventKind::NpcDeath(death) => IdentityKey::Npc(death.npc),
        EventKind::MaidenCrabLeak(crab) => IdentityKey::Npc(*crab),
        EventKind::BloatDown(_) | EventKind::BloatUp => IdentityKey::Singleton,
        EventKind::BloatHandsDrop(hands) | EventKind::BloatHandsSplat(hands) => {
            let mut hands = hands.clone();
            hands.sort_unstable();
            IdentityKey::Points(hands)
        }
        EventKind::NyloWaveSpawn(wave) => IdentityKey::Number(u64::from(wave.wave)),
        EventKind::SoteMazeProc(maze) | EventKind::SoteMazeEnd(SoteMazeEnd { maze, .. }) => {
            IdentityKey::Number(*maze as u64)
        }
        EventKind::XarpusPhase(phase) => {
            IdentityKey::Number(u64::from(i32::from(*phase).cast_unsigned()))
        }
        EventKind::XarpusExhumed(exhumed) => IdentityKey::Point(exhumed.position),
        EventKind::XarpusSplat(splat) => IdentityKey::Point(splat.position),
        EventKind::VerzikPhase(phase) => {
            IdentityKey::Number(u64::from(i32::from(*phase).cast_unsigned()))
        }
        EventKind::VerzikDawnDropped(_) => IdentityKey::Number(u64::from(true)),
        EventKind::VerzikDawnPickedUp(_) => IdentityKey::Number(u64::from(false)),
        EventKind::VerzikHeal(heal) => IdentityKey::Player(heal.player),
        _ => unreachable!("non stream event"),
    }
}

// Some player and NPC attacks share the same animation and are identified by
// which projectile is fired. However, projectiles have a shorter render
// distance than actors, so two clients could report contradictory attacks from
// the same actor on what is legitimately the same tick.

/// Collapses a projectile-ambiguous player attack to its canonical value.
pub(super) fn normalize_player_attack(attack: PlayerAttack) -> PlayerAttack {
    // DAWN_AUTO/DAWN_SPEC are deliberately ignored, as there isn't a realistic
    // case where someone would be out of render distance of the projectile.
    match attack {
        PlayerAttack::BlowpipeSpec => PlayerAttack::Blowpipe,
        PlayerAttack::ZcbSpec => PlayerAttack::ZcbAuto,
        other => other,
    }
}

/// Collapses a projectile-ambiguous NPC attack to its canonical value.
pub(super) fn normalize_npc_attack(attack: NpcAttack) -> NpcAttack {
    match attack {
        NpcAttack::TobSoteDeathBall => NpcAttack::TobSoteBall,
        other => other,
    }
}

/// An `AttackPairing` represents the result of matching an attack performed by
/// an actor on a tick between two clients.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum AttackPairing<'a, T> {
    Paired { base: &'a T, target: &'a T },
    BaseOnly(&'a T),
    TargetOnly(&'a T),
}

/// Matches an actor's attacks between two clients without attempting to
/// interpret the result. Prefers matching by shared type, but falls back
/// to any attack pairing.
pub(super) fn pair_attacks<'a, T, K: PartialEq + Copy>(
    base: &'a [T],
    target: &'a [T],
    key: impl Fn(&T) -> (Actor, K),
    normalize: fn(K) -> K,
) -> Vec<AttackPairing<'a, T>> {
    let mut base_paired = vec![false; base.len()];
    let mut target_paired = vec![false; target.len()];
    let mut pairings = Vec::new();

    let passes: [&dyn Fn(K, K) -> bool; 3] = [
        &|base_kind, target_kind| base_kind == target_kind,
        &|base_kind, target_kind| normalize(base_kind) == normalize(target_kind),
        &|_, _| true,
    ];
    for kinds_match in passes {
        for (base_attack, is_paired) in base.iter().zip(&mut base_paired) {
            if *is_paired {
                continue;
            }
            let (actor, kind) = key(base_attack);
            let Some(index) =
                target
                    .iter()
                    .zip(&target_paired)
                    .position(|(target_attack, &taken)| {
                        let (target_actor, target_kind) = key(target_attack);
                        !taken && target_actor == actor && kinds_match(kind, target_kind)
                    })
            else {
                continue;
            };
            *is_paired = true;
            target_paired[index] = true;
            pairings.push(AttackPairing::Paired {
                base: base_attack,
                target: &target[index],
            });
        }
    }

    pairings.extend(
        base.iter()
            .zip(&base_paired)
            .filter(|&(_, &paired)| !paired)
            .map(|(attack, _)| AttackPairing::BaseOnly(attack)),
    );
    pairings.extend(
        target
            .iter()
            .zip(&target_paired)
            .filter(|&(_, &paired)| !paired)
            .map(|(attack, _)| AttackPairing::TargetOnly(attack)),
    );
    pairings
}

#[cfg(test)]
mod tests {
    use blert::RoomId;

    use super::*;

    #[test]
    fn pair_attacks_pairs_equal_kinds() {
        let verzik = Actor::Npc(RoomId(60329));
        let base = [
            (verzik, NpcAttack::TobVerzikP3Ball),
            (verzik, NpcAttack::TobVerzikP3Range),
        ];
        let target = [
            (verzik, NpcAttack::TobVerzikP3Ball),
            (verzik, NpcAttack::TobVerzikP3Range),
        ];

        assert_eq!(
            pair_attacks(&base, &target, |&attack| attack, normalize_npc_attack),
            [
                AttackPairing::Paired {
                    base: &base[0],
                    target: &target[0],
                },
                AttackPairing::Paired {
                    base: &base[1],
                    target: &target[1],
                },
            ]
        );
    }

    #[test]
    fn pair_attacks_pairs_equal_normalized_kinds() {
        let sotetseg = Actor::Npc(RoomId(46222));
        let base = [(sotetseg, NpcAttack::TobSoteBall)];
        let target = [(sotetseg, NpcAttack::TobSoteDeathBall)];

        assert_eq!(
            pair_attacks(&base, &target, |&attack| attack, normalize_npc_attack),
            [AttackPairing::Paired {
                base: &base[0],
                target: &target[0],
            }]
        );
    }

    #[test]
    fn pair_attacks_pairs_remaining_attacks_from_the_same_actor() {
        let verzik = Actor::Npc(RoomId(56892));
        let base = [(verzik, NpcAttack::TobVerzikP2Cabbage)];
        let target = [(verzik, NpcAttack::TobVerzikP2Zap)];

        assert_eq!(
            pair_attacks(&base, &target, |&attack| attack, normalize_npc_attack),
            [AttackPairing::Paired {
                base: &base[0],
                target: &target[0],
            }]
        );
    }

    #[test]
    fn pair_attacks_emits_extra_base_attacks() {
        let verzik = Actor::Npc(RoomId(64384));
        let base = [
            (verzik, NpcAttack::TobVerzikP3Ball),
            (verzik, NpcAttack::TobVerzikP3Range),
        ];
        let target = [(verzik, NpcAttack::TobVerzikP3Range)];

        assert_eq!(
            pair_attacks(&base, &target, |&attack| attack, normalize_npc_attack),
            [
                AttackPairing::Paired {
                    base: &base[1],
                    target: &target[0],
                },
                AttackPairing::BaseOnly(&base[0]),
            ]
        );
    }

    #[test]
    fn pair_attacks_emits_extra_target_attacks() {
        let verzik = Actor::Npc(RoomId(64384));
        let base = [(verzik, NpcAttack::TobVerzikP3Range)];
        let target = [
            (verzik, NpcAttack::TobVerzikP3Ball),
            (verzik, NpcAttack::TobVerzikP3Range),
        ];

        assert_eq!(
            pair_attacks(&base, &target, |&attack| attack, normalize_npc_attack),
            [
                AttackPairing::Paired {
                    base: &base[0],
                    target: &target[1],
                },
                AttackPairing::TargetOnly(&target[0]),
            ]
        );
    }

    #[test]
    fn pair_attacks_does_not_pair_attacks_from_different_actors() {
        let base_verzik = Actor::Npc(RoomId(39244));
        let target_verzik = Actor::Npc(RoomId(43350));
        let base = [
            (base_verzik, NpcAttack::TobVerzikP3Ball),
            (base_verzik, NpcAttack::TobVerzikP3Range),
        ];
        let target = [
            (target_verzik, NpcAttack::TobVerzikP3Ball),
            (target_verzik, NpcAttack::TobVerzikP3Range),
        ];

        assert_eq!(
            pair_attacks(&base, &target, |&attack| attack, normalize_npc_attack),
            [
                AttackPairing::BaseOnly(&base[0]),
                AttackPairing::BaseOnly(&base[1]),
                AttackPairing::TargetOnly(&target[0]),
                AttackPairing::TargetOnly(&target[1]),
            ]
        );
    }
}

//! Blert's event model.
//!
//! This file represents half of Blert's in-memory data model, containing
//! definitions of notable occurrences throughout a timeline. The other half
//! describes the state of of the game world itself.

use crate::actor::Actor;
use crate::item::{EquipmentSlot, Item};
use crate::tick::{Tick, Ticks};
use crate::{
    ClientId, ColosseumHandicap, CombatStyle, NpcAttack, PartyIndex, PlayerAttack, PlayerSpell,
    Point, RoomId, Source,
};

pub use crate::proto::event::colosseum_sol_dust::Direction as SolDustDirection;
pub use crate::proto::event::colosseum_sol_grapple::Outcome as SolGrappleOutcome;
pub use crate::proto::event::colosseum_sol_lasers::Phase as SolLaserPhase;
pub use crate::proto::event::mokhaiotl_orb::Source as MokhaiotlOrbSource;
pub use crate::proto::event::{VerzikPhase, XarpusPhase};

/// A semantic event occurring in a stage.
///
/// Events describe specific things that happen throughout an encounter. This is
/// different to "state", which represents server-authoritative facts about the
/// game world. This distinction is not made in the wire format, which sends
/// every game observation as an event; only a subset of those are defined here.
#[derive(Debug, Clone)]
pub struct Event {
    pub source: Source,
    pub kind: EventKind,
}

impl Event {
    /// Constructs an event of `kind` that was recorded by `client_id`.
    #[must_use]
    pub fn recorded(client_id: ClientId, kind: EventKind) -> Self {
        Self {
            source: Source::Client(client_id),
            kind,
        }
    }

    /// Constructs a synthetic event of `kind`.
    #[must_use]
    pub fn synthetic(kind: EventKind) -> Self {
        Self {
            source: Source::Synthetic,
            kind,
        }
    }
}

/// The payload of an event.
///
/// In addition to only defining a subset of wire events, these payloads omit
/// wire fields that are trivially derivable from world state.
#[derive(Debug, Clone)]
pub enum EventKind {
    /// A player has died.
    /// Typically sent on the tick on which the player's HP reaches zero, but
    /// can be observed later if the player is not in render distance (e.g.
    /// indirectly through a varbit).
    PlayerDeath(PartyIndex),
    PlayerAttack(PlayerAttacked),
    PlayerSpell(PlayerCast),

    /// The first appearance of an NPC in the client.
    /// Render distance may mean that this is not actually when it spawned.
    NpcSpawn(RoomId),
    /// An NPC has despawned following the completion of its death animation.
    NpcDeath(NpcDeath),
    NpcAttack(NpcAttacked),

    /// A crab has reached Maiden with HP remaining.
    MaidenCrabLeak(RoomId),
    BloatDown(BloatDown),
    BloatUp,
    BloatHandsDrop(Vec<Point>),
    BloatHandsSplat(Vec<Point>),
    NyloWaveSpawn(NyloWave),
    NyloWaveStall(NyloWave),
    NyloCleanupEnd,
    NyloBossSpawn,
    SoteMazeProc(Maze),
    SoteMazePivots(SoteMazePivots),
    SoteMazeEnd(SoteMazeEnd),
    XarpusPhase(XarpusPhase),
    XarpusExhumed(XarpusExhumed),
    XarpusSplat(XarpusSplat),
    VerzikPhase(VerzikPhase),
    VerzikDawnDropped(Point),
    VerzikDawnPickedUp(Point),
    VerzikDawnHit(VerzikDawnHit),
    VerzikBounce(VerzikBounce),
    VerzikAttackStyle(AttackStyle),
    VerzikHeal(VerzikHeal),

    HandicapChoice(HandicapChoice),
    DoomApplied,
    TotemHeal(TotemHeal),
    SolDust(SolDust),
    SolGrapple(SolGrapple),
    SolPools(Vec<Point>),
    SolLasers(SolLaserPhase),

    MokhaiotlAttackStyle(AttackStyle),
    MokhaiotlOrb(MokhaiotlOrb),
    MokhaiotlLarvaLeak(MokhaiotlLarvaLeak),

    /// Not really an "event" in the normal sense, as it doesn't describe
    /// anything that happened within a stage. The plugin sends one of these
    /// on tick 0 of each wave with its own accounting of the ticks elapsed
    /// since the start of the challenge, including inter-wave gaps.
    /// Not sent if the player ever logs out since the clock is no longer
    /// monotonic.
    InfernoWaveStart(Ticks),
}

impl EventKind {
    /// Applies the given `remap` function to every tick in the event payload.
    pub fn remap_ticks(&mut self, mut remap: impl FnMut(Tick) -> Tick) {
        match self {
            Self::XarpusExhumed(exhumed) => {
                exhumed.spawn_tick = remap(exhumed.spawn_tick);
                for heal_tick in &mut exhumed.heal_ticks {
                    *heal_tick = remap(*heal_tick);
                }
            }
            Self::VerzikDawnHit(hit) => hit.attack_tick = remap(hit.attack_tick),
            Self::VerzikBounce(bounce) => bounce.attack_tick = remap(bounce.attack_tick),
            Self::VerzikAttackStyle(style) | Self::MokhaiotlAttackStyle(style) => {
                style.attack_tick = remap(style.attack_tick);
            }
            Self::TotemHeal(heal) => heal.start_tick = remap(heal.start_tick),
            Self::SolGrapple(grapple) => grapple.attack_tick = remap(grapple.attack_tick),
            Self::MokhaiotlOrb(orb) => orb.spawn_tick = remap(orb.spawn_tick),
            Self::PlayerDeath(_)
            | Self::PlayerAttack(_)
            | Self::PlayerSpell(_)
            | Self::NpcSpawn(_)
            | Self::NpcDeath(_)
            | Self::NpcAttack(_)
            | Self::MaidenCrabLeak(_)
            | Self::BloatDown(_)
            | Self::BloatUp
            | Self::BloatHandsDrop(_)
            | Self::BloatHandsSplat(_)
            | Self::NyloWaveSpawn(_)
            | Self::NyloWaveStall(_)
            | Self::NyloCleanupEnd
            | Self::NyloBossSpawn
            | Self::SoteMazeProc(_)
            | Self::SoteMazePivots(_)
            | Self::SoteMazeEnd(_)
            | Self::XarpusPhase(_)
            | Self::XarpusSplat(_)
            | Self::VerzikPhase(_)
            | Self::VerzikDawnDropped(_)
            | Self::VerzikDawnPickedUp(_)
            | Self::VerzikHeal(_)
            | Self::HandicapChoice(_)
            | Self::DoomApplied
            | Self::SolDust(_)
            | Self::SolPools(_)
            | Self::SolLasers(_)
            | Self::MokhaiotlLarvaLeak(_)
            | Self::InfernoWaveStart(_) => {}
        }
    }
}

/// An attack performed by a player.
#[derive(Debug, Clone)]
pub struct PlayerAttacked {
    pub player: PartyIndex,
    pub attack: PlayerAttack,
    pub weapon: Option<Item>,
    pub target: Option<Actor>,
}

/// A spell cast by a player.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlayerCast {
    pub player: PartyIndex,
    pub spell: PlayerSpell,
    pub target: Option<Actor>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NpcDeath {
    pub position: Point,
    pub npc: RoomId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NpcAttacked {
    pub npc: RoomId,
    pub attack: NpcAttack,
    pub target: Option<Actor>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BloatDown {
    pub down_number: u32,
    /// Number of ticks since Bloat last got up (or the start of the fight).
    /// Note: you almost certainly want [`BloatDown::walk_ticks`] instead.
    pub up_ticks: Ticks,
}

impl BloatDown {
    /// Returns Bloat's walk duration.
    #[must_use]
    pub fn walk_ticks(&self) -> Ticks {
        self.up_ticks.dec()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NyloWave {
    /// Wave number 1-31.
    pub wave: u8,
    pub nylos_alive: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Maze {
    Maze66 = 0,
    Maze33 = 1,
}

#[derive(Debug, Clone)]
pub struct SoteMazePivots {
    pub maze: Maze,
    pub overworld: Vec<Point>,
    pub underworld: Vec<Point>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SoteMazeEnd {
    pub maze: Maze,
    pub chosen: Option<PartyIndex>,
}

/// The lifecycle of an exhumed, emitted after it despawns.
#[derive(Debug, Clone)]
pub struct XarpusExhumed {
    pub position: Point,
    pub spawn_tick: Tick,
    pub heal_ticks: Vec<Tick>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct XarpusSplat {
    pub position: Point,
    pub source: XarpusSplatSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum XarpusSplatSource {
    Unknown,
    Xarpus,
    Bounce(Point),
}

// TODO(frolv): consider a generic event that retroactively attaches damage
// to player attacks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VerzikDawnHit {
    pub player: PartyIndex,
    pub attack_tick: Tick,
    pub damage: u32,
}

/// Tracks the chance of Verzik bounces. Sent following every P2 attack.
/// If the attack was a bounce, `bounced` stores the player who bounced.
/// Otherwise, Verzik used a different attack and the players in range
/// indicate whether anyone chanced a bounce.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VerzikBounce {
    pub attack_tick: Tick,
    /// Number of players adjacent to or under Verzik. Always set.
    pub players_in_range: u8,
    pub bounced: Option<PartyIndex>,
}

/// Identifies the style of a previous NPC attack.
// TODO(frolv): Replace disjoint uses of this with a generic attack style event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AttackStyle {
    pub attack_tick: Tick,
    pub style: CombatStyle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VerzikHeal {
    pub player: PartyIndex,
    pub amount: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HandicapChoice {
    pub handicap: ColosseumHandicap,
    pub options: [ColosseumHandicap; 3],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TotemHeal {
    pub totem: RoomId,
    pub target: RoomId,
    pub start_tick: Tick,
    pub amount: u32,
}

/// The patterns of Sol's basic attacks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SolDust {
    Trident1(SolDustDirection),
    Trident2(SolDustDirection),
    Shield1,
    Shield2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SolGrapple {
    pub attack_tick: Tick,
    pub target: EquipmentSlot,
    pub outcome: SolGrappleOutcome,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MokhaiotlOrb {
    pub source: MokhaiotlOrbSource,
    pub source_point: Point,
    pub style: CombatStyle,
    pub spawn_tick: Tick,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MokhaiotlLarvaLeak {
    pub larva: RoomId,
    pub heal_amount: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_kind_remap() {
        let mut exhumed = EventKind::XarpusExhumed(XarpusExhumed {
            position: Point(3170, 4387),
            spawn_tick: Tick(20),
            heal_ticks: vec![Tick(24), Tick(28), Tick(32)],
        });
        exhumed.remap_ticks(|tick| tick + Ticks(10));
        let EventKind::XarpusExhumed(exhumed) = exhumed else {
            unreachable!();
        };
        assert_eq!(exhumed.spawn_tick, Tick(30));
        assert_eq!(exhumed.heal_ticks, [Tick(34), Tick(38), Tick(42)]);

        let mut dawn_hit = EventKind::VerzikDawnHit(VerzikDawnHit {
            player: PartyIndex::from_usize(2),
            attack_tick: Tick(41),
            damage: 75,
        });
        dawn_hit.remap_ticks(|tick| tick - Ticks(3));
        let EventKind::VerzikDawnHit(dawn_hit) = dawn_hit else {
            unreachable!();
        };
        assert_eq!(
            dawn_hit,
            VerzikDawnHit {
                player: PartyIndex::from_usize(2),
                attack_tick: Tick(38),
                damage: 75,
            }
        );

        let mut bounce = EventKind::VerzikBounce(VerzikBounce {
            attack_tick: Tick(104),
            players_in_range: 2,
            bounced: Some(PartyIndex::from_usize(1)),
        });
        bounce.remap_ticks(|tick| tick + Ticks(1));
        let EventKind::VerzikBounce(bounce) = bounce else {
            unreachable!();
        };
        assert_eq!(
            bounce,
            VerzikBounce {
                attack_tick: Tick(105),
                players_in_range: 2,
                bounced: Some(PartyIndex::from_usize(1)),
            }
        );

        let mut verzik_style = EventKind::VerzikAttackStyle(AttackStyle {
            attack_tick: Tick(200),
            style: CombatStyle::Ranged,
        });
        verzik_style.remap_ticks(|tick| tick + Ticks(27));
        let EventKind::VerzikAttackStyle(verzik_style) = verzik_style else {
            unreachable!();
        };
        assert_eq!(
            verzik_style,
            AttackStyle {
                attack_tick: Tick(227),
                style: CombatStyle::Ranged,
            }
        );

        let mut mokhaiotl_style = EventKind::MokhaiotlAttackStyle(AttackStyle {
            attack_tick: Tick(16),
            style: CombatStyle::Magic,
        });
        mokhaiotl_style.remap_ticks(|tick| tick - Ticks(9));
        let EventKind::MokhaiotlAttackStyle(mokhaiotl_style) = mokhaiotl_style else {
            unreachable!();
        };
        assert_eq!(
            mokhaiotl_style,
            AttackStyle {
                attack_tick: Tick(7),
                style: CombatStyle::Magic,
            }
        );

        let mut totem_heal = EventKind::TotemHeal(TotemHeal {
            totem: RoomId(12),
            target: RoomId(5),
            start_tick: Tick(72),
            amount: 18,
        });
        totem_heal.remap_ticks(|tick| tick - Ticks(6));
        let EventKind::TotemHeal(totem_heal) = totem_heal else {
            unreachable!();
        };
        assert_eq!(
            totem_heal,
            TotemHeal {
                totem: RoomId(12),
                target: RoomId(5),
                start_tick: Tick(66),
                amount: 18,
            }
        );

        let mut grapple = EventKind::SolGrapple(SolGrapple {
            attack_tick: Tick(57),
            target: EquipmentSlot::Legs,
            outcome: SolGrappleOutcome::Parry,
        });
        grapple.remap_ticks(|tick| tick + Ticks(4));
        let EventKind::SolGrapple(grapple) = grapple else {
            unreachable!();
        };
        assert_eq!(
            grapple,
            SolGrapple {
                attack_tick: Tick(61),
                target: EquipmentSlot::Legs,
                outcome: SolGrappleOutcome::Parry,
            }
        );

        let mut orb = EventKind::MokhaiotlOrb(MokhaiotlOrb {
            source: MokhaiotlOrbSource::Ball,
            source_point: Point(1310, 9570),
            style: CombatStyle::Melee,
            spawn_tick: Tick(33),
        });
        orb.remap_ticks(|tick| tick + Ticks(67));
        let EventKind::MokhaiotlOrb(orb) = orb else {
            unreachable!();
        };
        assert_eq!(
            orb,
            MokhaiotlOrb {
                source: MokhaiotlOrbSource::Ball,
                source_point: Point(1310, 9570),
                style: CombatStyle::Melee,
                spawn_tick: Tick(100),
            }
        );

        let mut down = EventKind::BloatDown(BloatDown {
            down_number: 2,
            up_ticks: Ticks(39),
        });
        down.remap_ticks(|tick| tick + Ticks(15));
        let EventKind::BloatDown(down) = down else {
            unreachable!();
        };
        assert_eq!(
            down,
            BloatDown {
                down_number: 2,
                up_ticks: Ticks(39),
            }
        );
    }
}
